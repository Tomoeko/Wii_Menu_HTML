import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { createChannelManager, handleChannelManagerRequest } from '../../tools/channel-manager.mjs';
import {
  initializeCustomChannel,
  readCustomCatalog,
  readCustomPackage,
} from '../../tools/custom-channels.mjs';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

async function fixture(t, nativeCount = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-channel-manager-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    assets: join(directory, 'assets'),
    configFile: join(directory, 'config.json'),
    layoutFile: join(directory, 'layout.json'),
    localDirectory: join(directory, '.local'),
  };
  await mkdir(paths.assets);
  await writeFile(join(paths.assets, 'native.json'), '{}');
  const native = {
    channels: Array.from({ length: nativeCount }, (_, i) => ({
      id: `native-${i}`,
      title: `Native ${i}`,
      iconLayout: 'native.json',
      bannerLayout: 'native.json',
    })),
    defaultOrder: Array.from({ length: nativeCount }, (_, i) => `native-${i}`),
  };
  const configuration = {
    audio: { volume: 0.4 },
    channels: { preservedField: true, enabled: {} },
  };
  await writeJson(join(paths.assets, 'channels.json'), native);
  await writeJson(paths.configFile, configuration);
  const arrangement = { version: 1, slots: ['disc', ...Array(47).fill(null)] };
  arrangement.slots[5] = 'native-0';
  await writeJson(paths.layoutFile, arrangement);
  return { directory, paths, manager: createChannelManager(paths), configuration, arrangement };
}

function png() {
  function chunk(type, bytes) {
    const result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length);
    result.write(type, 4);
    bytes.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
    }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function folderFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...(await folderFiles(directory, path + '/')));
    else files.push({ path, base64: (await readFile(join(directory, path))).toString('base64') });
  }
  return files;
}

test('creator retains editable source and installs animated layouts, colors, PNG and PCM audio', async (t) => {
  const { paths, manager, arrangement } = await fixture(t);
  const result = await manager.create({
    id: 'custom-gallery',
    title: '  Gallery  ',
    colors: { background: '#123456', accent: '#FEDCBA' },
    icon: { base64: png().toString('base64') },
    banner: { base64: png().toString('base64') },
  });
  assert.equal(result.channel.id, 'custom-gallery');
  assert.equal(result.channel.title, 'Gallery');
  assert.equal(result.channel.status, 'visible');
  assert.equal(result.channel.slot, 1);
  assert.equal(result.authoringDirectory, '.local/custom-channels/custom-gallery');
  const source = join(paths.localDirectory, 'custom-channels/custom-gallery');
  const prepared = await readCustomPackage(source);
  assert.equal(prepared.audio.channels, 2);
  assert.equal(prepared.layouts.icon.animations.icon.frames, 180);
  assert.equal(prepared.layouts.banner.animations.banner_Start.frames, 31);
  assert.deepEqual(prepared.layouts.icon.root.children[0].vertexColors[0], [18, 52, 86, 255]);
  assert.deepEqual(prepared.layouts.icon.textures[0], {
    name: 'icon-artwork',
    url: 'icon.png',
    width: 2,
    height: 1,
  });
  const content = prepared.layouts.banner.root.children.find((pane) => pane.name === 'Content');
  for (const name of ['Title', 'Subtitle']) {
    assert.deepEqual(content.children.find((pane) => pane.name === name).textColors, [
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ]);
  }
  const entry = (await readCustomCatalog(paths.assets)).channels[0];
  assert.deepEqual(
    await readFile(
      join(paths.assets, (await json(join(paths.assets, entry.iconLayout))).textures[0].url),
    ),
    png(),
  );
  assert.equal(result.inventory.channels.find((channel) => channel.id === 'native-0').slot, 5);
  assert.deepEqual(await json(paths.layoutFile), arrangement);
  assert.ok(!JSON.stringify(result).includes(paths.localDirectory));
});

test('visibility preserves config and layout and cannot hide Disc; full menus retain unplaced channels', async (t) => {
  const { paths, manager, configuration, arrangement } = await fixture(t, 47);
  const created = await manager.create({
    id: 'custom-extra',
    title: 'Extra',
    audio: { kind: 'none' },
  });
  assert.equal(created.channel.status, 'unplaced');
  assert.deepEqual(created.inventory.overflow, ['custom-extra']);
  const hidden = await manager.setEnabled('native-1', { enabled: false });
  assert.equal(hidden.channel.status, 'disabled');
  assert.equal(
    hidden.inventory.channels.find((channel) => channel.id === 'custom-extra').status,
    'visible',
  );
  await assert.rejects(manager.setEnabled('disc', { enabled: false }), /Disc Channel cannot/);
  await manager.setEnabled('native-1', { enabled: null });
  assert.deepEqual(await json(paths.configFile), configuration);
  assert.deepEqual(await json(paths.layoutFile), arrangement);
  const source = join(paths.localDirectory, 'custom-channels/custom-extra');
  assert.equal((await json(join(source, 'channel.json'))).audio, undefined);
  await assert.rejects(readFile(join(source, 'sound.wav')), { code: 'ENOENT' });
});

