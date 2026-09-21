import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createNativeDictionaryProvider,
  loadEmbeddedDictionaries,
} from '../src/native-dictionary.js';
import { createDictionaryService } from '../../tools/dictionary-service.mjs';

test('browser dictionary provider sends bounded data to its local endpoint and rejects unavailability', async () => {
  let request;
  const provider = createNativeDictionaryProvider({
    fetcher: async (url, options) => {
      request = { url, ...options };
      return { ok: true, json: async () => ({ engine: 'original-zi8', candidates: ['word'] }) };
    },
  });
  assert.deepEqual(await provider('wo', { language: 'fr', digits: '96' }), {
    engine: 'original-zi8',
    candidates: ['word'],
  });
  assert.equal(request.url, '/api/dictionary');
  assert.deepEqual(JSON.parse(request.body), { text: 'wo', language: 'fr', digits: '96' });
  const missing = createNativeDictionaryProvider({
    fetcher: async () => ({ ok: false, json: async () => ({ error: 'Dependency unavailable' }) }),
  });
  await assert.rejects(missing('wo'), /Dependency unavailable/);
});

test('browser dictionary provider uses prepared word lists when native Zi8 is unavailable', async () => {
  let requests = 0;
  const provider = createNativeDictionaryProvider({
    fallbackDictionaries: { en: ['hello', 'help', 'world'] },
    fetcher: async () => {
      requests++;
      return {
        ok: false,
        json: async () => ({ error: 'Native runtime unavailable' }),
      };
    },
  });
  const session = provider.createSession();
  assert.deepEqual(await session('hel'), {
    engine: 'embedded-word-list',
    candidates: ['hello', 'help'],
  });
  assert.deepEqual(await session('wor'), {
    engine: 'embedded-word-list',
    candidates: ['work', 'world'],
  });
  assert.equal(requests, 1, 'a failed native worker should not be restarted per keystroke');
  await session.close();
});

