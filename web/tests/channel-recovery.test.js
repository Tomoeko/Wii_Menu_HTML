import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { createChannelManager, handleChannelManagerRequest } from '../../tools/channel-manager.mjs';
import {
  createChannelRecovery,
  readChannelTrash,
  validateChannelTrash,
} from '../../tools/channel-recovery.mjs';
import { readChannelInventory, setChannelEnabled } from '../../tools/channels.mjs';
import { addCustomChannel, initializeCustomChannel } from '../../tools/custom-channels.mjs';
import { planChannelSlots, serializeChannelPlacement } from '../src/channel-storage.js';
import { selectChannelCatalog } from '../src/channel-selection.js';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

async function fixture(t, count = 3) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-channel-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    assets: join(directory, 'assets'),
    localDirectory: join(directory, '.local'),
    configFile: join(directory, 'config.json'),
    layoutFile: join(directory, 'layout.json'),
  };
  await mkdir(paths.assets);
  await writeJson(join(paths.assets, 'original.json'), { textures: [{ url: 'original.png' }] });
  await writeFile(join(paths.assets, 'original.png'), 'preserved original image bytes');
  await writeFile(join(paths.assets, 'original.wav'), 'preserved original audio bytes');
  const catalog = {
    channels: Array.from({ length: count }, (_, index) => ({
      id: `official-${index}`,
      title: `Official ${index}`,
      source: { sha256: index.toString(16).padStart(64, '0') },
      iconLayout: 'original.json',
      bannerLayout: 'original.json',
      audio: { src: '/assets/original.wav' },
    })),
    defaultOrder: Array.from({ length: count }, (_, index) => `official-${index}`),
  };
  await writeJson(join(paths.assets, 'channels.json'), catalog);
  await writeJson(paths.configFile, { channels: { enabled: {} }, audio: { volume: 0.4 } });
  const arrangement = { version: 1, slots: ['disc', ...Array(47).fill(null)] };
  for (let index = 0; index < Math.min(count, 47); index++)
    arrangement.slots[index + 1] = `official-${index}`;
  await writeJson(paths.layoutFile, arrangement);
  const readInventory = () => readChannelInventory(paths);
  return {
    directory,
    paths,
    catalog,
    arrangement,
    readInventory,
    recovery: createChannelRecovery({ ...paths, readInventory }),
  };
}

test('deleting imported and custom channels keeps originals, config and placement byte-identical', async (t) => {
  const { directory, paths, recovery, readInventory } = await fixture(t);
  const source = join(directory, 'my-source');
  await initializeCustomChannel(source, { id: 'custom-local', title: 'Local' });
  const custom = await addCustomChannel(source, paths.assets);
  const files = [
    paths.configFile,
    paths.layoutFile,
    join(paths.assets, 'channels.json'),
    join(paths.assets, 'custom-channels.json'),
    join(paths.assets, 'original.json'),
    join(paths.assets, 'original.png'),
    join(paths.assets, 'original.wav'),
    join(paths.assets, custom.iconLayout),
    join(source, 'channel.json'),
    join(source, 'sound.wav'),
  ];
  const originals = await Promise.all(files.map((file) => readFile(file)));
  assert.deepEqual(await recovery.delete('official-1'), { deleted: true, alreadyDeleted: false });
  assert.deepEqual(await recovery.delete('custom-local'), { deleted: true, alreadyDeleted: false });
  const inventory = await readInventory();
  assert.deepEqual(inventory.deletedIds, ['official-1', 'custom-local']);
  assert.equal(
    inventory.channels.some((channel) => inventory.deletedIds.includes(channel.id)),
    false,
  );
  assert.deepEqual(
    inventory.deleted.map((channel) => [channel.id, channel.source, channel.canRestore]),
    [
      ['official-1', 'imported', true],
      ['custom-local', 'custom', true],
    ],
  );
  assert.equal(inventory.deleted[0].previousSlot, 2);
  assert.equal(inventory.deleted[0].status, 'deleted');
  for (let index = 0; index < files.length; index++)
    assert.deepEqual(await readFile(files[index]), originals[index]);
  assert.ok(!JSON.stringify(inventory).includes(directory));
});

test('Trash survives a new service instance and restore preserves hidden choices and remembered positions', async (t) => {
  const { paths, recovery, readInventory } = await fixture(t);
  await setChannelEnabled('official-1', false, paths);
  await recovery.delete('official-1');
  const restarted = createChannelRecovery({ ...paths, readInventory });
  assert.deepEqual(await restarted.delete('official-1'), { deleted: true, alreadyDeleted: true });
  assert.deepEqual(await restarted.restore('official-1'), { restored: true });
  const item = (await readInventory()).channels.find((channel) => channel.id === 'official-1');
  assert.equal(item.status, 'disabled');
  await setChannelEnabled('official-1', true, paths);
  assert.equal(
    (await readInventory()).channels.find((channel) => channel.id === 'official-1').slot,
    2,
  );
  assert.deepEqual(await restarted.restore('official-1'), { restored: false });
  assert.deepEqual((await readChannelTrash(paths)).deleted, []);
});

