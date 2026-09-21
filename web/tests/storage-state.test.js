import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultStorageFixture, defaultStorageState, validateStorageFixture, validateStorageState,
  resolveStorageFixture, mediaErrorMessage,
} from '../src/storage-state.js';
import { readStorageState, readStorageFixture, writeStorageState } from '../../tools/storage-state.mjs';

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'wii-storage-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('SD state accepts bounded pages, help migration and distinct remembered tabs', () => {
  const state = defaultStorageState();
  state.sd = { page: 19, helpSeen: true };
  state.tabs = { wii: 'sd', channels: 'wii', gamecube: 'sd' };
  const validated = validateStorageState(state);
  assert.deepEqual(validated, state);
  state.sd.page = 3;
  assert.equal(validated.sd.page, 19, 'validated snapshots do not alias mutable caller state');
  for (const page of [-1, 20, 0.5, '1', null, true, NaN]) {
    assert.throws(() => validateStorageState({ ...state, sd: { page, helpSeen: false } }));
  }
  for (const helpSeen of [undefined, 'true', 0]) {
    assert.throws(() => validateStorageState({ ...state, sd: { page: 0, helpSeen } }));
  }
  assert.throws(() => validateStorageState({ ...state, version: 2 }));
  assert.throws(() => validateStorageState({ ...state, tabs: { ...state.tabs, wii: 'nand' } }));
  assert.equal(validateStorageState(defaultStorageState()).sd.helpSeen, null);
});

test('SD fixtures explicitly map loaded artwork to sparse slots without changing installed channels', () => {
  const fixture = defaultStorageFixture();
  fixture.sd.channels = [{ id: 'custom-second', slot: 239 }, { id: 'custom-first', slot: 13 },
    { id: 'missing', slot: 0 }];
  const channels = [{ id: 'disc', icon: {} }, { id: 'custom-first', icon: { one: true } },
    { id: 'custom-second', icon: { two: true } }, { id: 'no-artwork' }];
  const before = structuredClone(channels);
  const resolved = resolveStorageFixture(fixture, channels);
  assert.equal(resolved.sdSlots.length, 240);
  assert.equal(resolved.sdSlots[0], null);
  assert.equal(resolved.sdSlots[13], channels[1]);
  assert.equal(resolved.sdSlots[239], channels[2]);
  assert.deepEqual(resolved.sdChannels.map(({ id }) => id), ['custom-first', 'custom-second']);
  assert.deepEqual(resolved.missingChannelIds, ['missing']);
  assert.deepEqual(channels, before);
  for (const mappings of [
    [{ id: 'disc', slot: 0 }], [{ id: '../private', slot: 0 }], [{ id: 'x', slot: 240 }],
    [{ id: 'x', slot: 0 }, { id: 'x', slot: 1 }],
    [{ id: 'x', slot: 0 }, { id: 'y', slot: 0 }],
  ]) {
    assert.throws(() => validateStorageFixture({ ...fixture, sd: { status: 'ready', channels: mappings } }));
  }
});

test('media fixtures validate synthetic records and use original region message IDs', () => {
  for (const status of ['ready', 'absent', 'read-error', 'unsupported']) {
    const fixture = defaultStorageFixture();
    fixture.gamecube.b = { status, records: [{ id: 'save-b', title: 'Synthetic Save B', blocks: 5 }] };
    assert.deepEqual(validateStorageFixture(fixture), fixture);
  }
  const fixture = defaultStorageFixture();
  for (const invalid of [
    { id: 'a', title: '', blocks: 1 }, { id: 'a', title: 'Save', blocks: 0 },
    { id: 'a', title: 'Save', blocks: 1.5 }, { id: '__proto__', title: 'Save', blocks: 1 },
  ]) {
    fixture.sdSaves.records = [invalid];
    assert.throws(() => validateStorageFixture(fixture));
  }
  fixture.sdSaves.records = Array(2).fill({ id: 'duplicate', title: 'Save', blocks: 1 });
  assert.throws(() => validateStorageFixture(fixture));
  assert.equal(mediaErrorMessage('absent', { messages: { messages: { 169: 'SD absent resource' } } }),
    'SD absent resource');
  assert.equal(mediaErrorMessage('read-error', { kind: 'gamecube', tab: 'sd', messages: { 233: 'B read error' } }),
    'B read error');
  assert.equal(mediaErrorMessage('unsupported', { kind: 'gamecube', tab: 'wii', messages: { 234: 'A unsupported' } }),
    'A unsupported');
});