test('concurrent creates serialize and same-ID collisions never replace a channel or its source', async (t) => {
  const { manager, paths } = await fixture(t);
  const results = await Promise.allSettled([
    manager.create({ id: 'custom-one', title: 'First' }),
    manager.create({ id: 'custom-one', title: 'Replacement' }),
    manager.create({ id: 'custom-two', title: 'Second' }),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled'],
  );
  assert.equal(results[1].reason.status, 409);
  const source = join(paths.localDirectory, 'custom-channels/custom-one/channel.json');
  assert.equal((await json(source)).title, 'First');
  assert.deepEqual(
    (await readCustomCatalog(paths.assets)).channels.map((channel) => channel.title),
    ['First', 'Second'],
  );
  const generated = await Promise.all([
    manager.create({ title: 'Same title' }),
    manager.create({ title: 'Same title' }),
  ]);
  assert.notEqual(generated[0].channel.id, generated[1].channel.id);
  assert.equal(
    (await readdir(join(paths.localDirectory, 'custom-channels'))).some((name) =>
      name.startsWith('.staging-'),
    ),
    false,
  );
});

test('example is idempotent, keeps hidden state and rejects a conflicting authoring folder', async (t) => {
  const { manager, paths } = await fixture(t);
  const first = await manager.installExample();
  assert.equal(first.installed, true);
  const catalog = await readFile(join(paths.assets, 'custom-channels.json'), 'utf8');
  await manager.setEnabled('custom-example', { enabled: false });
  const again = await manager.installExample();
  assert.equal(again.installed, false);
  assert.equal(again.channel.status, 'disabled');
  assert.equal(await readFile(join(paths.assets, 'custom-channels.json'), 'utf8'), catalog);
  const entry = (await readCustomCatalog(paths.assets)).channels[0];
  await rm(join(paths.assets, entry.iconLayout));
  await writeFile(join(paths.assets, entry.audio.src.replace('/assets/', '')), 'damaged');
  assert.equal(
    (await manager.inventory()).channels.find((channel) => channel.id === 'custom-example').status,
    'disabled',
  );
  const repaired = await manager.installExample();
  assert.equal(repaired.installed, false);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.channel.enabled, false);
  assert.equal((await json(join(paths.assets, entry.iconLayout))).name, 'icon');
  assert.ok(
    (await readFile(join(paths.assets, entry.audio.src.replace('/assets/', '')))).length > 44,
  );
  const source = join(paths.localDirectory, 'custom-channels/custom-example/channel.json');
  const changed = await json(source);
  changed.title = 'My modified example';
  await writeJson(source, changed);
  await assert.rejects(manager.installExample(), { status: 409 });
  assert.equal((await json(source)).title, 'My modified example');
});

test('invalid uploads leave catalog, authoring source, native data and configuration unchanged', async (t) => {
  const { manager, paths, directory } = await fixture(t);
  await manager.create({ id: 'custom-valid', title: 'Valid' });
  const before = await readFile(join(paths.assets, 'custom-channels.json'));
  const native = await readFile(join(paths.assets, 'channels.json'));
  const config = await readFile(paths.configFile);
  const brokenPng = png();
  brokenPng[brokenPng.length - 1] ^= 1;
  const unsafeSvg = Buffer.from(
    '<svg width="32" height="32"><text onload="alert(1)">x</text></svg>',
  );
  for (const request of [
    { title: 'Broken PNG', icon: { base64: brokenPng.toString('base64') } },
    { title: 'Active SVG', icon: { base64: unsafeSvg.toString('base64') } },
    {
      title: 'Broken WAV',
      audio: { kind: 'upload', base64: Buffer.from('not audio').toString('base64') },
    },
    { title: 'Bad color', colors: { accent: 'red' } },
    { title: 'Outside', id: '../../escape' },
    { title: 'Outside', assets: directory },
    { title: 'Invalid base64', icon: { base64: 'AA=A' } },
  ])
    await assert.rejects(manager.create(request), { status: 400 });
  assert.deepEqual(await readFile(join(paths.assets, 'custom-channels.json')), before);
  assert.deepEqual(await readFile(join(paths.assets, 'channels.json')), native);
  assert.deepEqual(await readFile(paths.configFile), config);
  assert.deepEqual(await readdir(join(paths.localDirectory, 'custom-channels')), ['custom-valid']);
});

