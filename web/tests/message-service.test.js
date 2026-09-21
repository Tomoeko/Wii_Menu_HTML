import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultMessageFixture,
  MAX_LOCAL_LETTER_UNITS,
  readLocalLetterOutbox,
  validateLetterOutbox,
  validateLocalAttachment,
  validateLocalLetter,
  validateMessageFixture,
} from '../src/message-service.js';
import { appendLocalLetter, readLetterOutbox, readMessageFixture } from '../../tools/message-service.mjs';

function letter(id, text = 'Synthetic local Letter') {
  return {
    id,
    recipient: { kind: 'email', address: 'fixture@example.invalid', nickname: 'Fixture' },
    text,
    attachment: null,
  };
}

const attachment = {
  id: 'fixture-photo', width: 512, height: 256,
  localSrc: '/assets/local-letters/fixture-photo.png', sha256: 'a'.repeat(64),
};

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'local-letter-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('local Letter fixture is opt-in and validates bounded text and recipient data', () => {
  assert.deepEqual(defaultMessageFixture(), {
    version: 1, letterService: 'offline', localRegistration: false, ownWiiNumber: null,
  });
  assert.deepEqual(validateMessageFixture({ version: 1, letterService: 'local' }), {
    version: 1, letterService: 'local', localRegistration: false, ownWiiNumber: null,
  });
  assert.throws(() => validateMessageFixture({ version: 1, letterService: 'network' }));
  assert.deepEqual(validateMessageFixture({
    version: 1, letterService: 'offline', localRegistration: true,
  }), { version: 1, letterService: 'offline', localRegistration: true, ownWiiNumber: null });
  for (const localRegistration of [null, 1, 'true', {}]) {
    assert.throws(() => validateMessageFixture({
      version: 1, letterService: 'local', localRegistration,
    }));
  }
  const value = letter('boundary', 'A'.repeat(MAX_LOCAL_LETTER_UNITS));
  assert.deepEqual(validateLocalLetter(value), value);
  assert.throws(() => validateLocalLetter({ ...value, text: value.text + 'A' }));
  assert.throws(() => validateLocalLetter({ ...value, text: '' }));
  assert.throws(() => validateLocalLetter({ ...value, attachment: { url: 'https://example.invalid' } }));
  assert.deepEqual(validateLocalAttachment(attachment), attachment);
  assert.deepEqual(validateLocalLetter({ ...value, text: '', attachment }), {
    ...value, text: '', attachment,
  });
  assert.throws(() => validateLocalAttachment({ ...attachment, width: 513 }));
  assert.throws(() => validateLocalAttachment({ ...attachment,
    localSrc: '/assets/local-letters/fixture-photo.jpg' }));
  assert.throws(() => validateLocalLetter({ ...value, id: '../foreign' }));
  assert.throws(() => validateLocalLetter({
    ...value, recipient: { ...value.recipient, address: 'two\nrecipients@example.invalid' },
  }));
  const saved = { ...value, createdAt: '2026-09-21T12:00:00.000Z' };
  assert.throws(() => validateLetterOutbox({ version: 1, letters: [saved, saved] }));
});

test('local outbox records adapt to read-only Board Letters without exposing delivery semantics', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    version: 1,
    letters: [{ ...letter('sent-letter'), createdAt: '2026-09-21T12:00:00.000Z' }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    assert.deepEqual(await readLocalLetterOutbox(), [{
      kind: 'letter', id: 'outbox-sent-letter', origin: 'outbox',
      createdAt: '2026-09-21T12:00:00.000Z', header: 'To Fixture',
      text: 'Synthetic local Letter', sender: null, replyAllowed: false, photo: null,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent local Letters append without loss and retries preserve one original record', async (t) => {
  const root = await directory(t);
  const file = join(root, 'letter-outbox.json');
  assert.deepEqual(await readMessageFixture(join(root, 'message-fixture.json')), defaultMessageFixture());
  await writeFile(join(root, 'message-fixture.json'), JSON.stringify({
    version: 1, letterService: 'local', localRegistration: true,
  }));
  assert.equal((await readMessageFixture(join(root, 'message-fixture.json'))).localRegistration, true);
  const [first, second] = await Promise.all([
    appendLocalLetter(file, letter('first')),
    appendLocalLetter(file, letter('second')),
  ]);
  assert.deepEqual((await readLetterOutbox(file)).letters, [first, second]);
  const before = await readFile(file, 'utf8');
  assert.deepEqual(await appendLocalLetter(file, letter('first')), first);
  assert.equal(await readFile(file, 'utf8'), before);
  await assert.rejects(appendLocalLetter(file, letter('first', 'Different contents')));
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual((await readdir(root)).sort(), ['letter-outbox.json', 'message-fixture.json']);
});

test('console number is an explicit optional fixture and never tightens existing Letter recipients', () => {
  const ownWiiNumber = '7053433507880718'; // Generated, unassigned checksum fixture.
  assert.equal(validateMessageFixture({
    version: 1, letterService: 'offline', ownWiiNumber,
  }).ownWiiNumber, ownWiiNumber);
  assert.equal(validateMessageFixture({
    version: 1, letterService: 'local', ownWiiNumber: null,
  }).ownWiiNumber, null);
  for (const invalid of ['1234567812345678', '0000000000000000', 7053433507880718, '', {}]) {
    assert.throws(() => validateMessageFixture({
      version: 1, letterService: 'local', ownWiiNumber: invalid,
    }));
  }
  const legacy = { ...letter('legacy-contact'),
    recipient: { kind: 'wii', address: '1234567812345678', nickname: 'Legacy' } };
  assert.deepEqual(validateLocalLetter(legacy), legacy);
});

test('corruption and a foreign writer leave the local outbox intact', async (t) => {
  const root = await directory(t);
  const file = join(root, 'letter-outbox.json');
  await writeFile(file, '{ malformed');
  await assert.rejects(appendLocalLetter(file, letter('first')));
  assert.equal(await readFile(file, 'utf8'), '{ malformed');
  await rm(file);
  await mkdir(file + '.lock');
  await writeFile(join(file + '.lock', 'owner'), 'foreign');
  await assert.rejects(appendLocalLetter(file, letter('first')));
  assert.equal(await readFile(join(file + '.lock', 'owner'), 'utf8'), 'foreign');
  assert.deepEqual(await readLetterOutbox(file), { version: 1, letters: [] });
});
