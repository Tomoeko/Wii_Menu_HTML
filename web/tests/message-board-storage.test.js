import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readMessageBoard,
  validateMessageBoard,
  writeMessageBoard,
  updateMessageBoard,
  eraseIncomingLetter,
} from '../../tools/local-state.mjs';
import {
  eraseIncomingLetter as eraseIncomingLetterFromBrowser,
  prepareMessageBoardSave,
  readMessageBoard as readMessageBoardFromBrowser,
} from '../src/message-board-storage.js';
const record = {
  id: 'memo-one',
  text: 'A readable local memo',
  createdAt: '2026-09-17T12:00:00.000Z',
  position: { x: -230, y: 180 },
  readAt: null,
};

const incoming = (id = 'incoming-one') => ({
  kind: 'letter', id, createdAt: record.createdAt, header: 'Synthetic sender',
  text: 'Synthetic imported Letter', readAt: null,
  sender: { kind: 'wii', address: '1234567812345678', nickname: 'Fixture' }, photo: null,
});

test('Message Board writes exclude local outbox projections', async (t) => {
  const outbox = {
    kind: 'letter', id: 'outbox-local', origin: 'outbox',
    createdAt: record.createdAt, header: 'To Local', text: 'Sent locally',
    sender: null, replyAllowed: false, photo: null,
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (path, options = {}) => {
    requests.push([path, options]);
    if (options.method === 'PUT')
      return { ok: true, json: async () => ({ version: 1, memos: [record] }) };
    return { ok: true, json: async () => ({ version: 1, memos: [record, outbox] }) };
  });
  assert.deepEqual(await readMessageBoardFromBrowser(), [record]);
  await prepareMessageBoardSave([record, outbox])();
  const body = JSON.parse(requests.at(-1)[1].body);
  assert.deepEqual(body.memos, [record]);
});

test('browser erase helper sends only the explicit identifier and rejects unconfirmed responses',
  async (t) => {
    const requests = [];
    const response = { version: 1, id: 'incoming-one', erased: true };
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      requests.push([path, options]);
      return { ok: true, json: async () => response };
    });
    assert.deepEqual(await eraseIncomingLetterFromBrowser('incoming-one'), response);
    assert.equal(requests[0][0], '/api/message-board/erase-letter');
    assert.equal(requests[0][1].method, 'POST');
    assert.deepEqual(JSON.parse(requests[0][1].body), { version: 1, id: 'incoming-one' });
    response.id = 'wrong-record';
    await assert.rejects(eraseIncomingLetterFromBrowser('incoming-one'), /Unsupported/);
    const count = requests.length;
    await assert.rejects(eraseIncomingLetterFromBrowser('../private'), /version 1/);
    assert.equal(requests.length, count);
  });

test('explicit incoming erase preserves stale-save protection, unrelated records and shared photos',
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'wii-board-erase-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'message-board.json');
    const photoFile = join(directory, 'shared-photo.png');
    await writeFile(photoFile, 'Synthetic photo preservation marker');
    const first = incoming();
    const second = incoming('incoming-two');
    const state = { version: 1, memos: [record, first, second] };
    await updateMessageBoard(file, () => state);
    await writeMessageBoard(file, { version: 1, memos: [record] });
    assert.deepEqual(await readMessageBoard(file), state);
    assert.deepEqual(await eraseIncomingLetter(file, { version: 1, id: first.id }),
      { version: 1, id: first.id, erased: true });
    assert.deepEqual(await readMessageBoard(file), { version: 1, memos: [record, second] });
    assert.deepEqual(await eraseIncomingLetter(file, { version: 1, id: first.id }),
      { version: 1, id: first.id, erased: false });
    await assert.rejects(writeMessageBoard(file, state), /content is immutable/);
    const before = await readFile(file, 'utf8');
    await assert.rejects(eraseIncomingLetter(file, { version: 1, id: record.id }), /does not belong/);
    for (const request of [{ version: 2, id: first.id }, { version: 1, id: '../private' },
      { version: 1, id: '__proto__' }, { version: 1, id: first.id, all: true }]) {
      await assert.rejects(eraseIncomingLetter(file, request), /version 1/);
    }
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(await readFile(photoFile, 'utf8'), 'Synthetic photo preservation marker');
    assert.deepEqual((await readdir(directory)).sort(), ['message-board.json', 'shared-photo.png']);
  });

test('incoming erase shares the import lock and keeps foreign locks or malformed Board bytes intact',
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'wii-board-erase-lock-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'message-board.json');
    await updateMessageBoard(file, () => ({ version: 1, memos: [incoming()] }));
    const third = incoming('concurrent-import');
    await Promise.all([
      eraseIncomingLetter(file, { version: 1, id: incoming().id }),
      updateMessageBoard(file, (previous) => ({ version: 1, memos: [...previous.memos, third] })),
    ]);
    assert.deepEqual((await readMessageBoard(file)).memos, [third]);
    const lock = `${file}.lock`;
    await mkdir(lock);
    await writeFile(join(lock, 'owner'), 'Foreign writer');
    const before = await readFile(file, 'utf8');
    await assert.rejects(eraseIncomingLetter(file, { version: 1, id: third.id }), { code: 'EEXIST' });
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(await readFile(join(lock, 'owner'), 'utf8'), 'Foreign writer');
    await rm(lock, { recursive: true });
    await writeFile(file, '{ malformed private fixture');
    await assert.rejects(eraseIncomingLetter(file, { version: 1, id: third.id }));
    assert.equal(await readFile(file, 'utf8'), '{ malformed private fixture');
    assert.deepEqual(await readdir(directory), ['message-board.json']);
  });

test('Message Board JSON round trip retains text, timestamps and original coordinate bounds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wii-board-'));
  try {
    const file = join(directory, '.local', 'message-board.json');
    assert.deepEqual(await readMessageBoard(file), { version: 1, memos: [] });
    const value = { version: 1, memos: [record] };
    await writeMessageBoard(file, value);
    assert.deepEqual(await readMessageBoard(file), value);
    assert.ok((await readFile(file, 'utf8')).includes('\n  "memos"'));
    await assert.rejects(async () =>
      writeMessageBoard(file, {
        version: 1,
        memos: [{ ...record, position: { x: 231, y: 0 } }],
      }),
    );
    assert.deepEqual(await readMessageBoard(file), value);
    await Promise.all([
      writeMessageBoard(file, {
        version: 1,
        memos: [{ ...record, text: 'First' }],
      }),
      writeMessageBoard(file, {
        version: 1,
        memos: [{ ...record, text: 'Second' }],
      }),
    ]);
    assert.equal((await readMessageBoard(file)).memos[0].text, 'Second');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Message Board import rejects invalid identities, dates and out-of-range records', () => {
  for (const memos of [
    [record, record],
    [{ ...record, id: '' }],
    [{ ...record, createdAt: 'invalid' }],
    [{ ...record, readAt: 'invalid' }],
    [{ ...record, position: { x: NaN, y: 0 } }],
  ])
    assert.throws(() => validateMessageBoard({ version: 1, memos }));
  assert.throws(() => validateMessageBoard({ version: 2, memos: [] }));
  assert.equal(
    validateMessageBoard({
      version: 1,
      memos: [{ ...record, position: undefined }],
    }).memos[0].text,
    record.text,
  );
});
