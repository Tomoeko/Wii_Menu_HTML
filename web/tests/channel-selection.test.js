import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { selectChannelCatalog, validateChannelEnabled } from '../src/channel-selection.js';
import {
  planChannelSlots,
  serializeChannelPlacement,
  validateChannelArrangement,
} from '../src/channel-storage.js';
import { writeArrangement, readArrangement } from '../../tools/local-state.mjs';
import {
  readChannelInventory,
  runChannelCommand,
  setChannelEnabled,
} from '../../tools/channels.mjs';

const channel = (id) => ({ id, title: id });
const disc = channel('disc');
const ids = (slots) => slots.map((entry) => entry?.id ?? null);
const empty = () => ['disc', ...Array(47).fill(null)];
const json = (value) => JSON.stringify(value, null, 2) + '\n';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-channel-visibility-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = {
    assets: join(directory, 'assets'),
    configFile: join(directory, 'config.json'),
    layoutFile: join(directory, 'layout.json'),
  };
  await mkdir(options.assets);
  await writeFile(
    options.configFile,
    json({ audio: { volume: 0.4 }, channels: { persistLayout: true } }),
  );
  const catalog = {
    channels: ['one', 'two', 'extra'].map((id) => ({
      ...channel(id),
      iconLayout: `${id}.json`,
      bannerLayout: `${id}.json`,
    })),
    defaultOrder: ['one', 'two'],
  };
  await writeFile(join(options.assets, 'channels.json'), json(catalog));
  for (const id of ['one', 'two', 'extra'])
    await writeFile(join(options.assets, `${id}.json`), '{}');
  return options;
}

test('visibility follows native defaults, explicit overrides and stable catalog order', () => {
  const catalog = {
    channels: ['one', 'two', 'extra'].map(channel),
    defaultOrder: ['two', 'one'],
  };
  const before = JSON.stringify(catalog);
  const selected = selectChannelCatalog(catalog, { two: false, extra: true, removed: false });
  assert.deepEqual(selected.defaultOrder, ['one', 'extra']);
  assert.deepEqual(selected.unknownIds, ['removed']);
  assert.equal(JSON.stringify(catalog), before);
  assert.throws(() => validateChannelEnabled({ disc: false }), /Disc/);
  assert.throws(() => validateChannelEnabled({ one: 'false' }), /boolean/);
  assert.throws(() => validateChannelEnabled([]), /map/);
  assert.throws(
    () =>
      selectChannelCatalog({ channels: [channel('x'), channel('x')], defaultOrder: ['x'] }),
    /duplicate/,
  );
  assert.throws(
    () => selectChannelCatalog({ channels: [channel('x')], defaultOrder: ['x', 'x'] }),
    /order/,
  );
  assert.throws(
    () => selectChannelCatalog({ channels: [channel('x')], defaultOrder: ['missing'] }),
    /order/,
  );
});

test('disabled position survives rearrangement and re-enabling does not displace a new owner', () => {
  const saved = empty();
  saved[4] = 'one';
  saved[11] = 'two';
  const hidden = planChannelSlots([disc, channel('two')], { version: 1, slots: saved });
  assert.equal(hidden.slots[4], null);
  const moved = [...hidden.slots];
  moved[4] = moved[11];
  moved[11] = null;
  const state = serializeChannelPlacement(moved, { version: 1, slots: saved });
  assert.equal(state.positions.one, 4);
  assert.equal(state.positions.two, 4);
  const restored = planChannelSlots([disc, channel('one'), channel('two')], state);
  assert.equal(restored.slots[4].id, 'two');
  assert.equal(restored.slots[1].id, 'one');
  assert.equal(new Set(ids(restored.slots).filter(Boolean)).size, 3);
  const unchanged = planChannelSlots(
    [disc, channel('one'), channel('two')],
    serializeChannelPlacement(hidden.slots, { version: 1, slots: saved }),
  );
  assert.equal(unchanged.slots[4].id, 'one');
  assert.equal(unchanged.slots[11].id, 'two');
});

test('initial hidden defaults and removed titles retain free preferred positions', () => {
  const defaults = empty();
  defaults[9] = 'one';
  defaults[22] = 'two';
  const hidden = planChannelSlots(
    [disc, channel('two')],
    { version: 1, slots: null },
    defaults,
  );
  assert.equal(hidden.positions.one, 9);
  const state = serializeChannelPlacement(hidden.slots, {
    slots: defaults,
    positions: hidden.positions,
  });
  const restored = planChannelSlots([disc, channel('two'), channel('one')], state);
  assert.equal(restored.slots[9].id, 'one');
  assert.equal(restored.slots[22].id, 'two');
});