test('declarative folder import retains notes and nested artwork, and rejects hostile or colliding paths', async (t) => {
  const { manager, directory, paths } = await fixture(t);
  const source = join(directory, 'authored');
  await initializeCustomChannel(source, { id: 'custom-folder', title: 'Folder' });
  await mkdir(join(source, 'notes'));
  await writeFile(join(source, 'notes/design.md'), 'Original author notes.\n');
  await writeFile(join(source, 'notes/empty.md'), '');
  await mkdir(join(source, 'images'));
  await writeFile(join(source, 'images/art.png'), png());
  const icon = await json(join(source, 'icon.json'));
  icon.textures.push({ name: 'Art', url: 'images/art.png', width: 2, height: 1 });
  await writeJson(join(source, 'icon.json'), icon);
  const files = await folderFiles(source);
  const result = await manager.importFolder({ files });
  assert.equal(result.channel.id, 'custom-folder');
  assert.equal(
    await readFile(
      join(paths.localDirectory, 'custom-channels/custom-folder/notes/design.md'),
      'utf8',
    ),
    'Original author notes.\n',
  );
  const entry = (await readCustomCatalog(paths.assets)).channels[0];
  const version = join(paths.assets, entry.iconLayout, '..');
  await assert.rejects(readFile(join(version, 'resources/notes/design.md')), { code: 'ENOENT' });
  await assert.rejects(manager.importFolder({ files }), { status: 409 });
  for (const extra of [
    { path: '../outside.md', base64: 'YQ==' },
    { path: 'CHANNEL.json', base64: 'e30=' },
    { path: 'code.js', base64: 'YQ==' },
    { path: '/absolute.md', base64: 'YQ==' },
    {
      path: 'active.svg',
      base64: Buffer.from(
        '<svg width="32" height="32"><image href="https://example.invalid/track.png"/></svg>',
      ).toString('base64'),
    },
  ])
    await assert.rejects(manager.importFolder({ files: [...files, extra] }), { status: 400 });
  assert.deepEqual(await readdir(join(paths.localDirectory, 'custom-channels')), ['custom-folder']);
});

test('catalog locks reject parallel external installation and malformed local state before publishing assets', async (t) => {
  const { manager, paths } = await fixture(t);
  await mkdir(join(paths.assets, '.custom-channels.lock'));
  await assert.rejects(manager.create({ title: 'Locked' }), { status: 409, code: 'CHANNEL_BUSY' });
  await rm(join(paths.assets, '.custom-channels.lock'), { recursive: true });
  await writeFile(paths.configFile, '{broken');
  await assert.rejects(manager.create({ title: 'Bad local config' }), { status: 400 });
  await assert.rejects(readFile(join(paths.assets, 'custom-channels.json')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(join(paths.localDirectory, 'custom-channels')), []);
});

test('imported IDs and existing authoring directories are never replaced by the manager', async (t) => {
  const { manager, paths } = await fixture(t);
  const native = await json(join(paths.assets, 'channels.json'));
  native.channels[0].id = 'custom-native';
  native.defaultOrder[0] = 'custom-native';
  await writeJson(join(paths.assets, 'channels.json'), native);
  const nativeBytes = await readFile(join(paths.assets, 'channels.json'));
  await assert.rejects(manager.create({ id: 'custom-native', title: 'Collision' }), {
    status: 409,
  });
  const source = join(paths.localDirectory, 'custom-channels/custom-orphan');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'notes.md'), 'Retain my unfinished channel.');
  await assert.rejects(manager.create({ id: 'custom-orphan', title: 'Replacement' }), {
    status: 409,
  });
  assert.equal(await readFile(join(source, 'notes.md'), 'utf8'), 'Retain my unfinished channel.');
  assert.deepEqual(await readFile(join(paths.assets, 'channels.json')), nativeBytes);
  await assert.rejects(readFile(join(paths.assets, 'custom-channels.json')), { code: 'ENOENT' });
});

