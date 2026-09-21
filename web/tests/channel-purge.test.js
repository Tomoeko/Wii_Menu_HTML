import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createChannelManager } from '../../tools/channel-manager.mjs';
import { purgeChannel } from '../../tools/channel-purge.mjs';
import { readChannelTrash } from '../../tools/channel-recovery.mjs';

const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-purge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    assets: join(directory, 'assets'),
    configFile: join(directory, 'config.json'),
    layoutFile: join(directory, 'layout.json'),
    localDirectory: join(directory, '.local'),
  };
  await mkdir(paths.assets);
  await writeJson(join(paths.assets, 'channels.json'), { channels: [], defaultOrder: [] });
  await writeJson(paths.configFile, { channels: { enabled: {} }, audio: { volume: 0.4 } });
  await writeJson(paths.layoutFile, { version: 1, slots: ['disc', ...Array(47).fill(null)] });
  const manager = createChannelManager(paths);
  const installed = await manager.installExample();
  const id = installed.channel.id;
  const config = await json(paths.configFile);
  config.channels.enabled[id] = false;
  await writeJson(paths.configFile, config);
  const arrangement = await json(paths.layoutFile);
  arrangement.slots[7] = id;
  arrangement.positions = { disc: 0, [id]: 7 };
  await writeJson(paths.layoutFile, arrangement);
  await manager.delete(id);
  return { directory, paths, manager, id };
}

async function retainedState(paths) {
  return Promise.all([
    readFile(join(paths.assets, 'custom-channels.json'), 'utf8'),
    readFile(join(paths.localDirectory, 'channel-trash.json'), 'utf8'),
    readFile(paths.configFile, 'utf8'),
    readFile(paths.layoutFile, 'utf8'),
  ]);
}

test('permanent deletion removes owned resources and overrides while preserving other state', async (t) => {
  const { paths, manager, id } = await fixture(t);
  const result = await manager.purge(id);
  assert.equal(result.purged, true);
  for (const root of [paths.assets, paths.localDirectory]) {
    await assert.rejects(readFile(join(root, 'custom-channels', id, 'channel.json')), {
      code: 'ENOENT',
    });
  }
  assert.equal((await readdir(join(paths.assets, 'custom-channels'))).includes(id), false);
  const config = await json(paths.configFile);
  assert.deepEqual(config.audio, { volume: 0.4 });
  assert.equal(Object.hasOwn(config.channels.enabled, id), false);
  const arrangement = await json(paths.layoutFile);
  assert.equal(arrangement.slots[0], 'disc');
  assert.equal(arrangement.slots[7], null);
  assert.equal(Object.hasOwn(arrangement.positions, id), false);
  assert.deepEqual((await readChannelTrash(paths)).deleted, []);
  await assert.rejects(manager.purge('disc'), { code: 'DISC_FIXED' });
  await assert.rejects(manager.purge('0000000100000002'), { code: 'DISC_FIXED' });
});

test('partial publication failure restores catalog, Trash, source and exact metadata bytes', async (t) => {
  const { paths, id } = await fixture(t);
  const before = await retainedState(paths);
  await assert.rejects(purgeChannel(paths, id, {
    checkpoint(stage) {
      if (stage === 'metadata-custom') throw new Error('Synthetic write failure');
    },
  }), /Synthetic write failure/);
  assert.deepEqual(await retainedState(paths), before);
  assert.ok(await readFile(join(paths.localDirectory, 'custom-channels', id, 'channel.json')));
  assert.equal((await readdir(paths.localDirectory)).some((name) => name.includes('purge')), false);
  assert.equal((await readdir(join(paths.assets, 'custom-channels')))
    .some((name) => name.startsWith('.purge-')), false);
});

test('conflicting replacement IDs retain Trash and every source file', async (t) => {
  const { paths, manager, id } = await fixture(t);
  const catalogFile = join(paths.assets, 'custom-channels.json');
  const catalog = await json(catalogFile);
  catalog.channels[0].source.sha256 = 'e'.repeat(64);
  await writeJson(catalogFile, catalog);
  const before = await retainedState(paths);
  await assert.rejects(manager.purge(id), { code: 'CHANNEL_CONFLICT' });
  assert.deepEqual(await retainedState(paths), before);
  assert.ok(await readFile(join(paths.localDirectory, 'custom-channels', id, 'channel.json')));
});

test('a symlinked source parent cannot redirect permanent deletion outside managed storage', async (t) => {
  const { directory, paths, manager, id } = await fixture(t);
  const source = join(paths.localDirectory, 'custom-channels');
  const outside = join(directory, 'external-authoring');
  await rename(source, outside);
  await symlink(outside, source);
  const before = await retainedState(paths);
  await assert.rejects(manager.purge(id), { code: 'UNSAFE_CHANNEL_PATH' });
  assert.deepEqual(await retainedState(paths), before);
  assert.ok(await readFile(join(outside, id, 'channel.json')));
});

