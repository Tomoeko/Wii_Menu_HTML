import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-server-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const relative of [
    'tools/serve.mjs',
    'tools/configuration.mjs',
    'tools/graphics-settings.mjs',
    'tools/local-state.mjs',
    'tools/storage-state.mjs',
    'tools/remote-state.mjs',
    'tools/validated-json-state.mjs',
    'tools/format-json.mjs',
    'tools/message-service.mjs',
    'tools/channel-manager.mjs',
    'tools/channel-updates.mjs',
    'tools/channel-recovery.mjs',
    'tools/channel-purge.mjs',
    'tools/channel-image.mjs',
    'tools/channel-artwork.mjs',
    'tools/gif-image.mjs',
    'tools/channels.mjs',
    'tools/custom-channels.mjs',
    'tools/custom-channel-schema.mjs',
    'tools/custom-channel-audio.mjs',
    'tools/channel-image.mjs',
    'tools/channel-artwork.mjs',
    'tools/gif-image.mjs',
    'web/src/channel-catalog.js',
    'web/src/graphics.js',
    'web/src/image-format.js',
    'web/src/channel-selection.js',
    'web/src/image-format.js',
    'web/src/channel-storage.js',
    'web/src/storage-state.js',
    'web/src/remote-state.js',
    'web/src/message-service.js',
    'web/src/address-validation.js',
    'web/src/incoming-letter-fixture.js',
    'web/src/message-board-merge.js',
    'templates/custom-channel/channel.json',
    'templates/custom-channel/icon.json',
    'templates/custom-channel/banner.json',
    'templates/custom-channel/README.md',
  ]) {
    await mkdir(dirname(join(directory, relative)), { recursive: true });
    await copyFile(join(project, relative), join(directory, relative));
  }
  const files = {
    'package.json': JSON.stringify({ type: 'module' }),
    'config.json': JSON.stringify({ audio: { enabled: false } }),
    'web/index.html': '<!doctype html><title>Test menu</title>',
    'web/public/assets/settings/fixture.html':
      '<!doctype html><title>Original engine fixture</title>',
    'web/public/assets/settings-raw/fixture.html':
      '<!doctype html><title>Unmodified original engine fixture</title>',
    'web/public/assets/settings/fixture.js': 'setTimeout("void 0", 0);',
    'web/public/assets/settings/fixture.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"></svg>',
    'web/public/assets/fonts/fixture.ttf': 'synthetic font header fixture',
    'web/public/assets/guide.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"></svg>',
    '.local/private.json': 'PRIVATE_TEST_MARKER',
  };
  for (const [relative, value] of Object.entries(files)) {
    await mkdir(dirname(join(directory, relative)), { recursive: true });
    await writeFile(join(directory, relative), value);
  }
  await symlink(
    join(directory, '.local/private.json'),
    join(directory, 'web/public/assets/private-link.json'),
  );
  const port = await unusedPort();
  const child = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: directory,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture server did not start')), 5000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Fixture server exited: ' + errors));
    });
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Wii menu:')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  function request(path, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        },
      );
      req.on('error', reject);
      if (Array.isArray(body)) {
        for (const chunk of body) req.write(chunk);
        req.end();
      } else req.end(body);
    });
  }
  return { directory, port, request };
}