test('restoring into an occupied remembered slot respects the saved owner and reports full-menu overflow', async (t) => {
  const { paths, recovery, readInventory, catalog, arrangement } = await fixture(t, 48);
  await recovery.delete('official-0');
  const selected = selectChannelCatalog(catalog, {}, { deletedIds: ['official-0'] });
  const placement = planChannelSlots([{ id: 'disc' }, ...selected.channels], arrangement);
  assert.equal(placement.slots[1].id, 'official-47');
  const saved = serializeChannelPlacement(placement.slots, arrangement);
  assert.equal(saved.positions['official-0'], 1);
  await writeJson(paths.layoutFile, saved);
  await recovery.restore('official-0');
  let inventory = await readInventory();
  assert.equal(inventory.channels.find((channel) => channel.id === 'official-47').slot, 1);
  assert.equal(
    inventory.channels.find((channel) => channel.id === 'official-0').status,
    'unplaced',
  );
  assert.deepEqual(inventory.overflow, ['official-0']);
  await setChannelEnabled('official-1', false, paths);
  inventory = await readInventory();
  assert.equal(inventory.channels.find((channel) => channel.id === 'official-0').slot, 2);
});

test('missing original entries, conflicting IDs and missing images/audio leave recovery records intact', async (t) => {
  const { paths, recovery, readInventory, catalog } = await fixture(t);
  await recovery.delete('official-0');
  const trashFile = join(paths.localDirectory, 'channel-trash.json');
  const retained = await readFile(trashFile);
  await writeJson(join(paths.assets, 'channels.json'), {
    channels: catalog.channels.slice(1),
    defaultOrder: catalog.defaultOrder.slice(1),
  });
  assert.equal((await readInventory()).deleted[0].restoreStatus, 'missing-source');
  await assert.rejects(recovery.restore('official-0'), { status: 409, code: 'SOURCE_UNAVAILABLE' });
  const conflict = structuredClone(catalog);
  conflict.channels[0].source.sha256 = 'f'.repeat(64);
  await writeJson(join(paths.assets, 'channels.json'), conflict);
  assert.equal((await readInventory()).deleted[0].restoreStatus, 'id-conflict');
  await assert.rejects(recovery.restore('official-0'), { status: 409, code: 'CHANNEL_CONFLICT' });
  await writeJson(join(paths.assets, 'channels.json'), catalog);
  for (const path of ['original.png', 'original.wav', 'original.json']) {
    const file = join(paths.assets, path);
    const bytes = await readFile(file);
    await rm(file);
    const entry = (await readInventory()).deleted[0];
    assert.equal(entry.restoreStatus, 'missing-resources');
    assert.equal(entry.canRestore, false);
    await assert.rejects(recovery.restore('official-0'), {
      status: 409,
      code: 'MISSING_RESOURCES',
    });
    assert.deepEqual(await readFile(trashFile), retained);
    await writeFile(file, bytes);
  }
  await recovery.restore('official-0');
  assert.deepEqual((await readInventory()).deletedIds, []);
});

test('Disc and unknown channels cannot be deleted; concurrent operations are serialized without losing records', async (t) => {
  const { recovery, paths, readInventory } = await fixture(t);
  await assert.rejects(recovery.delete('disc'), { status: 400, code: 'DISC_FIXED' });
  await assert.rejects(recovery.delete('missing'), { status: 404, code: 'CHANNEL_NOT_FOUND' });
  const results = await Promise.all([
    recovery.delete('official-0'),
    recovery.delete('official-1'),
    recovery.delete('official-0'),
    recovery.restore('official-0'),
  ]);
  assert.equal(results[2].alreadyDeleted, true);
  assert.deepEqual((await readInventory()).deletedIds, ['official-1']);
  const lock = join(paths.localDirectory, 'channel-trash.json.lock');
  await mkdir(lock);
  await assert.rejects(recovery.restore('official-1'), { status: 409, code: 'CHANNEL_BUSY' });
  assert.deepEqual((await readInventory()).deletedIds, ['official-1']);
  await rm(lock, { recursive: true });
});

