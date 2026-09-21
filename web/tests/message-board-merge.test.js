import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMessageBoardClient } from '../src/message-board-client.js';
import { mergeMessageBoardRecords } from '../src/message-board-merge.js';
import {
  eraseMemo, mergeMessageBoard, readMessageBoard, updateMessageBoard, writeMessageBoard,
} from '../../tools/local-state.mjs';

const memo = (id = 'memo-one', values = {}) => ({
  id, text: 'Synthetic Memo', createdAt: '2026-09-21T12:00:00.000Z', readAt: null,
  position: { x: 0, y: 20 }, ...values,
});
const incoming = {
  kind: 'letter', id: 'incoming-one', text: 'Synthetic incoming Letter',
  createdAt: memo().createdAt, readAt: null, header: 'Synthetic sender', photo: null,
  sender: { kind: 'wii', address: '1234567812345678', nickname: 'Fixture' },
};

test('three-way Board merge keeps remote additions/deletions and combines independent fields', () => {
  const base = [memo(), memo('deleted')];
  const current = [memo('memo-one', { readAt: memo().createdAt }), memo('remote-added')];
  const desired = [memo('memo-one', { position: { x: 30, y: 20 } }), memo('deleted'), memo('local-added')];
  const merged = mergeMessageBoardRecords(base, current, desired);
  assert.deepEqual(merged, [
    memo('memo-one', { readAt: memo().createdAt, position: { x: 30, y: 20 } }),
    memo('remote-added'), memo('local-added'),
  ]);
  assert.deepEqual(mergeMessageBoardRecords(base, current, []), current);
  assert.deepEqual(base, [memo(), memo('deleted')]);
});

test('same-field divergence, deleted-record edits and conflicting new IDs are explicit conflicts', () => {
  for (const [base, current, desired] of [
    [[memo()], [memo('memo-one', { text: 'Other tab' })], [memo('memo-one', { text: 'Local edit' })]],
    [[memo()], [], [memo('memo-one', { position: { x: 50, y: 20 } })]],
    [[], [memo()], [memo('memo-one', { text: 'Conflicting new identity' })]],
  ]) {
    assert.throws(() => mergeMessageBoardRecords(base, current, desired), { code: 'BOARD_CONFLICT' });
  }
  assert.deepEqual(mergeMessageBoardRecords([], [memo()], [{ position: { y: 20, x: 0 },
    readAt: null, createdAt: memo().createdAt, text: memo().text, id: memo().id }]), [memo()]);
});

test('queued UI snapshots preserve newly learned remote records and unchanged remote fields', async () => {
  let current = [memo()];
  let requests = 0;
  const client = createMessageBoardClient({
    read: async () => structuredClone(current),
    write: async ({ base, memos }) => {
      if (!requests++) {
        current[0].text = 'Remote content';
        current.push(memo('remote-added'));
      }
      current = mergeMessageBoardRecords(base, current, memos);
      return current;
    },
  });
  await client.read();
  const first = client.prepareSave([memo('memo-one', { position: { x: 10, y: 20 } })]);
  const second = client.prepareSave([memo('memo-one', { position: { x: 20, y: 20 } })]);
  await first();
  const result = await second();
  assert.deepEqual(result, [memo('memo-one', {
    text: 'Remote content', position: { x: 20, y: 20 },
  }), memo('remote-added')]);
  result[0].text = 'Caller mutation';
  assert.equal(client.baseline()[0].text, 'Remote content');
});

test('failed saves keep their intent through later queued edits and response-loss retries', async () => {
  let current = [memo()];
  let fail = true;
  const client = createMessageBoardClient({
    read: async () => structuredClone(current),
    write: async ({ base, memos }) => {
      if (fail) { fail = false; throw new Error('Synthetic disk failure'); }
      current = mergeMessageBoardRecords(base, current, memos);
      return current;
    },
  });
  await client.read();
  const first = client.prepareSave([memo('memo-one', { position: { x: 10, y: 20 } })]);
  const second = client.prepareSave([memo('memo-one', {
    position: { x: 10, y: 20 }, readAt: memo().createdAt,
  })]);
  await assert.rejects(first(), /disk failure/);
  assert.equal(client.baseline()[0].position.x, 0);
  assert.deepEqual(await second(), [memo('memo-one', {
    position: { x: 10, y: 20 }, readAt: memo().createdAt,
  })]);

  let loseResponse = true;
  const retryClient = createMessageBoardClient({
    read: async () => [],
    write: async ({ base, memos }) => {
      current = mergeMessageBoardRecords(base, current, memos);
      if (loseResponse) { loseResponse = false; throw new Error('Synthetic lost response'); }
      return current;
    },
  });
  current = [];
  await retryClient.read();
  await assert.rejects(retryClient.prepareSave([memo()])(), /lost response/);
  assert.deepEqual(await retryClient.prepareSave([memo()])(), [memo()]);
});