test('graphics API saves only its validated section and enforces local mutation ownership', async (t) => {
  const { directory, port, request } = await fixture(t);
  const configFile = join(directory, 'config.json');
  const graphics = {
    resolutionScale: 2, antiAliasing: 'post-process', colorCorrection: 'gamma', sourceGamma: 2.35,
  };
  const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
  const initial = await request('/api/graphics');
  assert.equal(initial.status, 200);
  assert.equal(JSON.parse(initial.text).graphics.resolutionScale, 1);
  assert.equal(initial.headers['cache-control'], 'no-store');
  const before = await readFile(configFile, 'utf8');
  assert.equal((await request('/api/graphics', {
    method: 'PUT', body: JSON.stringify(graphics),
  })).status, 403);
  assert.equal((await request('/api/graphics', {
    method: 'PUT', headers: { ...headers, Origin: 'https://foreign.invalid' },
    body: JSON.stringify(graphics),
  })).status, 403);
  for (const body of [JSON.stringify({ ...graphics, channels: {} }), '{broken',
    ' '.repeat(2049), Buffer.from([0xff])]) {
    const rejected = await request('/api/graphics', { method: 'PUT', headers, body });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.text.includes(directory), false);
    assert.equal(await readFile(configFile, 'utf8'), before);
  }
  assert.equal((await request('/api/graphics', { method: 'POST', headers, body: '{}' })).status, 405);
  await mkdir(`${configFile}.channels.lock`);
  const busy = await request('/api/graphics', {
    method: 'PUT', headers, body: JSON.stringify(graphics),
  });
  assert.equal(busy.status, 409);
  assert.equal(await readFile(configFile, 'utf8'), before);
  await rm(`${configFile}.channels.lock`, { recursive: true });
  const saved = await request('/api/graphics', {
    method: 'PUT', headers, body: JSON.stringify(graphics),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(saved.text), { graphics });
  assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')), {
    audio: { enabled: false }, graphics,
  });
  assert.deepEqual(JSON.parse((await request('/api/graphics')).text), { graphics });
});

test('local server rejects foreign Host and prevents traversal/symlink disclosure', async (t) => {
  const { port, request } = await fixture(t);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/', { headers: { Host: 'localhost:' + port } })).status, 200);
  for (const host of [
    'remote.example:' + port,
    '127.0.0.1.attacker.example:' + port,
    'localhost',
  ]) {
    assert.equal((await request('/api/message-board', { headers: { Host: host } })).status, 403);
  }
  for (const path of [
    '/%2e%2e%2f.local/private.json',
    '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f.local/private.json',
    '/assets/private-link.json',
    '/%00',
    '/%invalid',
  ]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.ok(!response.text.includes('PRIVATE_TEST_MARKER'), path);
  }
});

test('channel manager routes use isolated source templates and never serve retained authoring files', async (t) => {
  const { directory, port, request } = await fixture(t);
  const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
  const create = await request('/api/channels/custom', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 'custom-local', title: 'Local Test' }),
  });
  assert.equal(create.status, 201);
  assert.equal(JSON.parse(create.text).channel.id, 'custom-local');
  assert.equal((await request('/api/channels')).status, 200);
  assert.equal(
    (await request('/api/channels/custom-local', { method: 'DELETE', headers })).status,
    405,
  );
  for (const path of [
    '/.local/custom-channels/custom-local/channel.json',
    '/assets/../../.local/custom-channels/custom-local/channel.json',
    '/templates/custom-channel/channel.json',
  ])
    assert.equal((await request(path)).status, 404);
  const retained = JSON.parse(
    await readFile(join(directory, '.local/custom-channels/custom-local/channel.json'), 'utf8'),
  );
  assert.equal(retained.title, 'Local Test');
  const disable = await request('/api/channels/custom-local/enabled', {
    method: 'PUT',
    headers: { ...headers, Host: `localhost:${port}`, Origin: `http://localhost:${port}` },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disable.status, 200);
  assert.equal(JSON.parse(disable.text).channel.status, 'disabled');
});

