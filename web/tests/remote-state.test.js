import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { defaultRemoteState, validateRemoteState } from '../src/remote-state.js';
import { readRemoteState, writeRemoteState } from '../../tools/remote-state.mjs';
import { createReconnectFixture } from '../src/remote-reconnect.js';

function advance(session, frames) {
  for (let frame = 0; frame < frames; frame++) session.advance(1);
}

test('remote configuration distinguishes manual, automatic and timeout fixture scenarios', () => {
  const config = normalizeConfig({ wiiRemote: { reconnect: { mode: 'manual', players: [3, 1] } } });
  assert.equal(config.wiiRemote.reconnect.intervalMs, 400);
  assert.deepEqual(config.wiiRemote.reconnect.players, [3, 1]);
  for (const reconnect of [
    null, [],
    { mode: 'bluetooth' }, { players: [] }, { players: [0] }, { players: [1, 1] },
    { startFailures: -1 }, { stopFailures: 0.5 }, { intervalMs: Infinity },
  ]) assert.throws(() => normalizeConfig({ wiiRemote: { reconnect } }));
});

test('reconnect retries start and stop at six updates and preserves per-player cue order', () => {
  const connected = [];
  const finished = [];
  const session = createReconnectFixture({
    players: [3, 1, 4, 2], delayFrames: 1, intervalMs: 0,
    startFailures: 2, stopFailures: 1,
  }, { onConnect: player => connected.push(player), onComplete: result => finished.push(result) });
  advance(session, 11);
  assert.equal(session.snapshot().phase, 'start-retry');
  assert.deepEqual(connected, []);
  advance(session, 1);
  assert.equal(session.snapshot().phase, 'wait');
  advance(session, 1);
  assert.deepEqual(connected, [3, 1, 4, 2]);
  assert.equal(session.connect(3), false);
  advance(session, 30);
  assert.equal(session.snapshot().phase, 'stop-retry');
  assert.deepEqual(finished, []);
  advance(session, 5);
  assert.deepEqual(finished, []);
  advance(session, 1);
  assert.deepEqual(finished, ['connected']);
  advance(session, 100);
  assert.deepEqual(finished, ['connected']);
});

test('timeout waits beyond 3600 updates and never invents connection events', () => {
  const connected = [];
  const finished = [];
  const session = createReconnectFixture({ mode: 'timeout' }, {
    onConnect: player => connected.push(player), onComplete: result => finished.push(result),
  });
  advance(session, 3600);
  assert.equal(session.snapshot().phase, 'wait');
  advance(session, 1);
  assert.deepEqual(connected, []);
  assert.deepEqual(finished, ['timeout']);
});

test('remote state validates four bounded batteries and returns independent snapshots', () => {
  const value = defaultRemoteState({ volume: 0.3, rumble: false });
  const clean = validateRemoteState(value);
  value.controllers[0].battery = 0;
  assert.equal(clean.controllers[0].battery, 4);
  for (const invalid of [
    { ...clean, version: 2 }, { ...clean, volume: 2 },
    { ...clean, controllers: [] },
    { ...clean, controllers: clean.controllers.map(entry => ({ ...entry, battery: 5 })) },
  ]) assert.throws(() => validateRemoteState(invalid));
});

test('serialized remote persistence survives reload and retains malformed existing state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'remote-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'remote-state.json');
  assert.equal(await readRemoteState(file), null);
  const first = defaultRemoteState();
  const second = defaultRemoteState({ volume: 0.2, rumble: false });
  second.controllers[2] = { connected: true, battery: 1 };
  await Promise.all([writeRemoteState(file, first), writeRemoteState(file, second)]);
  assert.deepEqual(await readRemoteState(file), second);
  assert.deepEqual(await readdir(directory), ['remote-state.json']);
  await writeFile(file, '{ malformed');
  await assert.rejects(readRemoteState(file));
  await assert.rejects(writeRemoteState(file, first));
  assert.equal(await readFile(file, 'utf8'), '{ malformed');
  assert.deepEqual(await readdir(directory), ['remote-state.json']);
});