test('unknown baselines block writes and erased IDs cannot be recreated by stale UI proposals', async () => {
  const client = createMessageBoardClient({
    read: async () => { throw new Error('Unavailable Board'); }, write: async () => assert.fail(),
  });
  await assert.rejects(client.read(), /Unavailable/);
  assert.throws(() => client.prepareSave([memo()]), /Read the Message Board/);
  let current = [memo()];
  const known = createMessageBoardClient({
    read: async () => current,
    write: async ({ base, memos }) => (current = mergeMessageBoardRecords(base, current, memos)),
  });
  await known.read();
  current = [];
  known.erased(memo().id);
  assert.deepEqual(await known.prepareSave([memo()])(), []);
  await assert.rejects(known.prepareSave([memo('memo-one', { text: 'Stale edit' })])(),
    { code: 'BOARD_CONFLICT' });
  assert.deepEqual(current, []);
});

test('explicit Memo erase and browser merge preserve other records under the same lock', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wii-memo-merge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'message-board.json');
  const initial = { version: 1, memos: [memo(), incoming] };
  await updateMessageBoard(file, () => initial);
  await assert.rejects(eraseMemo(file, { version: 1, id: incoming.id }), /incoming Letter/);
  assert.deepEqual(await eraseMemo(file, { version: 1, id: memo().id }),
    { version: 1, id: memo().id, erased: true });
  assert.deepEqual(await eraseMemo(file, { version: 1, id: memo().id }),
    { version: 1, id: memo().id, erased: false });
  await mergeMessageBoard(file, { ...initial, base: initial.memos });
  assert.deepEqual((await readMessageBoard(file)).memos, [incoming]);
  const before = await readFile(file, 'utf8');
  await assert.rejects(mergeMessageBoard(file, {
    version: 1, base: initial.memos, memos: [memo('memo-one', { text: 'Stale edit' }), incoming],
  }), { code: 'BOARD_CONFLICT' });
  assert.equal(await readFile(file, 'utf8'), before);
  await Promise.all([
    mergeMessageBoard(file, { version: 1, base: [incoming], memos: [incoming, memo('new-one')] }),
    mergeMessageBoard(file, { version: 1, base: [incoming], memos: [incoming, memo('new-two')] }),
  ]);
  assert.deepEqual((await readMessageBoard(file)).memos.map(({ id }) => id),
    [incoming.id, 'new-one', 'new-two']);
  await assert.rejects(mergeMessageBoard(file, {
    version: 1, base: [incoming], memos: [{ ...incoming, text: 'Illegal rewrite' }],
  }), /immutable/);
  // Explicit CLI import remains a deliberate Memo replacement, including restore.
  await writeMessageBoard(file, { version: 1, memos: [memo()] });
  assert.deepEqual((await readMessageBoard(file)).memos, [memo(), incoming]);
  await mkdir(`${file}.lock`);
  const lockedBytes = await readFile(file, 'utf8');
  await assert.rejects(eraseMemo(file, { version: 1, id: memo().id }), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), lockedBytes);
  await rm(`${file}.lock`, { recursive: true });
  await Promise.all([
    eraseMemo(file, { version: 1, id: memo().id }),
    updateMessageBoard(file, (state) => ({ ...state, memos: [...state.memos, memo('concurrent-post')] })),
  ]);
  assert.deepEqual((await readMessageBoard(file)).memos, [incoming, memo('concurrent-post')]);
  await writeFile(file, '{ malformed synthetic file');
  await assert.rejects(eraseMemo(file, { version: 1, id: 'concurrent-post' }));
  assert.equal(await readFile(file, 'utf8'), '{ malformed synthetic file');
});