test('foreign-origin writes leave local layout and Memo records unchanged', async (t) => {
  const { directory, port, request } = await fixture(t);
  const origin = 'http://127.0.0.1:' + port;
  const cases = [
    [
      '/api/layout',
      '.local/channel-layout.json',
      {
        version: 1,
        slots: ['disc', ...Array(47).fill(null)],
      },
    ],
    ['/api/message-board', '.local/message-board.json', { version: 1, memos: [] }],
  ];
  for (const [path, relative, state] of cases) {
    const body = JSON.stringify(path === '/api/message-board' ? { ...state, base: [] } : state);
    assert.equal(
      (
        await request(path, {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body,
        })
      ).status,
      200,
    );
    const saved = await readFile(join(directory, relative), 'utf8');
    for (const foreign of ['https://remote.example', 'null', 'http://127.0.0.1:1', undefined]) {
      const response = await request(path, {
        method: 'PUT',
        headers: foreign ? { Origin: foreign } : {},
        body: JSON.stringify({ version: 999 }),
      });
      assert.equal(response.status, path === '/api/message-board' ? 400 : 404);
      assert.equal(await readFile(join(directory, relative), 'utf8'), saved);
    }
    const read = await request(path, { headers: { Origin: 'https://remote.example' } });
    assert.equal(read.headers['access-control-allow-origin'], undefined);
    assert.deepEqual(JSON.parse(read.text), JSON.parse(saved));
  }
  assert.equal(
    (
      await request('/__capture', {
        method: 'POST',
        headers: { Origin: 'https://remote.example' },
        body: '{}',
      })
    ).status,
    404,
  );
});

test('Settings resource policy permits original sandbox behavior without weakening main scripts', async (t) => {
  const { request } = await fixture(t);
  const main = await request('/');
  const settings = await request('/assets/settings/fixture.html');
  const rawSettings = await request('/assets/settings-raw/fixture.html');
  const script = await request('/assets/settings/fixture.js');
  const settingsSvg = await request('/assets/settings/fixture.svg');
  const font = await request('/assets/fonts/fixture.ttf');
  const guide = await request('/assets/guide.svg');
  for (const response of [main, settings, rawSettings, script, settingsSvg, font, guide]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers['cross-origin-resource-policy'], undefined);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.match(response.headers['content-security-policy'], /object-src 'none'/);
    assert.match(response.headers['content-security-policy'], /connect-src 'self'/);
  }
  assert.ok(!main.headers['content-security-policy'].includes("'unsafe-eval'"));
  assert.match(main.headers['content-security-policy'], /script-src 'self';/);
  assert.ok(!main.headers['content-security-policy'].includes('sandbox allow-scripts'));
  assert.match(settings.headers['content-security-policy'], /sandbox allow-scripts/);
  assert.match(rawSettings.headers['content-security-policy'], /sandbox allow-scripts/);
  assert.match(
    settings.headers['content-security-policy'],
    /script-src 'self' 'unsafe-inline' 'unsafe-eval'/,
  );
  assert.match(script.headers['content-security-policy'], /'unsafe-eval'/);
  assert.match(rawSettings.headers['content-security-policy'], /script-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(rawSettings.headers['content-security-policy'], /'unsafe-eval'/);
  assert.match(guide.headers['content-security-policy'], /script-src 'none'/);
  assert.match(guide.headers['content-security-policy'], /(?:^|; )sandbox(?:;|$)/);
  assert.match(settingsSvg.headers['content-security-policy'], /script-src 'none';/);
  assert.equal(script.headers['content-type'], 'text/javascript');
  assert.equal(font.headers['content-type'], 'font/ttf');
  assert.equal(font.headers['access-control-allow-origin'], '*');
  assert.equal(guide.headers['content-type'], 'image/svg+xml');
  assert.equal(main.headers['access-control-allow-origin'], undefined);
  const opaqueRead = await request('/api/graphics', { headers: { Origin: 'null' } });
  assert.equal(opaqueRead.status, 200);
  assert.equal(opaqueRead.headers['access-control-allow-origin'], undefined);
  const opaqueWrite = await request('/api/graphics', {
    method: 'PUT',
    headers: { Origin: 'null', 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolutionScale: 2 }),
  });
  assert.equal(opaqueWrite.status, 403);
});

