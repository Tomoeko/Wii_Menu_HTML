import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRgbaPng } from '../../tools/channel-image.mjs';
import { importIncomingLetters, mergeIncomingLetters } from '../../tools/incoming-letters.mjs';
import {
  eraseIncomingLetter, readMessageBoard, validateMessageBoard, writeMessageBoard,
} from '../../tools/local-state.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../tools/incoming-letters.mjs', import.meta.url));
const letter = (id = 'incoming-one', extra = {}) => ({
  kind: 'letter', id, createdAt: '2026-01-02T03:04:05.000Z', header: 'Synthetic sender',
  text: 'Synthetic incoming Letter',
  sender: { kind: 'wii', nickname: 'Synthetic', address: '1234567812345678' }, photo: null,
  ...extra,
});
const memo = { id: 'existing-memo', text: 'Existing local Memo',
  createdAt: '2026-01-01T00:00:00.000Z', readAt: null, position: { x: 10, y: 20 } };
const format = (value) => JSON.stringify(value, null, 2) + '\n';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'incoming-letter-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { boardFile: join(root, '.local/message-board.json'),
    localDirectory: join(root, '.local'), assets: join(root, 'assets'),
    photoDirectory: join(root, 'photos') };
  await mkdir(options.photoDirectory);
  await writeMessageBoard(options.boardFile, { version: 1, memos: [memo] });
  const file = join(root, 'incoming.json');
  const save = (letters) => writeFile(file, format({ version: 1, letters }));
  const png = async (id = 'photo-one') => {
    const bytes = encodeRgbaPng(2, 1, Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]));
    const photo = { id, width: 2, height: 1, localSrc: `/assets/local-letters/${id}.png`,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(join(options.photoDirectory, `${id}.png`), bytes);
    return { bytes, photo };
  };
  const thumbnail = async (photo) => {
    const bytes = encodeRgbaPng(64, 48, Buffer.alloc(64 * 48 * 4, 255));
    const descriptor = { width: 64, height: 48,
      localSrc: `/assets/local-letters/thumbnails/${photo.id}.png`,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    const directory = join(options.photoDirectory, 'thumbnails');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${photo.id}.png`), bytes);
    return { bytes, photo: { ...photo, thumbnail: descriptor } };
  };
  return { root, file, options, save, png, thumbnail };
}

test('version 1 Board validation retains detached Letter metadata and existing Memo shape', () => {
  const input = { ...letter(), readAt: '2026-01-03T00:00:00Z', position: { x: -230, y: 180 } };
  const result = validateMessageBoard({ version: 1, memos: [memo, input] });
  assert.deepEqual(result.memos[0], memo);
  assert.deepEqual(result.memos[1], { ...input, readAt: '2026-01-03T00:00:00.000Z' });
  result.memos[1].sender.nickname = 'Changed';
  result.memos[1].position.x = 0;
  assert.equal(input.sender.nickname, 'Synthetic');
  assert.equal(input.position.x, -230);
  assert.throws(() => validateMessageBoard({ version: 1, memos: [letter('invalid', {
    sender: { kind: 'wii', nickname: 'Synthetic', address: 'invalid' },
  })] }));
});

test('verified photo import is additive and retries preserve read time and card position', async (t) => {
  const { file, options, save, png } = await fixture(t);
  const { bytes, photo } = await png();
  const incoming = letter('incoming-one', { photo });
  await save([incoming]);
  const imported = await importIncomingLetters(file, options);
  assert.deepEqual(imported.memos, [memo, { ...incoming, readAt: null }]);
  assert.deepEqual(await readFile(join(options.assets, 'local-letters/photo-one.png')), bytes);
  imported.memos[1].readAt = '2026-01-04T00:00:00.000Z';
  imported.memos[1].position = { x: 50, y: 100 };
  await writeMessageBoard(options.boardFile, imported);
  const before = await readFile(options.boardFile, 'utf8');
  await importIncomingLetters(file, options);
  assert.equal(await readFile(options.boardFile, 'utf8'), before);
  assert.deepEqual(await readdir(options.localDirectory), ['message-board.json']);
  assert.deepEqual(await readdir(join(options.assets, 'local-letters')), ['photo-one.png']);
});

test('non-replyable incoming records round-trip and their Reply policy remains immutable', async (t) => {
  const { file, options, save } = await fixture(t);
  const incoming = [letter('no-sender', { sender: null }),
    letter('no-reply', { replyAllowed: false }), letter('normal', { replyAllowed: true })];
  await save(incoming);
  const imported = await importIncomingLetters(file, options);
  assert.deepEqual(imported.memos, [memo, ...incoming.slice(0, 2).map((entry) =>
    ({ ...entry, readAt: null })), { ...letter('normal'), readAt: null }]);
  imported.memos[1].readAt = '2026-01-04T00:00:00.000Z';
  imported.memos[2].position = { x: 50, y: 100 };
  await writeMessageBoard(options.boardFile, imported);
  const before = await readFile(options.boardFile, 'utf8');
  await importIncomingLetters(file, options);
  assert.equal(await readFile(options.boardFile, 'utf8'), before);
  for (const conflict of [letter('no-sender'), letter('no-reply')]) {
    await save([conflict]);
    await assert.rejects(importIncomingLetters(file, options), /Conflicting/);
    const changed = structuredClone(imported);
    const index = changed.memos.findIndex(({ id }) => id === conflict.id);
    changed.memos[index] = { ...conflict, readAt: null };
    await assert.rejects(writeMessageBoard(options.boardFile, changed), /immutable/);
    assert.equal(await readFile(options.boardFile, 'utf8'), before);
  }
});

test('erasing one imported photo Letter preserves shared prepared pixels and supports deliberate reimport',
  async (t) => {
    const { file, options, save, png } = await fixture(t);
    const { photo, bytes } = await png();
    await save([letter('first', { photo }), letter('second', { photo })]);
    await importIncomingLetters(file, options);
    await eraseIncomingLetter(options.boardFile, { version: 1, id: 'first' });
    assert.deepEqual((await readMessageBoard(options.boardFile)).memos,
      [memo, { ...letter('second', { photo }), readAt: null }]);
    const asset = join(options.assets, 'local-letters/photo-one.png');
    assert.deepEqual(await readFile(asset), bytes);
    await eraseIncomingLetter(options.boardFile, { version: 1, id: 'second' });
    assert.deepEqual(await readFile(asset), bytes);
    await importIncomingLetters(file, options);
    assert.deepEqual((await readMessageBoard(options.boardFile)).memos.map(({ id }) => id),
      ['existing-memo', 'first', 'second']);
    assert.deepEqual(await readFile(asset), bytes);
    assert.deepEqual(await readdir(options.localDirectory), ['message-board.json']);
  });

test('a stale Board save retains imported Letters while legacy Memo replacement still works', async (t) => {
  const { file, options, save } = await fixture(t);
  await save([letter()]);
  await importIncomingLetters(file, options);
  const saved = await writeMessageBoard(options.boardFile, { version: 1, memos: [] });
  assert.deepEqual(saved.memos, [{ ...letter(), readAt: null }]);
  await assert.rejects(writeMessageBoard(options.boardFile, { version: 1, memos: [
    { ...letter(), readAt: null, text: 'Overwritten content' },
  ] }), /immutable/);
  await assert.rejects(writeMessageBoard(options.boardFile, { version: 1, memos: [letter('new')] }),
    /verified local import/);
  assert.deepEqual(await readMessageBoard(options.boardFile), saved);
});

test('conflicting record IDs, existing Memo collisions and duplicate photo IDs reject the whole merge', async (t) => {
  const { file, options, save, png } = await fixture(t);
  const { photo } = await png();
  await save([letter()]);
  await importIncomingLetters(file, options);
  const before = await readFile(options.boardFile, 'utf8');
  for (const records of [
    [letter('unpublished', { photo }), letter('incoming-one', { text: 'Conflict' })],
    [letter(memo.id)],
    [letter('photo-a', { photo }), letter('photo-b', { photo: { ...photo, width: 3 } })],
  ]) {
    await save(records);
    await assert.rejects(importIncomingLetters(file, options), /Conflicting/);
    assert.equal(await readFile(options.boardFile, 'utf8'), before);
    await assert.rejects(readFile(join(options.assets, 'local-letters/photo-one.png')), { code: 'ENOENT' });
  }
  assert.throws(() => mergeIncomingLetters({ version: 1, memos: Array.from({ length: 2000 },
    (_, index) => ({ ...memo, id: `memo-${index}` })) }, { version: 1, letters: [letter()] }), /2000/);
});

test('photo bytes must match bounded PNG dimensions and hash before any state is changed', async (t) => {
  const { file, options, save, png } = await fixture(t);
  const { bytes, photo } = await png();
  const before = await readFile(options.boardFile, 'utf8');
  for (const badPhoto of [{ ...photo, sha256: '0'.repeat(64) }, { ...photo, width: 3 }]) {
    await save([letter('bad-photo', { photo: badPhoto })]);
    await assert.rejects(importIncomingLetters(file, options), /dimensions or SHA-256/);
  }
  await save([letter('bad-photo', { photo })]);
  const corrupt = Buffer.from(bytes);
  corrupt[corrupt.length - 5] ^= 1;
  await writeFile(join(options.photoDirectory, `${photo.id}.png`), corrupt);
  await assert.rejects(importIncomingLetters(file, options), /checksum/);
  await writeFile(join(options.photoDirectory, `${photo.id}.png`), Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(importIncomingLetters(file, options), /bounded regular file/);
  assert.equal(await readFile(options.boardFile, 'utf8'), before);
});

test('photo input and destination symlinks cannot escape their explicit directories', async (t) => {
  const { root, file, options, save, png } = await fixture(t);
  const { bytes, photo } = await png();
  await save([letter('with-photo', { photo })]);
  const photoFile = join(options.photoDirectory, `${photo.id}.png`);
  const external = join(root, 'external.png');
  await writeFile(external, bytes);
  await rm(photoFile);
  await symlink(external, photoFile);
  await assert.rejects(importIncomingLetters(file, options), { code: 'ELOOP' });
  await rm(photoFile);
  await writeFile(photoFile, bytes);
  await mkdir(options.assets);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(options.assets, 'local-letters'));
  await assert.rejects(importIncomingLetters(file, options), /regular directory/);
  assert.deepEqual(await readdir(outside), []);
});

test('a conflicting published photo prevents both new images and Board publication', async (t) => {
  const { file, options, save, png } = await fixture(t);
  const first = await png('first-photo');
  const second = await png('second-photo');
  await save([letter('first', { photo: first.photo }), letter('second', { photo: second.photo })]);
  const directory = join(options.assets, 'local-letters');
  await mkdir(directory, { recursive: true });
  const foreign = encodeRgbaPng(2, 1, Buffer.alloc(8, 255));
  await writeFile(join(directory, 'second-photo.png'), foreign);
  const before = await readFile(options.boardFile, 'utf8');
  await assert.rejects(importIncomingLetters(file, options), /dimensions or SHA-256/);
  assert.equal(await readFile(options.boardFile, 'utf8'), before);
  assert.deepEqual(await readdir(directory), ['second-photo.png']);
  assert.deepEqual(await readFile(join(directory, 'second-photo.png')), foreign);
});

test('foreign preparation and Board locks survive rejected imports and retries remain safe', async (t) => {
  const { file, options, save } = await fixture(t);
  await save([letter()]);
  const before = await readFile(options.boardFile, 'utf8');
  const prepareLock = join(options.localDirectory, '.prepare-lock');
  await writeFile(prepareLock, 'foreign preparation journal lock');
  await assert.rejects(importIncomingLetters(file, options), /Another asset preparation/);
  assert.equal(await readFile(prepareLock, 'utf8'), 'foreign preparation journal lock');
  await rm(prepareLock);
  const boardLock = `${options.boardFile}.lock`;
  await mkdir(boardLock);
  await writeFile(join(boardLock, 'owner'), 'foreign writer');
  await assert.rejects(importIncomingLetters(file, options), { code: 'EEXIST' });
  await assert.rejects(writeMessageBoard(options.boardFile, { version: 1, memos: [] }), { code: 'EEXIST' });
  assert.equal(await readFile(join(boardLock, 'owner'), 'utf8'), 'foreign writer');
  assert.equal(await readFile(options.boardFile, 'utf8'), before);
  await rm(boardLock, { recursive: true });
  assert.equal((await importIncomingLetters(file, options)).memos.length, 2);
});

test('malformed existing Board data cannot be replaced by an import or ordinary save', async (t) => {
  const { file, options, save, png } = await fixture(t);
  const { photo } = await png();
  await save([letter('with-photo', { photo })]);
  await writeFile(options.boardFile, '{ malformed');
  await assert.rejects(importIncomingLetters(file, options));
  await assert.rejects(writeMessageBoard(options.boardFile, { version: 1, memos: [] }));
  assert.equal(await readFile(options.boardFile, 'utf8'), '{ malformed');
  await assert.rejects(readFile(join(options.assets, 'local-letters/photo-one.png')), { code: 'ENOENT' });
});

test('CLI imports an isolated fixture and returns failure without changing conflicting data', async (t) => {
  const { file, options, save } = await fixture(t);
  await save([letter()]);
  const args = [cli, 'import', file, '--board', options.boardFile, '--assets', options.assets,
    '--local-dir', options.localDirectory];
  const result = await run(process.execPath, args);
  assert.match(result.stdout, /1 total.*Reload/);
  const before = await readFile(options.boardFile, 'utf8');
  await save([letter('incoming-one', { header: 'Conflicting header' })]);
  await assert.rejects(run(process.execPath, args), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Conflicting Message Board content/);
    return true;
  });
  assert.equal(await readFile(options.boardFile, 'utf8'), before);
});

test('explicit thumbnail import publishes both immutable pixels before the Board and preserves shared images',
  async (t) => {
    const { file, options, save, png, thumbnail } = await fixture(t);
    const full = await png();
    const small = await thumbnail(full.photo);
    await save([letter('legacy-photo', { photo: full.photo })]);
    await importIncomingLetters(file, options);
    await save([letter('thumbnail-one', { photo: small.photo }), letter('thumbnail-two', { photo: small.photo })]);
    const state = await importIncomingLetters(file, options);
    assert.equal(state.memos.length, 4);
    assert.deepEqual(state.memos[1].photo, full.photo, 'an older photo-only descriptor stays unchanged');
    assert.deepEqual(state.memos[2].photo, small.photo);
    const directory = join(options.assets, 'local-letters');
    assert.deepEqual(await readFile(join(directory, 'photo-one.png')), full.bytes);
    assert.deepEqual(await readFile(join(directory, 'thumbnails/photo-one.png')), small.bytes);
    const before = await readFile(options.boardFile, 'utf8');
    await importIncomingLetters(file, options);
    assert.equal(await readFile(options.boardFile, 'utf8'), before);
    await eraseIncomingLetter(options.boardFile, { version: 1, id: 'thumbnail-one' });
    assert.deepEqual(await readFile(join(directory, 'thumbnails/photo-one.png')), small.bytes);
    assert.equal((await readMessageBoard(options.boardFile)).memos.at(-1).id, 'thumbnail-two');
    assert.deepEqual(await readdir(directory), ['photo-one.png', 'thumbnails']);
    assert.deepEqual(await readdir(join(directory, 'thumbnails')), ['photo-one.png']);
    assert.deepEqual(await readdir(options.localDirectory), ['message-board.json']);
  });

test('missing or mismatched thumbnail bytes reject the import before publishing full photos or state',
  async (t) => {
    const { file, options, save, png, thumbnail } = await fixture(t);
    const full = await png();
    const small = await thumbnail(full.photo);
    const before = await readFile(options.boardFile, 'utf8');
    const input = join(options.photoDirectory, 'thumbnails/photo-one.png');
    for (const bytes of [full.bytes, encodeRgbaPng(64, 48, Buffer.alloc(64 * 48 * 4))]) {
      await writeFile(input, bytes);
      await save([letter('thumbnail', { photo: small.photo })]);
      await assert.rejects(importIncomingLetters(file, options), /dimensions or SHA-256/);
    }
    await rm(input);
    await assert.rejects(importIncomingLetters(file, options), { code: 'ENOENT' });
    assert.equal(await readFile(options.boardFile, 'utf8'), before);
    await assert.rejects(readFile(join(options.assets, 'local-letters/photo-one.png')), { code: 'ENOENT' });
  });

test('thumbnail directory symlinks and foreign pixels remain untouched after rejected publication',
  async (t) => {
    const { root, file, options, save, png, thumbnail } = await fixture(t);
    const { photo } = await png();
    const small = await thumbnail(photo);
    await save([letter('thumbnail', { photo: small.photo })]);
    const before = await readFile(options.boardFile, 'utf8');
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'photo-one.png'), small.bytes);
    const sourceDirectory = join(options.photoDirectory, 'thumbnails');
    await rm(sourceDirectory, { recursive: true });
    await symlink(outside, sourceDirectory);
    await assert.rejects(importIncomingLetters(file, options), /regular directory/);
    await rm(sourceDirectory);
    await thumbnail(photo);
    const destinationDirectory = join(options.assets, 'local-letters/thumbnails');
    await mkdir(join(options.assets, 'local-letters'), { recursive: true });
    await symlink(outside, destinationDirectory);
    await assert.rejects(importIncomingLetters(file, options), /regular directory/);
    await rm(destinationDirectory);
    await mkdir(destinationDirectory);
    const foreign = encodeRgbaPng(64, 48, Buffer.alloc(64 * 48 * 4));
    await writeFile(join(destinationDirectory, 'photo-one.png'), foreign);
    await assert.rejects(importIncomingLetters(file, options), /dimensions or SHA-256/);
    assert.equal(await readFile(options.boardFile, 'utf8'), before);
    assert.deepEqual(await readFile(join(destinationDirectory, 'photo-one.png')), foreign);
    assert.deepEqual(await readFile(join(outside, 'photo-one.png')), small.bytes);
    await assert.rejects(readFile(join(options.assets, 'local-letters/photo-one.png')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(options.localDirectory), ['message-board.json']);
  });

test('a thumbnail cannot silently change the metadata of an already imported Letter', async (t) => {
  const { file, options, save, png, thumbnail } = await fixture(t);
  const { photo } = await png();
  await save([letter('immutable-letter', { photo })]);
  await importIncomingLetters(file, options);
  const before = await readFile(options.boardFile, 'utf8');
  const small = await thumbnail(photo);
  await save([letter('immutable-letter', { photo: small.photo })]);
  await assert.rejects(importIncomingLetters(file, options), /Conflicting Message Board content/);
  assert.equal(await readFile(options.boardFile, 'utf8'), before);
  await assert.rejects(readFile(join(options.assets, 'local-letters/thumbnails/photo-one.png')), { code: 'ENOENT' });
});