async function httpFixture(t) {
  const data = await fixture(t);
  const server = http.createServer(async (req, res) => {
    const handled = await handleChannelManagerRequest(req, res, {
      pathname: new URL(req.url, 'http://localhost').pathname,
      port: server.address().port,
      manager: data.manager,
      bodyLimit: 1024,
    });
    if (!handled) res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const request = (path, { method = 'GET', body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }),
          );
        },
      );
      req.on('error', reject);
      req.end(
        body === undefined || typeof body === 'string' || Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
      );
    });
  return { ...data, request, origin, port };
}

test('HTTP routes enforce same-origin JSON mutations, byte limits and non-destructive methods', async (t) => {
  const { request, port } = await httpFixture(t);
  assert.equal((await request('/api/channels')).body.schemaVersion, 1);
  for (const origin of ['https://example.com', 'null', 'http://localhost:1', '']) {
    assert.equal(
      (
        await request('/api/channels/custom', {
          method: 'POST',
          body: { title: 'Rejected' },
          headers: { Origin: origin },
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await request('/api/channels', { headers: { Host: 'foreign.example' } })).status,
    403,
  );
  assert.equal(
    (
      await request('/api/channels/custom', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'text/plain' },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('/api/channels/custom', { method: 'POST', body: 'x'.repeat(1025) })).status,
    413,
  );
  assert.equal((await request('/api/channels/custom', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request('/api/channels/custom', {
    method: 'POST', body: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
  })).status, 400);
  const created = await request('/api/channels/custom', {
    method: 'POST',
    body: { id: 'custom-http', title: 'HTTP' },
  });
  assert.equal(created.status, 201);
  assert.equal(
    (
      await request('/api/channels/custom-http/enabled', {
        method: 'PUT',
        body: { enabled: false },
        headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}` },
      })
    ).body.channel.status,
    'disabled',
  );
  assert.equal((await request('/api/channels/custom-http', { method: 'DELETE' })).status, 405);
  assert.equal(
    (
      await request('/api/channels/custom-http/enabled', {
        method: 'PUT',
        body: { enabled: true, configFile: '/tmp/config.json' },
      })
    ).status,
    400,
  );
  assert.equal((await request('/api/channels')).body.channels.length, 3);
  const example = await request('/api/channels/example', { method: 'POST', body: {} });
  assert.equal(example.status, 201);
  assert.equal((await request('/api/channels/example', { method: 'POST', body: {} })).status, 200);
});

test('HTTP filesystem errors disclose no private paths and do not mutate local state', async (t) => {
  const { request, paths, directory } = await httpFixture(t);
  await rm(paths.configFile);
  await mkdir(paths.configFile);
  const result = await request('/api/channels/custom', {
    method: 'POST',
    body: { title: 'Unreadable configuration' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_CHANNEL');
  assert.ok(!JSON.stringify(result).includes(directory));
  assert.ok(!JSON.stringify(result).includes('/Users/'));
  await assert.rejects(readFile(join(paths.assets, 'custom-channels.json')), { code: 'ENOENT' });
});

test('custom creation and example repair respect the shared preparation lock without removing it', async (t) => {
  const { manager, paths } = await fixture(t);
  const created = await manager.installExample();
  const catalog = join(paths.assets, 'custom-channels.json');
  const before = await readFile(catalog);
  const icon = join(paths.assets, (await readCustomCatalog(paths.assets)).channels[0].iconLayout);
  await rm(icon);
  const lock = join(paths.localDirectory, '.prepare-lock');
  await writeFile(lock, 'preparation owns this advisory-lock file');
  await assert.rejects(manager.create({ title: 'Concurrent creator' }), {
    status: 409,
    code: 'CHANNEL_BUSY',
  });
  await assert.rejects(manager.installExample(), { status: 409, code: 'CHANNEL_BUSY' });
  assert.equal(await readFile(lock, 'utf8'), 'preparation owns this advisory-lock file');
  assert.deepEqual(await readFile(catalog), before);
  await assert.rejects(readFile(icon), { code: 'ENOENT' });
  await rm(lock);
  const repaired = await manager.installExample();
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.channel.id, created.channel.id);
  assert.equal((await readFile(icon, 'utf8')).startsWith('{\n'), true);
  await assert.rejects(readFile(join(lock, 'custom-owner.json')), { code: 'ENOENT' });
  await mkdir(lock);
  await writeFile(join(lock, 'custom-owner.json'), JSON.stringify({ version: 1, pid: process.pid }));
  await assert.rejects(manager.create({ title: 'Second custom writer' }), {
    status: 409,
    code: 'CHANNEL_BUSY',
  });
  assert.equal(JSON.parse(await readFile(join(lock, 'custom-owner.json'))).pid, process.pid);
});