test('comparison exports keep bounded sequence metadata beside their PNG', async (t) => {
  const { directory, port, request } = await fixture(t);
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const comparison = {
    flow: 'address-entry',
    frame: 3,
    sourceHash: 'fixture',
    state: { page: 'address' },
  };
  const send = (value) =>
    request('/__capture', {
      method: 'POST',
      headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        png,
        channel: 'create',
        kind: 'sequence',
        frame: 3,
        comparison: value,
      }),
    });
  const response = await send(comparison);
  assert.equal(response.status, 201);
  const path = JSON.parse(response.text).path.replace(/\.png$/, '.json');
  const metadata = JSON.parse(await readFile(join(directory, path), 'utf8'));
  assert.deepEqual(metadata.comparison, comparison);
  for (const invalid of [null, [], 'invalid', { oversized: 'x'.repeat(65537) }]) {
    assert.equal((await send(invalid)).status, 404);
  }
});

test('storage APIs persist readable SD state and refuse invalid writes or private malformed fixtures', async (t) => {
  const { directory, port, request } = await fixture(t);
  const initial = await request('/api/storage-state');
  assert.equal(initial.status, 200);
  const state = JSON.parse(initial.text);
  assert.deepEqual(state.sd, { page: 0, helpSeen: null });
  state.sd = { page: 19, helpSeen: true };
  state.tabs.gamecube = 'sd';
  const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
  const saved = await request('/api/storage-state', { method: 'PUT', headers, body: JSON.stringify(state) });
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(saved.text), state);
  const file = join(directory, '.local/storage-state.json');
  const bytes = await readFile(file, 'utf8');
  assert.equal(bytes, JSON.stringify(state, null, 2) + '\n');
  assert.deepEqual(JSON.parse((await request('/api/storage-state')).text), state);
  for (const badOrigin of [undefined, 'null', 'https://remote.example']) {
    assert.equal((await request('/api/storage-state', {
      method: 'PUT', headers: badOrigin ? { Origin: badOrigin } : {}, body: JSON.stringify(state),
    })).status, 403);
  }
  state.sd.page = 20;
  assert.equal((await request('/api/storage-state', { method: 'PUT', headers, body: JSON.stringify(state) })).status, 400);
  assert.equal(await readFile(file, 'utf8'), bytes);
  const fixtureRead = await request('/api/storage-fixture');
  assert.equal(fixtureRead.status, 200);
  const media = JSON.parse(fixtureRead.text);
  media.sd.status = 'read-error';
  await writeFile(join(directory, '.local/storage-fixture.json'), JSON.stringify(media, null, 2) + '\n');
  assert.deepEqual(JSON.parse((await request('/api/storage-fixture')).text), media);
  assert.equal((await request('/api/storage-fixture', { method: 'PUT', headers, body: '{}' })).status, 400);
  await writeFile(join(directory, '.local/storage-fixture.json'), 'PRIVATE_TEST_MARKER');
  const bad = await request('/api/storage-fixture');
  assert.equal(bad.status, 503);
  assert.ok(!bad.text.includes('PRIVATE_TEST_MARKER'));
  assert.ok(!bad.text.includes(directory));
});

test('remote fixture API persists validated state and preserves malformed user files', async (t) => {
  const { directory, port, request } = await fixture(t);
  assert.equal((await request('/api/remote-state')).text, 'null');
  const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
  const state = {
    version: 1, volume: 0.4, rumble: false,
    controllers: Array.from({ length: 4 }, (_, index) => ({ connected: index < 2, battery: index })),
  };
  assert.equal((await request('/api/remote-state', {
    method: 'PUT', headers, body: JSON.stringify(state),
  })).status, 200);
  assert.deepEqual(JSON.parse((await request('/api/remote-state')).text), state);
  assert.equal((await request('/api/remote-state', {
    method: 'PUT', headers: { Origin: 'http://foreign.example' }, body: JSON.stringify(state),
  })).status, 403);
  assert.equal((await request('/api/remote-state', {
    method: 'PUT', headers, body: JSON.stringify({ ...state, volume: 2 }),
  })).status, 400);
  const file = join(directory, '.local/remote-state.json');
  await writeFile(file, '{ PRIVATE_REMOTE_MARKER');
  const response = await request('/api/remote-state');
  assert.equal(response.status, 503);
  assert.equal(response.text.includes('PRIVATE_REMOTE_MARKER'), false);
  assert.equal((await request('/api/remote-state', {
    method: 'PUT', headers, body: JSON.stringify(state),
  })).status, 400);
  assert.equal(await readFile(file, 'utf8'), '{ PRIVATE_REMOTE_MARKER');
});