test('malformed local files and invalid records fail without clearing Trash or publishing partial writes', async (t) => {
  const { recovery, paths } = await fixture(t);
  await recovery.delete('official-0');
  const file = join(paths.localDirectory, 'channel-trash.json');
  const retained = await readFile(file);
  await writeFile(paths.configFile, '{broken');
  await assert.rejects(recovery.restore('official-0'));
  assert.deepEqual(await readFile(file), retained);
  const value = JSON.parse(retained.toString());
  for (const changed of [
    { ...value, version: 2 },
    { ...value, deleted: [...value.deleted, value.deleted[0]] },
    { ...value, deleted: [{ ...value.deleted[0], id: 'disc' }] },
    { ...value, deleted: [{ ...value.deleted[0], previousSlot: 48 }] },
  ])
    assert.throws(() => validateChannelTrash(changed), /Invalid local/);
  await writeFile(file, '{broken');
  await assert.rejects(recovery.delete('official-1'));
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('runtime selection excludes Trash without turning deletion into an enabled override', () => {
  const catalog = {
    channels: [{ id: 'a' }, { id: 'b' }, { id: 'optional' }],
    defaultOrder: ['a', 'b'],
  };
  const overrides = { a: true, b: false, optional: true };
  assert.deepEqual(
    selectChannelCatalog(catalog, overrides, { deletedIds: ['a', 'optional', 'absent'] })
      .defaultOrder,
    [],
  );
  assert.deepEqual(selectChannelCatalog(catalog, overrides).defaultOrder, ['a', 'optional']);
  assert.deepEqual(overrides, { a: true, b: false, optional: true });
  for (const deletedIds of [['disc'], ['__proto__'], '../a', [null]]) {
    assert.throws(
      () => selectChannelCatalog(catalog, overrides, { deletedIds }),
      /deleted channel IDs/,
    );
  }
});

test('manager example repair keeps Trash exclusion and returns a usable deleted summary', async (t) => {
  const { paths } = await fixture(t);
  const manager = createChannelManager(paths);
  const example = await manager.installExample();
  await manager.delete(example.channel.id, {});
  const source = join(paths.localDirectory, 'custom-channels/custom-example/channel.json');
  const authoring = await readFile(source);
  const installed = await json(join(paths.assets, 'custom-channels.json'));
  await rm(join(paths.assets, installed.channels[0].iconLayout));
  const repaired = await manager.installExample();
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.channel.id, 'custom-example');
  assert.equal(repaired.channel.status, 'deleted');
  assert.equal(repaired.channel.canRestore, true);
  assert.deepEqual(repaired.inventory.deletedIds, ['custom-example']);
  assert.deepEqual(await readFile(source), authoring);
  const restored = await manager.restore('custom-example', {});
  assert.equal(restored.restored, true);
  assert.equal(restored.channel.status, 'visible');
});

test('HTTP delete and restore require explicit same-origin POSTs and preserve source/config state', async (t) => {
  const { paths } = await fixture(t);
  const manager = createChannelManager(paths);
  const server = http.createServer(async (req, res) => {
    if (
      !(await handleChannelManagerRequest(req, res, {
        pathname: new URL(req.url, 'http://localhost').pathname,
        port: server.address().port,
        manager,
      }))
    )
      res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const request = (
    path,
    { method = 'POST', body = {}, origin = `http://127.0.0.1:${port}` } = {},
  ) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(JSON.stringify(body)),
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  const endpoint = '/api/channels/official-0';
  const config = await readFile(paths.configFile);
  const source = await readFile(join(paths.assets, 'channels.json'));
  assert.equal(
    (await request(endpoint + '/delete', { origin: 'https://foreign.example' })).status,
    403,
  );
  assert.equal((await request(endpoint + '/delete', { body: { purge: true } })).status, 400);
  assert.equal((await request(endpoint + '/delete', { method: 'DELETE' })).status, 405);
  assert.equal((await request('/api/channels/disc/delete')).body.error.code, 'DISC_FIXED');
  const deleted = await request(endpoint + '/delete');
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(deleted.body.channel.status, 'deleted');
  assert.equal(
    deleted.body.inventory.channels.some((channel) => channel.id === 'official-0'),
    false,
  );
  assert.equal((await request(endpoint + '/delete')).body.alreadyDeleted, true);
  assert.equal((await request(endpoint + '/unknown')).status, 405);
  assert.equal(
    (await request(endpoint + '/restore', { body: { padding: 'x'.repeat(4096) } })).status,
    413,
  );
  const restored = await request(endpoint + '/restore');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.restored, true);
  assert.equal(restored.body.channel.slot, 1);
  assert.equal((await request(endpoint + '/restore')).body.restored, false);
  assert.deepEqual(await readFile(paths.configFile), config);
  assert.deepEqual(await readFile(join(paths.assets, 'channels.json')), source);
});

test('permanently deleting (purging) a trashed channel removes files, catalog and trash records', async (t) => {
  const { paths } = await fixture(t);
  const manager = createChannelManager(paths);
  const example = await manager.installExample();
  const id = example.channel.id;
  const sourceFolder = join(paths.localDirectory, 'custom-channels', id);
  assert.ok(await readFile(join(sourceFolder, 'channel.json')));
  await assert.rejects(manager.purge(id), { status: 404, code: 'CHANNEL_NOT_FOUND' });
  await manager.delete(id, {});
  let inv = await manager.inventory();
  assert.equal(inv.deleted.some((ch) => ch.id === id), true);
  const purged = await manager.purge(id, {});
  assert.equal(purged.purged, true);
  assert.equal(purged.title, example.channel.title);
  await assert.rejects(readFile(join(sourceFolder, 'channel.json')), { code: 'ENOENT' });
  inv = await manager.inventory();
  assert.equal(inv.deleted.some((ch) => ch.id === id), false);
  assert.equal(inv.channels.some((ch) => ch.id === id), false);
  await assert.rejects(manager.purge(id), { status: 404, code: 'CHANNEL_NOT_FOUND' });
});