test('existing preparation and custom installation locks prevent any purge mutation', async (t) => {
  const { paths, manager, id } = await fixture(t);
  const before = await retainedState(paths);
  for (const lock of [join(paths.localDirectory, '.prepare-lock'),
    join(paths.assets, '.custom-channels.lock')]) {
    await mkdir(lock);
    await assert.rejects(manager.purge(id), { code: 'CHANNEL_BUSY' });
    assert.deepEqual(await retainedState(paths), before);
    await rm(lock, { recursive: true });
  }
});

test('a remaining channel keeps resources it shares with the purged channel', async (t) => {
  const { paths, manager, id } = await fixture(t);
  const catalog = await json(join(paths.assets, 'custom-channels.json'));
  const resource = catalog.channels[0].iconLayout;
  await writeJson(join(paths.assets, 'channels.json'), {
    channels: [{ id: 'other-channel', title: 'Other channel',
      iconLayout: resource, bannerLayout: resource }],
    defaultOrder: ['other-channel'],
  });
  await manager.purge(id);
  assert.ok(await readFile(join(paths.assets, resource)));
  assert.ok((await manager.inventory()).channels.some((entry) => entry.id === 'other-channel'));
});

test('malformed arrangement data leaves Trash and source files untouched', async (t) => {
  const { paths, manager, id } = await fixture(t);
  await writeFile(paths.layoutFile, '{broken json');
  const before = await retainedState(paths);
  await assert.rejects(manager.purge(id));
  assert.deepEqual(await retainedState(paths), before);
  assert.ok(await readFile(join(paths.localDirectory, 'custom-channels', id, 'channel.json')));
});

test('a process interruption rolls back an uncommitted purge and completes a committed purge', async (t) => {
  for (const stage of ['metadata-custom', 'committed']) {
    await t.test(stage, async (t) => {
      const { paths, id } = await fixture(t);
      const before = await retainedState(paths);
      const moduleUrl = new URL('../../tools/channel-purge.mjs', import.meta.url).href;
      const source = `
        import { purgeChannel } from ${JSON.stringify(moduleUrl)};
        await purgeChannel(${JSON.stringify(paths)}, ${JSON.stringify(id)}, {
          checkpoint(stage) {
            if (stage === ${JSON.stringify(stage)}) process.exit(88);
          },
        });
      `;
      await assert.rejects(promisify(execFile)(process.execPath,
        ['--input-type=module', '-e', source]), { code: 88 });
      const restarted = createChannelManager(paths);
      const inventory = await restarted.inventory();
      if (stage === 'metadata-custom') {
        assert.deepEqual(await retainedState(paths), before);
        assert.ok(inventory.deleted.some((entry) => entry.id === id));
        assert.ok(await readFile(join(paths.localDirectory, 'custom-channels', id, 'channel.json')));
      } else {
        assert.equal(inventory.deleted.some((entry) => entry.id === id), false);
        assert.equal(inventory.channels.some((entry) => entry.id === id), false);
        assert.equal((await readdir(join(paths.assets, 'custom-channels')))
          .some((name) => name.startsWith('.purge-')), false);
      }
      assert.equal((await readdir(paths.localDirectory)).includes('channel-purge.json'), false);
    });
  }
});

test('imported purge excludes future NAND imports and never removes the external supplied source', async (t) => {
  const { directory, paths, manager } = await fixture(t);
  const id = '0001000154455354';
  const resource = `channel-layouts/${id}/icon`;
  await mkdir(join(paths.assets, resource), { recursive: true });
  await writeJson(join(paths.assets, resource, 'icon.json'), { textures: [] });
  await mkdir(join(paths.assets, 'channel-audio'));
  await writeFile(join(paths.assets, 'channel-audio', `${id}.wav`), 'synthetic audio');
  const external = join(directory, 'supplied-nand');
  await mkdir(external);
  await writeFile(join(external, 'original.app'), 'keep supplied content');
  const managed = join(paths.localDirectory, 'nand-titles', id);
  await mkdir(managed, { recursive: true });
  await writeFile(join(managed, 'original.app'), 'owned cached content');
  await writeJson(join(paths.assets, 'channels.json'), {
    channels: [{ id, title: 'Synthetic imported channel',
      iconLayout: `${resource}/icon.json`, bannerLayout: `${resource}/icon.json`,
      source: { sha256: 'a'.repeat(64) } }], defaultOrder: [id],
  });
  await writeJson(join(paths.localDirectory, 'prepare.json'), {
    schemaVersion: 1, channels: { [id]: { kind: 'nand', contentDirectory: external } },
    removedChannels: [], retained: 'keep',
  });
  await manager.delete(id);
  await manager.purge(id);
  const state = await json(join(paths.localDirectory, 'prepare.json'));
  assert.deepEqual(state.channels, {});
  assert.deepEqual(state.removedChannels, [id]);
  assert.equal(state.retained, 'keep');
  assert.equal(await readFile(join(external, 'original.app'), 'utf8'), 'keep supplied content');
  await assert.rejects(readFile(join(managed, 'original.app')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(paths.assets, resource, 'icon.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(paths.assets, 'channel-audio', `${id}.wav`)), { code: 'ENOENT' });
});