test('Letter outbox is explicitly local, opt-in and idempotent', async (t) => {
  const { directory, port, request } = await fixture(t);
  const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
  const letter = {
    id: 'synthetic-request',
    recipient: { kind: 'email', address: 'fixture@example.invalid', nickname: 'Fixture' },
    text: 'This fixture never leaves the local server.',
    attachment: null,
  };
  const post = (value = letter) => request('/api/letter-outbox', {
    method: 'POST', headers, body: JSON.stringify(value),
  });
  assert.deepEqual(JSON.parse((await request('/api/message-fixture')).text), {
    version: 1, letterService: 'offline', localRegistration: false, ownWiiNumber: null,
  });
  assert.equal((await post()).status, 400);
  assert.deepEqual(JSON.parse((await request('/api/letter-outbox')).text), {
    version: 1, letters: [],
  });
  await writeFile(join(directory, '.local/message-fixture.json'), JSON.stringify({
    version: 1, letterService: 'local',
  }));
  assert.equal((await request('/api/letter-outbox', {
    method: 'POST', headers: { Origin: 'http://foreign.example' }, body: JSON.stringify(letter),
  })).status, 403);
  const first = await post();
  assert.equal(first.status, 200);
  assert.equal((await post()).text, first.text);
  assert.equal((await post({ ...letter, text: 'Conflicting retry' })).status, 400);
  assert.equal((await post({ ...letter, id: 'attachment', attachment: 'unsupported' })).status, 400);
  const outbox = JSON.parse((await request('/api/letter-outbox')).text);
  assert.deepEqual(outbox.letters, [JSON.parse(first.text)]);
  const file = join(directory, '.local/letter-outbox.json');
  await writeFile(file, '{ PRIVATE_OUTBOX_MARKER');
  assert.equal((await post()).status, 400);
  const unreadable = await request('/api/letter-outbox');
  assert.equal(unreadable.status, 503);
  assert.equal(unreadable.text.includes('PRIVATE_OUTBOX_MARKER'), false);
  assert.equal(await readFile(file, 'utf8'), '{ PRIVATE_OUTBOX_MARKER');
});

test('incoming Letter erase requires a local explicit ID and cannot erase Memos or resurrect imports',
  async (t) => {
    const { directory, port, request } = await fixture(t);
    const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
    const letter = {
      kind: 'letter', id: 'synthetic-import', createdAt: '2026-09-21T12:00:00.000Z',
      header: 'Fixture sender', text: 'Locally imported text', readAt: null, photo: null,
      sender: { kind: 'wii', address: '1234567812345678', nickname: 'Fixture' },
    };
    const memo = { id: 'synthetic-memo', text: 'Retain this Memo',
      createdAt: letter.createdAt, readAt: null };
    const file = join(directory, '.local/message-board.json');
    const original = { version: 1, memos: [memo, letter] };
    await writeFile(file, JSON.stringify(original, null, 2) + '\n');
    const path = '/api/message-board/erase-letter';
    const body = JSON.stringify({ version: 1, id: letter.id });
    for (const origin of [undefined, 'null', 'https://foreign.example']) {
      assert.equal((await request(path, {
        method: 'POST', headers: origin ? { Origin: origin } : {}, body,
      })).status, 403);
    }
    assert.equal((await request(path, { headers })).status, 400);
    for (const value of [{ version: 1, id: memo.id }, { version: 1, id: '../private' },
      { version: 1, id: letter.id, all: true }]) {
      assert.equal((await request(path, {
        method: 'POST', headers, body: JSON.stringify(value),
      })).status, 400);
    }
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), original);
    const first = await request(path, { method: 'POST', headers, body });
    assert.equal(first.status, 200);
    assert.deepEqual(JSON.parse(first.text), { version: 1, id: letter.id, erased: true });
    const retry = await request(path, { method: 'POST', headers, body });
    assert.deepEqual(JSON.parse(retry.text), { version: 1, id: letter.id, erased: false });
    assert.equal((await request('/api/message-board', {
      method: 'PUT', headers, body: JSON.stringify({ ...original, base: original.memos }),
    })).status, 200);
    assert.deepEqual(JSON.parse((await request('/api/message-board')).text),
      { version: 1, memos: [memo] });
  });