test('optional declared free blocks preserve old fixtures and validate native display ranges', () => {
  const fixture = defaultStorageFixture();
  assert.deepEqual(validateStorageFixture(fixture), fixture);
  for (const freeBlocks of [{ wii: 0, sd: 1007 }, { wii: 9999 }, { sd: 999999 }, {}]) {
    const input = { ...fixture, freeBlocks };
    assert.deepEqual(validateStorageFixture(input), input);
    assert.deepEqual(resolveStorageFixture(input, []).freeBlocks, freeBlocks);
    assert.notEqual(validateStorageFixture(input).freeBlocks, freeBlocks);
  }
  for (const freeBlocks of [null, [], 905, '1007', { wii: -1 }, { wii: 10000 },
    { sd: 1000000 }, { sd: 1.5 }, { sd: NaN }, { sd: '1007' }, { sd: false },
    { sd: null }, { gamecube: 59 }]) {
    assert.throws(() => validateStorageFixture({ ...fixture, freeBlocks }), /free.?block/i);
  }
});

test('reading an optional capacity fixture retains its values without changing the file', async (t) => {
  const root = await directory(t);
  const file = join(root, 'storage-fixture.json');
  const value = { ...defaultStorageFixture(), freeBlocks: { wii: 42, sd: 1007 } };
  const contents = JSON.stringify(value, null, 2) + '\n';
  await writeFile(file, contents);
  assert.deepEqual(await readStorageFixture(file), value);
  assert.equal(await readFile(file, 'utf8'), contents);
});

test('readable storage persistence keeps ordered snapshots and leaves no owned scratch paths', async (t) => {
  const root = await directory(t);
  const file = join(root, '.local/storage-state.json');
  assert.deepEqual(await readStorageState(file), defaultStorageState());
  assert.deepEqual(await readStorageFixture(join(root, '.local/storage-fixture.json')), defaultStorageFixture());
  const first = defaultStorageState();
  first.sd = { page: 8, helpSeen: true };
  const firstWrite = writeStorageState(file, first);
  first.sd.page = 10;
  assert.equal((await firstWrite).sd.page, 8);
  const second = defaultStorageState();
  second.sd = { page: 19, helpSeen: false };
  second.tabs.channels = 'sd';
  await Promise.all([writeStorageState(file, first), writeStorageState(file, second)]);
  assert.deepEqual(await readStorageState(file), second);
  assert.equal(await readFile(file, 'utf8'), JSON.stringify(second, null, 2) + '\n');
  assert.deepEqual(await readdir(join(root, '.local')), ['storage-state.json']);
});

test('invalid, corrupt, symlinked and foreign-locked storage remains intact', async (t) => {
  const root = await directory(t);
  const local = join(root, '.local');
  const file = join(local, 'storage-state.json');
  await mkdir(local);
  await writeFile(file, '{"privateMarker":"fixture only"');
  const before = await readFile(file, 'utf8');
  await assert.rejects(readStorageState(file));
  await assert.rejects(writeStorageState(file, defaultStorageState()));
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(await readdir(local), ['storage-state.json']);
  await rm(file);
  const outside = join(root, 'outside.json');
  await writeFile(outside, JSON.stringify(defaultStorageState()));
  await symlink(outside, file);
  await assert.rejects(readStorageState(file), /Invalid local storage/);
  await assert.rejects(writeStorageState(file, defaultStorageState()));
  await rm(file);
  await mkdir(file + '.lock');
  await writeFile(join(file + '.lock', 'owner'), 'foreign');
  await assert.rejects(writeStorageState(file, defaultStorageState()));
  assert.equal(await readFile(join(file + '.lock', 'owner'), 'utf8'), 'foreign');
  const linked = join(root, 'linked-local');
  await symlink(local, linked);
  await assert.rejects(readStorageState(join(linked, 'missing.json')), /regular directory/);
  await assert.rejects(writeStorageState(join(linked, 'missing.json'), defaultStorageState()), /regular directory/);
  assert.equal(await readFile(outside, 'utf8'), JSON.stringify(defaultStorageState()));
});

test('tracked storage examples remain valid and contain only explicit synthetic mappings', async () => {
  for (const name of ['populated', 'absent', 'errors']) {
    const file = new URL(`../../examples/storage-fixtures/${name}.json`, import.meta.url);
    const value = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(validateStorageFixture(value), value);
    assert.ok(value.sd.channels.every(({ id }) => id === 'custom-example'));
  }
});