test('embedded dictionary loader reads generated OEM word lists', async () => {
  const requests = [];
  const dictionaries = await loadEmbeddedDictionaries({
    manifestUrl: '/assets/keyboard-dictionary.json',
    fetcher: async (url) => {
      requests.push(url);
      if (url.endsWith('keyboard-dictionary.json')) {
        return {
          ok: true,
          json: async () => ({
            languages: {
              en: { oem: { wordsUrl: 'keyboard-dictionary/en-oem.json' } },
              fr: { oem: { wordsUrl: '/assets/keyboard-dictionary/fr-oem.json' } },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ words: [url.includes('/fr-') ? 'bonjour' : 'hello'] }),
      };
    },
  });
  assert.deepEqual(dictionaries, { en: ['hello'], fr: ['bonjour'] });
  assert.equal(requests[0], '/assets/keyboard-dictionary.json');
  assert.deepEqual(requests.slice(1).sort(), [
    '/assets/keyboard-dictionary/en-oem.json',
    '/assets/keyboard-dictionary/fr-oem.json',
  ]);
});

test('dictionary service validates requests before starting its worker', async () => {
  const service = createDictionaryService({ python: 'does-not-exist' });
  await assert.rejects(service.query({ text: 'x'.repeat(64) }), /Invalid dictionary input/);
  await assert.rejects(
    service.query({ text: 'a', language: 'unknown' }),
    /Invalid dictionary input/,
  );
  await assert.rejects(service.query({ digits: '123a' }), /Invalid telephone/);
  await assert.rejects(service.query({ session: '../editor' }), /Invalid dictionary session/);
  await assert.rejects(service.query({ action: 'accept', index: 40 }), /Invalid dictionary action/);
  await assert.rejects(service.query({ case: 'mixed' }), /Invalid dictionary action/);
  service.close();
});

const available =
  existsSync(new URL('../../.local/dictionary-runtime/bin/python', import.meta.url)) &&
  existsSync(new URL('../public/assets/keyboard-dictionary.json', import.meta.url));
test(
  'original user-WAD Zi8 code reproduces Latin and telephone ordering in a persistent worker',
  { skip: !available },
  async () => {
    const service = createDictionaryService();
    try {
      const english = await service.query({ text: 'he' });
      assert.equal(english.engine, 'original-zi8');
      assert.deepEqual(english.candidates.slice(0, 4), ['he', 'here', 'help', 'hello']);
      const phone = await service.query({ digits: '666' });
      assert.deepEqual(phone.candidates.slice(0, 5), ['mom', 'mon', 'moo', 'nom', 'non']);
      for (const language of ['fr', 'es']) {
        const result = await service.query({ text: 'a', language });
        assert.equal(result.engine, 'original-zi8');
        assert.ok(result.candidates.length > 0);
      }
    } finally {
      service.close();
    }
  },
);

async function fakeDictionaryWorker(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-dictionary-worker-'));
  const worker = join(directory, 'worker.cjs');
  const state = join(directory, 'starts.txt');
  await writeFile(
    worker,
    `
const { appendFileSync } = require('node:fs');
const { createInterface } = require('node:readline');
appendFileSync(process.argv[process.argv.indexOf('--state') + 1], 'started\\n');
process.stdout.write(JSON.stringify({ ready: true }) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.text === 'exit') process.exit(1);
  if (request.text === 'hang') return;
  setTimeout(() => process.stdout.write(JSON.stringify({
    id: request.id,
    engine: 'original-zi8',
    candidates: [request.text],
  }) + '\\n'), request.text === 'delay' ? 100 : 0);
});
`,
  );
  const service = createDictionaryService({
    python: process.execPath,
    worker,
    state,
    timeout: 1000,
    ...options,
  });
  t.after(async () => {
    service.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { service, starts: async () => (await readFile(state, 'utf8')).trim().split('\n').length };
}

test('dictionary worker exit releases pending queries and starts a fresh worker on retry', async (t) => {
  const { service, starts } = await fakeDictionaryWorker(t);
  assert.deepEqual((await service.query({ text: 'first' })).candidates, ['first']);
  const stopped = service.query({ text: 'exit' });
  const concurrent = service.query({ text: 'delay' });
  await Promise.all([
    assert.rejects(stopped, /worker stopped/),
    assert.rejects(concurrent, /worker stopped/),
  ]);
  assert.deepEqual((await service.query({ text: 'retry' })).candidates, ['retry']);
  assert.equal(await starts(), 2);
});

test('dictionary timeouts can retry without old child callbacks stopping the replacement', async (t) => {
  const { service, starts } = await fakeDictionaryWorker(t, { timeout: 500 });
  await assert.rejects(service.query({ text: 'hang' }), /request timed out/);
  assert.deepEqual((await service.query({ text: 'retry' })).candidates, ['retry']);
  assert.equal(await starts(), 2);
});

test('dictionary queue is bounded and closing rejects both queued and future work', async (t) => {
  const { service } = await fakeDictionaryWorker(t, { maxPending: 2 });
  const first = assert.rejects(service.query({ text: 'hang' }), /service is closed/);
  const second = assert.rejects(service.query({ text: 'hang' }), /service is closed/);
  await assert.rejects(service.query({ text: 'excess' }), /queue is full/);
  service.close();
  await Promise.all([first, second]);
  await assert.rejects(service.query({ text: 'later' }), /service is closed/);
});


test('editor dictionary sessions serialize their commands and keep reopen state separate', async () => {
  const requests = [];
  let releaseFirst;
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  const provider = createNativeDictionaryProvider({
    fetcher: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      if (requests.length === 1) await firstResponse;
      return { ok: true, json: async () => ({ engine: 'original-zi8', candidates: [] }) };
    },
  });
  const first = provider.createSession();
  const querying = first('h');
  const accepting = first.accept(0);
  const resetting = first.reset();
  const closing = first.close();
  const reopened = provider.createSession();
  const next = reopened('b');
  await next;
  assert.deepEqual(requests.map((request) => request.text), ['h', 'b']);
  assert.notEqual(requests[0].session, requests[1].session);
  releaseFirst();
  await Promise.all([querying, accepting, resetting, closing]);
  assert.deepEqual(requests.slice(2).map((request) => request.action), ['accept', 'reset', 'close']);
  assert.ok(requests.slice(2).every((request) => request.session === requests[0].session));
  await assert.rejects(first('later'), /session is closed/);
});

test('original WithZi sessions replay correction, selection, telephone commands and language isolation',
  { skip: !available }, async () => {
    const service = createDictionaryService();
    try {
      const initial = await service.query({ session: 'memo', text: 'h' });
      const expected = await service.query({ session: 'memo', text: 'he' });
      await service.query({ session: 'nickname', text: 'bonjour', language: 'fr' });
      const corrected = await service.query({ session: 'memo', text: 'h' });
      assert.deepEqual(corrected, initial);
      const restored = await service.query({ session: 'memo', text: 'he' });
      assert.deepEqual(restored, expected);
      const selected = await service.query({ session: 'memo', action: 'accept', index: 3 });
      assert.equal(selected.accepted, 'hello');
      assert.deepEqual(selected.candidates, []);
      const phone = await service.query({ session: 'memo', digits: '6' });
      assert.deepEqual(phone.candidates, ['>', 'm', 'n', 'o', '6']);
      const command = await service.query({ session: 'memo', action: 'accept', index: 0 });
      assert.equal(command.accepted, '>');
      const word = await service.query({ session: 'memo', digits: '666' });
      assert.deepEqual(word.candidates.slice(0, 5), ['mom', 'mon', 'moo', 'nom', 'non']);
      await service.query({ session: 'memo', action: 'reset' });
      const upper = await service.query({ session: 'memo', text: 'he', case: 'upper' });
      assert.deepEqual(upper.candidates.slice(0, 4), ['HE', 'HERE', 'HELP', 'HELLO']);
      const spanish = await service.query({ session: 'memo', text: 'hola', language: 'es' });
      assert.equal(spanish.candidates[0], 'hola');
      await service.query({ session: 'memo', action: 'close' });
      await assert.rejects(
        service.query({ session: 'memo', action: 'accept', index: 0 }), /no longer available/,
      );
      assert.deepEqual(await service.query({ session: 'memo', text: 'he' }), expected);
    } finally {
      service.close();
    }
  });

test('native session storage is bounded and recreates expired queries from their input snapshot',
  { skip: !available }, async () => {
    const service = createDictionaryService();
    try {
      const first = await service.query({ session: 'editor-0', text: 'he' });
      for (let index = 1; index <= 16; index++) {
        await service.query({ session: `editor-${index}`, text: 'a' });
      }
      await assert.rejects(
        service.query({ session: 'editor-0', action: 'accept', index: 0 }), /no longer available/,
      );
      assert.deepEqual(await service.query({ session: 'editor-0', text: 'he' }), first);
    } finally {
      service.close();
    }
  });


test('original Latin state stays in guest RAM and native saved preferences contain only eight bytes',
  { skip: !available }, async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const { stdout } = await promisify(execFile)(
      join(root, '.local/dictionary-runtime/bin/python'),
      [join(root, 'tools/dictionary/audit-state.py'),
        '--state', join(root, '.local/prepare.json'),
        '--assets', join(root, 'web/public/assets')],
      { cwd: root, timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    const report = JSON.parse(stdout);
    assert.deepEqual(report.guestWritesOutsideRegions, []);
    assert.ok(report.guestWritesByRegion['engine-context'] > 0);
    assert.ok(report.guestWritesByRegion['wrapper-globals'] > 0);
    for (const result of report.queries) {
      assert.equal(result.candidatesUnchangedAfterReopen, true, result.language);
      assert.equal(result.userWordAttachmentBytes, '00'.repeat(0x18), result.language);
    }
    assert.equal(report.highlightedWord.storedInsideContext, true);
    assert.equal(report.highlightedWord.clearedByOriginalInitialize, true);
    assert.equal(report.syntheticSave.magic, 'RIPL');
    assert.equal(report.syntheticSave.fileSize, 0x4c0);
    assert.equal(report.syntheticSave.version, 3);
    assert.equal(report.syntheticSave.preferenceSize, 8);
    assert.equal(report.syntheticSave.defaultPreferenceHex, '11fa000090100000');
    assert.equal(report.syntheticSave.preferenceCopyExact, true);
    assert.equal(report.syntheticSave.md5InputSize, 0x4b0);
    assert.equal(report.syntheticSave.md5MatchesHost, true);
  });