test('Board saves and explicit erase accept matching localhost origin without admitting foreign origins',
  async (t) => {
    const { directory, port, request } = await fixture(t);
    const headers = { Host: `localhost:${port}`, Origin: `http://localhost:${port}`,
      'Content-Type': 'application/json' };
    const state = { version: 1, memos: [{ id: 'localhost-memo', text: 'Synthetic Memo',
      createdAt: '2026-09-21T12:00:00.000Z', readAt: null }] };
    const save = await request('/api/message-board', {
      method: 'PUT', headers, body: JSON.stringify({ ...state, base: [] }),
    });
    assert.equal(save.status, 200);
    const file = join(directory, '.local/message-board.json');
    const before = await readFile(file, 'utf8');
    const badHeaders = { ...headers, Origin: 'http://foreign.example' };
    assert.equal((await request('/api/message-board', {
      method: 'PUT', headers: badHeaders, body: JSON.stringify({ version: 1, memos: [] }),
    })).status, 400);
    assert.equal((await request('/api/message-board/erase-letter', {
      method: 'POST', headers: badHeaders, body: JSON.stringify({ version: 1, id: 'absent-letter' }),
    })).status, 403);
    assert.equal(await readFile(file, 'utf8'), before);
    const erased = await request('/api/message-board/erase-letter', {
      method: 'POST', headers, body: JSON.stringify({ version: 1, id: 'absent-letter' }),
    });
    assert.equal(erased.status, 200);
    assert.deepEqual(JSON.parse(erased.text), { version: 1, id: 'absent-letter', erased: false });
  });

test('browser Board API merges accepted bases, reports conflicts and explicitly erases only Memos',
  async (t) => {
    const { directory, port, request } = await fixture(t);
    const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
    const memo = { id: 'merge-memo', text: 'Synthetic Memo',
      createdAt: '2026-09-21T12:00:00.000Z', readAt: null, position: { x: 0, y: 20 } };
    const save = (base, memos) => request('/api/message-board', {
      method: 'PUT', headers, body: JSON.stringify({ version: 1, base, memos }),
    });
    assert.equal((await request('/api/message-board', {
      method: 'PUT', headers, body: JSON.stringify({ version: 1, memos: [memo] }),
    })).status, 400);
    assert.equal((await save([], [memo])).status, 200);
    const read = await request('/api/message-board');
    const base = JSON.parse(read.text).memos;
    const posted = { ...memo, id: 'second-tab-post' };
    assert.equal((await save(base, [...base, posted])).status, 200);
    const moved = { ...memo, position: { x: 25, y: 20 } };
    assert.equal((await save(base, [moved])).status, 200);
    assert.deepEqual(JSON.parse((await request('/api/message-board')).text).memos, [moved, posted]);
    assert.equal((await save(base, [{ ...memo, position: { x: 50, y: 20 } }])).status, 409);
    const erase = (id) => request('/api/message-board/erase-memo', {
      method: 'POST', headers, body: JSON.stringify({ version: 1, id }),
    });
    assert.deepEqual(JSON.parse((await erase(memo.id)).text),
      { version: 1, id: memo.id, erased: true });
    assert.equal((await save(base, [memo])).status, 200);
    assert.deepEqual(JSON.parse((await request('/api/message-board')).text).memos, [posted]);
    assert.deepEqual(JSON.parse((await erase(memo.id)).text),
      { version: 1, id: memo.id, erased: false });
    const incoming = { ...memo, kind: 'letter', id: 'kind-guard', header: 'Synthetic sender',
      sender: { kind: 'wii', address: '1234567812345678', nickname: 'Fixture' }, photo: null };
    const file = join(directory, '.local/message-board.json');
    await writeFile(file, JSON.stringify({ version: 1, memos: [posted, incoming] }));
    const before = await readFile(file, 'utf8');
    assert.equal((await erase(incoming.id)).status, 400);
    assert.equal(await readFile(file, 'utf8'), before);
  });