test('full menus report overflow and a newly free slot has exactly one owner', () => {
  const channels = [disc, ...Array.from({ length: 50 }, (_, index) => channel(`c${index}`))];
  const full = planChannelSlots(channels);
  assert.equal(full.slots.length, 48);
  assert.deepEqual(full.overflow, ['c47', 'c48', 'c49']);
  assert.equal(new Set(ids(full.slots)).size, 48);
  const saved = serializeChannelPlacement(full.slots);
  const less = planChannelSlots(
    channels.filter((entry) => entry.id !== 'c3'),
    saved,
  );
  assert.equal(less.slots[4].id, 'c47');
  assert.deepEqual(less.overflow, ['c48', 'c49']);
  assert.equal(less.slots[0].id, 'disc');
  assert.throws(() => planChannelSlots([disc, channel('one'), channel('one')]), /duplicate/);
});

test('position schema is backwards compatible and rejects invalid persisted data', async (t) => {
  const options = await fixture(t);
  const original = { version: 1, slots: empty() };
  assert.deepEqual(validateChannelArrangement(original), original);
  await writeArrangement(options.layoutFile, original);
  for (const positions of [
    { one: -1 },
    { one: 48 },
    { one: 0 },
    { disc: 2 },
    { one: 2.5 },
    [],
  ]) {
    assert.throws(() => writeArrangement(options.layoutFile, { ...original, positions }));
  }
  assert.deepEqual(await readArrangement(options.layoutFile), original);
  const first = { ...original, positions: { one: 4, disc: 0 } };
  const last = { ...original, positions: { one: 8, disc: 0 } };
  await Promise.all([
    writeArrangement(options.layoutFile, first),
    writeArrangement(options.layoutFile, last),
  ]);
  assert.deepEqual(await readArrangement(options.layoutFile), last);
});

test('unified visibility commands preserve catalog, source configuration and stale overrides', async (t) => {
  const paths = await fixture(t);
  const catalogFile = join(paths.assets, 'channels.json');
  const originalCatalog = await readFile(catalogFile, 'utf8');
  assert.equal((await setChannelEnabled('one', false, paths)).status, 'disabled');
  assert.equal((await setChannelEnabled('extra', true, paths)).status, 'visible');
  const config = JSON.parse(await readFile(paths.configFile));
  assert.equal(config.audio.volume, 0.4);
  assert.equal(config.channels.persistLayout, true);
  assert.deepEqual(config.channels.enabled, { one: false, extra: true });
  assert.equal((await setChannelEnabled('one', true, paths)).status, 'visible');
  assert.equal((await setChannelEnabled('extra', null, paths)).status, 'disabled');
  const savedConfig = await readFile(paths.configFile, 'utf8');
  await assert.rejects(setChannelEnabled('unknown', true, paths), /not installed/);
  await assert.rejects(setChannelEnabled('disc', false, paths), /Disc/);
  assert.equal(await readFile(paths.configFile, 'utf8'), savedConfig);
  assert.equal(await readFile(catalogFile, 'utf8'), originalCatalog);
  const result = await runChannelCommand([
    'list',
    '--assets',
    paths.assets,
    '--config',
    paths.configFile,
    '--layout',
    paths.layoutFile,
  ]);
  assert.equal(result.channels.find((entry) => entry.id === 'one').enabled, true);
  await assert.rejects(runChannelCommand(['remove', 'disc']), /Disc/);
});

test('inventory identifies missing layouts without overlapping remaining visible titles', async (t) => {
  const paths = await fixture(t);
  await rm(join(paths.assets, 'one.json'));
  const inventory = await readChannelInventory(paths);
  assert.equal(
    inventory.channels.find((entry) => entry.id === 'one').status,
    'missing-resources',
  );
  assert.deepEqual(inventory.channels.find((entry) => entry.id === 'one').missing, [
    'iconLayout',
    'bannerLayout',
  ]);
  assert.equal(inventory.channels.find((entry) => entry.id === 'two').slot, 2);
  assert.equal(inventory.channels.filter((entry) => entry.slot !== null).length, 2);
});

test('reset removes an absent title override and malformed commands preserve user files', async (t) => {
  const paths = await fixture(t);
  const config = JSON.parse(await readFile(paths.configFile));
  config.channels.enabled = { removed: false };
  await writeFile(paths.configFile, json(config));
  assert.deepEqual((await readChannelInventory(paths)).unknownIds, ['removed']);
  const result = await setChannelEnabled('removed', null, paths);
  assert.equal(result.overrideRemoved, true);
  assert.deepEqual((await readChannelInventory(paths)).unknownIds, []);
  await assert.rejects(runChannelCommand(['list', '--title', 'Unused']), /not supported/);
  await assert.rejects(runChannelCommand(['add', 'x', '--wad', 'y']), /without a positional/);
  await assert.rejects(
    runChannelCommand(['enable', 'one', '--config', 'a', '--config', 'b']),
    /repeated/,
  );
  await writeFile(paths.configFile, 'null\n');
  await assert.rejects(setChannelEnabled('one', false, paths), /Expected an object/);
  assert.equal(await readFile(paths.configFile, 'utf8'), 'null\n');
});