test('Board requests preserve UTF-8 split across HTTP chunks and reject malformed byte sequences',
  async (t) => {
    const { directory, port, request } = await fixture(t);
    const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
    const memo = { id: 'unicode-終', text: 'Synthetic 😀é終 text',
      createdAt: '2026-09-21T12:00:00.000Z', readAt: null };
    const bytes = Buffer.from(JSON.stringify({ version: 1, base: [], memos: [memo] }));
    const emoji = bytes.indexOf(Buffer.from('😀'));
    const result = await request('/api/message-board', {
      method: 'PUT', headers,
      body: [bytes.subarray(0, emoji + 1), bytes.subarray(emoji + 1, emoji + 3), bytes.subarray(emoji + 3)],
    });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.text).memos, [memo]);
    const file = join(directory, '.local/message-board.json');
    const before = await readFile(file);
    const malformed = Buffer.from(bytes);
    malformed[emoji] = 0xff;
    assert.equal((await request('/api/message-board', {
      method: 'PUT', headers, body: malformed,
    })).status, 400);
    assert.deepEqual(await readFile(file), before);
    const erase = Buffer.from(JSON.stringify({ version: 1, id: memo.id }));
    const split = erase.indexOf(Buffer.from('終')) + 1;
    assert.equal((await request('/api/message-board/erase-memo', {
      method: 'POST', headers, body: [erase.subarray(0, split), erase.subarray(split)],
    })).status, 200);
    assert.deepEqual(JSON.parse((await request('/api/message-board')).text).memos, []);
  });

test('local Letter submission preserves split Unicode and rejects invalid bytes without appending',
  async (t) => {
    const { directory, port, request } = await fixture(t);
    await writeFile(join(directory, '.local/message-fixture.json'), JSON.stringify({
      version: 1, letterService: 'local',
    }));
    const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
    const letter = {
      id: 'unicode-letter',
      recipient: { kind: 'email', address: 'fixture@example.invalid', nickname: 'Émile' },
      text: 'Synthetic 😀é終 Letter',
      attachment: null,
    };
    const bytes = Buffer.from(JSON.stringify(letter));
    const emoji = bytes.indexOf(Buffer.from('😀'));
    const response = await request('/api/letter-outbox', {
      method: 'POST', headers,
      body: [bytes.subarray(0, emoji + 1), bytes.subarray(emoji + 1, emoji + 3), bytes.subarray(emoji + 3)],
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.text).text, letter.text);
    assert.equal(JSON.parse(response.text).recipient.nickname, letter.recipient.nickname);
    const file = join(directory, '.local/letter-outbox.json');
    const before = await readFile(file);
    const malformed = Buffer.from(bytes);
    malformed[emoji] = 0xff;
    assert.equal((await request('/api/letter-outbox', {
      method: 'POST', headers, body: malformed,
    })).status, 400);
    assert.deepEqual(await readFile(file), before);
  });
