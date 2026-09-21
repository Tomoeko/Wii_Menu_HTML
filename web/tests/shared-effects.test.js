import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodePreparedBuses, loadPreparedBusAsset,
  loadPreparedBusCatalog } from '../src/prepared-bus-resources.js';
import { PreparedEffectsEngine } from '../src/prepared-effects-engine.js';
import { SequenceReverb } from '../src/sequence-reverb.js';
import { createSharedEffects } from '../src/shared-effects.js';

const baseUrl = 'http://localhost:5173/';
const asset = { src: '/assets/audio-buses.json', catalogSrc: '/assets/audio.json' };
const profile = { type: 'ReverbHi', callback: 'menu-chain',
  delayFrames: [101, 149, 193, 29, 11, 7, 13, 17],
  preset: [0, 0.1, 0.5, 0.1, 0, 1], sourceDriverSha256: 'b'.repeat(64) };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const menuRouting = {
  context: 'system-menu-usa-4.3', inactiveAuxiliaryBuses: ['auxB', 'auxC'],
};

function fixture(frames = 1) {
  const bytes = Buffer.alloc(frames * 16);
  bytes.writeInt32LE(49150, 0);
  bytes.writeInt32LE(-49152, 4);
  bytes.writeInt32LE(12000, 8);
  bytes.writeInt32LE(-10000, 12);
  const descriptor = {
    schemaVersion: 1, src: '/assets/audio/cue-buses.pcm', encoding: 's32le',
    pcmScale: 32768, channels: ['mainLeft', 'mainRight', 'auxALeft', 'auxARight'],
    sampleRate: 32000, blockFrames: 96, frames, sha256: digest(bytes),
    rendererVersion: 10, sourceSymbol: 'SYNTHETIC_CUE',
    sourceSequenceSha256: 'c'.repeat(64), sourceArchiveSha256: 'a'.repeat(64),
    sourceDriverSha256: 'b'.repeat(64), unrenderedSends: [],
  };
  const catalogBytes = Buffer.from(JSON.stringify({ cue: {
    src: '/assets/audio/cue.wav', sourceSymbol: 'SYNTHETIC_CUE', gain: 1,
    rendering: 'original-sequence-built-in-reverb-approximate',
  } }));
  const sidecar = { schemaVersion: 2, sourceAudioSha256: digest(catalogBytes),
    effectProfiles: { menu: structuredClone(profile) }, sounds: { cue: descriptor } };
  const fetches = [];
  const fetchResource = async (url) => {
    fetches.push(url);
    const path = new URL(url).pathname;
    if (path === asset.src) return new Response(JSON.stringify(sidecar));
    if (path === asset.catalogSrc) return new Response(catalogBytes);
    if (path === descriptor.src) return new Response(bytes);
    return new Response('', { status: 404 });
  };
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { descriptor, bytes, buffer, sidecar, catalogBytes, fetchResource, fetches };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

test('WSD descriptor binds baked gain and source class before shared playback owns it once', async () => {
  const data = fixture();
  const descriptor = data.descriptor;
  delete descriptor.sourceSequenceSha256;
  Object.assign(descriptor, {
    schemaVersion: 2, sourceKind: 'wsd', sourceDefinitionSha256: 'd'.repeat(64),
    gainOwner: 'buses', archiveVolume: 96, outputMode: 'stereo',
  });
  const catalog = { cue: { sourceSymbol: descriptor.sourceSymbol,
    rendering: 'decoded-original-wave', gain: 96 / 127 } };
  const fetchResource = async (url) => {
    const catalogBytes = Buffer.from(JSON.stringify(catalog));
    data.sidecar.sourceAudioSha256 = digest(catalogBytes);
    if (new URL(url).pathname === asset.src) return new Response(JSON.stringify(data.sidecar));
    if (new URL(url).pathname === asset.catalogSrc) return new Response(catalogBytes);
    return data.fetchResource(url);
  };
  const loaded = await loadPreparedBusCatalog(asset, baseUrl, fetchResource);
  assert.equal(loaded.sounds.cue.archiveVolume, 96);
  const engine = new PreparedEffectsEngine(profile);
  const channels = [10000, -10001, 0, 0].map((sample) => Int32Array.of(sample));
  engine.addAsset('cue', descriptor, channels);
  engine.play(1, 'cue');
  const output = [new Float32Array(1), new Float32Array(1)];
  engine.render(...output);
  assert.deepEqual(output.map((channel) => channel[0] * 32768), [10000, -10001]);
  catalog.cue.gain = 1;
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, fetchResource), /provenance/);
  catalog.cue.gain = 96 / 127;
  descriptor.gainOwner = 'catalog';
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, fetchResource), /ownership/);
  descriptor.gainOwner = 'buses';
  catalog.cue.rendering = 'original-looping-wave-without-AX-envelope';
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, fetchResource), /provenance/);
  catalog.cue.rendering = 'decoded-original-wave';
  descriptor.loopStartFrame = 0;
  descriptor.loopEndFrame = 1;
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, fetchResource), /ownership/);
});

function owner(fixture, overrides = {}) {
  const nodes = [];
  const errors = [];
  const context = { destination: {}, audioWorklet: { addModule: async () => {} },
    closeCalls: 0, close() { this.closeCalls += 1; } };
  const nodeFactory = () => {
    const node = { messages: [], disconnected: false, closed: false,
      connect(destination) { this.destination = destination; },
      disconnect() { this.disconnected = true; },
    };
    node.port = {
      postMessage(data) {
        node.messages.push(data);
        if (data.type === 'initialize' && overrides.autoReady !== false) {
          queueMicrotask(() => node.port.onmessage?.({ data: { type: 'ready' } }));
        }
      },
      close() { node.closed = true; },
    };
    nodes.push(node);
    return node;
  };
  const player = createSharedEffects({ context, asset, baseUrl,
    fetchResource: fixture.fetchResource, nodeFactory, onError: (error) => errors.push(error.message),
    ...overrides });
  return { player, context, nodes, errors };
}

test('validated bus loading preserves signed PCM counts without AudioContext decoding', async () => {
  const data = fixture();
  const catalog = await loadPreparedBusCatalog(asset, baseUrl, data.fetchResource);
  const channels = await loadPreparedBusAsset(catalog.sounds.cue, baseUrl, data.fetchResource);
  assert.deepEqual(channels.map((channel) => channel[0]), [49150, -49152, 12000, -10000]);
  assert.ok(channels.every((channel) => channel instanceof Int32Array));
});

test('loader rejects stale catalogs, altered PCM and remote URLs', async () => {
  const stale = fixture();
  stale.sidecar.sourceAudioSha256 = '0'.repeat(64);
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, stale.fetchResource), /catalog/);
  const corrupt = fixture();
  corrupt.bytes[0] ^= 1;
  await assert.rejects(loadPreparedBusAsset(corrupt.descriptor, baseUrl, corrupt.fetchResource),
    /content does not match/);
  const remote = fixture();
  remote.descriptor.src = 'https://example.invalid/cue.pcm';
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, remote.fetchResource), /local host/);
  assert.equal(remote.fetches.length, 2);
});

test('decoder rejects malformed sizes, unsupported schemas and invalid loops', () => {
  const data = fixture();
  assert.throws(() => decodePreparedBuses(new ArrayBuffer(0), data.descriptor), /byte length/);
  assert.throws(() => decodePreparedBuses(data.buffer, { ...data.descriptor, schemaVersion: 2 }),
    /descriptor/);
  assert.throws(() => decodePreparedBuses(data.buffer, { ...data.descriptor,
    loopStartFrame: 0, loopEndFrame: 1.5 }), /loop/);
});

test('loader rejects legacy sidecars and profiles without the menu callback wrapper', async () => {
  const legacy = fixture();
  legacy.sidecar.schemaVersion = 1;
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, legacy.fetchResource), /sidecar/);
  for (const callback of [undefined, 'home-direct']) {
    const data = fixture();
    data.sidecar.effectProfiles.menu.callback = callback;
    await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, data.fetchResource), /profile/);
  }
});

test('immediate menu initialization clears initial sends while preserving the dry cue', () => {
  const data = fixture();
  const channels = decodePreparedBuses(data.buffer, data.descriptor);
  const render = (idle) => {
    const engine = new PreparedEffectsEngine(profile);
    if (idle) engine.render(new Float32Array(192), new Float32Array(192));
    engine.addAsset('cue', data.descriptor, channels);
    engine.play(1, 'cue');
    const output = [new Float32Array(2000), new Float32Array(2000)];
    engine.render(...output);
    return output;
  };
  const immediate = render(false);
  const settled = render(true);
  assert.equal(immediate[0][0], settled[0][0]);
  assert.ok(immediate[0].slice(1).every((sample) => sample === 0));
  assert.ok(settled[0].slice(192).some((sample) => sample !== 0));
});

test('shared engine clips dry overlap once and feeds summed sends through one persistent filter', () => {
  const data = fixture();
  const channels = decodePreparedBuses(data.buffer, data.descriptor);
  const ended = [];
  const engine = new PreparedEffectsEngine(profile, { onEnded: (id) => ended.push(id) });
  // Compare continuous playback after the native menu callback's two initial
  // clear invocations. Immediate replacement is covered separately.
  engine.render(new Float32Array(192), new Float32Array(192));
  engine.addAsset('cue', data.descriptor, channels);
  engine.play(1, 'cue');
  engine.play(2, 'cue');
  const output = [new Float32Array(2000), new Float32Array(2000)];
  engine.render(...output);
  const expected = output.map((channel) => new Float32Array(channel.length));
  expected[0][0] = 32767 / 32768;
  expected[1][0] = -1;
  const filter = new SequenceReverb(profile);
  for (let frame = 0; frame < 1808; frame += 1) {
    expected[0][frame + 192] = filter.process(0, frame === 0 ? 24000 / 32768 : 0);
    expected[1][frame + 192] = filter.process(1, frame === 0 ? -20000 / 32768 : 0);
  }
  // Compare integer PCM, where signed floating-point zero is identical.
  assert.deepEqual(output.map((channel) => Int32Array.from(channel, (value) => value * 32768)),
    expected.map((channel) => Int32Array.from(channel, (value) => value * 32768)));
  assert.deepEqual(ended, [1, 2]);
  assert.equal(engine.voices.size, 0);
  assert.ok(output[0].slice(500).some((sample) => sample !== 0));
});

test('opposite prepared main buses cancel before final clipping', () => {
  const data = fixture();
  const positive = decodePreparedBuses(data.buffer, data.descriptor);
  const negative = positive.map((channel) => new Int32Array(channel.length));
  negative[0][0] = -40000;
  negative[1][0] = 40000;
  const engine = new PreparedEffectsEngine(profile);
  engine.addAsset('positive', data.descriptor, positive);
  engine.addAsset('negative', data.descriptor, negative);
  engine.play(1, 'positive');
  engine.play(2, 'negative');
  const output = [new Float32Array(1), new Float32Array(1)];
  engine.render(...output);
  assert.deepEqual(output.map((channel) => channel[0] * 32768), [9150, -9152]);
});

test('shared engine preserves loop periods, stop tails and irregular output partitions', () => {
  const data = fixture(384);
  data.descriptor.loopStartFrame = 0;
  data.descriptor.loopEndFrame = 384;
  const channels = decodePreparedBuses(data.buffer, data.descriptor);
  const make = () => {
    const engine = new PreparedEffectsEngine(profile);
    engine.addAsset('cue', data.descriptor, channels);
    engine.play(1, 'cue', { loop: true });
    return engine;
  };
  const whole = make();
  const expected = [new Float32Array(1000), new Float32Array(1000)];
  whole.render(...expected);
  const split = make();
  const actual = expected.map((channel) => new Float32Array(channel.length));
  let position = 0;
  for (const count of [1, 127, 511, 361]) {
    const output = [new Float32Array(count), new Float32Array(count)];
    split.render(...output);
    output.forEach((channel, index) => actual[index].set(channel, position));
    position += count;
  }
  assert.deepEqual(actual, expected);
  split.stop(1);
  const tail = [new Float32Array(1000), new Float32Array(1000)];
  split.render(...tail);
  assert.equal(split.voices.size, 0);
  assert.ok(tail[0].slice(192).some((sample) => sample !== 0));
});

test('unregister leaves the constructed block intact and suppresses only newly built Aux output', () => {
  const data = fixture(576);
  const channels = [1000, -2000, 3000, -4000].map((value) =>
    new Int32Array(data.descriptor.frames).fill(value));
  const engine = new PreparedEffectsEngine(profile);
  // An identity callback exposes transport admission without a reverb tail
  // obscuring the exact block boundary being tested.
  engine.bus.replaceEffect({ process: (channel, sample) => sample });
  engine.addAsset('cue', data.descriptor, channels);
  engine.play(1, 'cue');
  const initial = [new Float32Array(193), new Float32Array(193)];
  engine.render(...initial);
  assert.equal(initial[0][192], 4000 / 32768);
  assert.equal(initial[1][192], -6000 / 32768);
  engine.replaceEffect(null);
  const remainder = [new Float32Array(95), new Float32Array(95)];
  engine.render(...remainder);
  assert.ok(remainder[0].every((sample) => sample === 4000 / 32768));
  assert.ok(remainder[1].every((sample) => sample === -6000 / 32768));
  const next = [new Float32Array(96), new Float32Array(96)];
  engine.render(...next);
  assert.ok(next[0].every((sample) => sample === 1000 / 32768));
  assert.ok(next[1].every((sample) => sample === -2000 / 32768));
  assert.equal(engine.voices.size, 1, 'Aux admission does not stop the dry voice');
});

test('shared engine refuses dynamic controls and unrendered auxiliary routes', () => {
  const data = fixture();
  const channels = decodePreparedBuses(data.buffer, data.descriptor);
  const engine = new PreparedEffectsEngine(profile);
  engine.addAsset('cue', data.descriptor, channels);
  assert.throws(() => engine.play(1, 'cue', { pitch: 2 }), /static playback/);
  assert.throws(() => engine.play(1, 'cue', { loop: true }), /verified prepared loop/);
  assert.throws(() => engine.addAsset('other', { ...data.descriptor, unrenderedSends: ['auxB'] },
    channels), /additional auxiliary/);
});

test('controller shares an existing context, uploads once, and tracks independent overlapping handles', async () => {
  const data = fixture();
  const { player, context, nodes, errors } = owner(data);
  assert.equal(await player.ready, true);
  const ids = await Promise.all([player.play('cue'), player.play('cue')]);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(player.getStatus().effectCount, 2);
  assert.equal(nodes[0].messages.filter((message) => message.type === 'asset').length, 1);
  assert.equal(data.fetches.filter((url) => new URL(url).pathname === data.descriptor.src).length, 1);
  nodes[0].port.onmessage({ data: { type: 'ended', id: ids[0], epoch: 0 } });
  assert.equal(player.getStatus().effectCount, 1);
  assert.equal(player.stop(ids[1]), true);
  assert.equal(player.getStatus().effectCount, 0);
  player.destroy();
  player.destroy();
  assert.equal(context.closeCalls, 0);
  assert.equal(nodes[0].closed, true);
  assert.equal(nodes[0].disconnected, true);
  assert.deepEqual(errors, []);
});

test('reset cancels pending PCM loads while a later request can use the same completed resource', async () => {
  const data = fixture();
  const pending = deferred();
  const requested = deferred();
  const fetchResource = async (url) => {
    if (new URL(url).pathname === data.descriptor.src) {
      requested.resolve();
      return pending.promise;
    }
    return data.fetchResource(url);
  };
  const { player, nodes } = owner(data, { fetchResource });
  const obsolete = player.play('cue');
  await requested.promise;
  player.reset();
  assert.equal(player.getStatus().pendingCount, 0);
  player.replaceEffect('menu');
  const current = player.play('cue');
  pending.resolve(new Response(data.bytes));
  assert.equal(await obsolete, null);
  assert.equal(typeof await current, 'number');
  assert.equal(nodes[0].messages.filter((message) => message.type === 'play').length, 1);
  assert.equal(nodes[0].messages.find((message) => message.type === 'play').epoch, 1);
  player.destroy();
});

test('destroy during catalog loading never creates a node or closes the caller context', async () => {
  const data = fixture();
  const pending = deferred();
  const requested = deferred();
  const fetchResource = async (url) => {
    if (new URL(url).pathname === asset.src) {
      requested.resolve();
      return pending.promise;
    }
    return data.fetchResource(url);
  };
  const { player, context, nodes } = owner(data, { fetchResource });
  const play = player.play('cue');
  await requested.promise;
  player.destroy();
  pending.resolve(new Response(JSON.stringify(data.sidecar)));
  assert.equal(await player.ready, false);
  assert.equal(await play, null);
  assert.equal(nodes.length, 0);
  assert.equal(context.closeCalls, 0);
});

test('destroy during PCM loading prevents a late asset transfer and play', async () => {
  const data = fixture();
  const pending = deferred();
  const requested = deferred();
  const fetchResource = async (url) => {
    if (new URL(url).pathname === data.descriptor.src) {
      requested.resolve();
      return pending.promise;
    }
    return data.fetchResource(url);
  };
  const { player, nodes } = owner(data, { fetchResource });
  const play = player.play('cue');
  await requested.promise;
  player.destroy();
  pending.resolve(new Response(data.bytes));
  assert.equal(await play, null);
  assert.equal(nodes[0].messages.filter((message) => ['asset', 'play'].includes(message.type)).length, 0);
});

test('destroy settles a pending worklet handshake and suppresses later readiness', async () => {
  const data = fixture();
  const { player, nodes } = owner(data, { autoReady: false });
  while (!nodes.length) await new Promise((resolve) => setImmediate(resolve));
  player.destroy();
  assert.equal(await player.ready, false);
  nodes[0].port.onmessage({ data: { type: 'ready' } });
  assert.equal(player.getStatus().ready, false);
});

test('controller rejects HOME profiles and unsupported controls without silently changing playback', async () => {
  const { player, nodes, errors } = owner(fixture());
  assert.equal(await player.ready, true);
  assert.throws(() => player.replaceEffect('home'), /HOME ownership is not integrated/);
  assert.equal(await player.play('cue', { pan: -1 }), null);
  assert.equal(nodes[0].messages.filter((message) => message.type === 'play').length, 0);
  assert.match(errors[0], /dynamic/);
  player.destroy();
});

test('controller rejects partial AuxB cues and excluded raw entries without uploading or playing', async () => {
  const data = fixture();
  data.descriptor.unrenderedSends = ['auxB'];
  const { player, nodes, errors } = owner(data);
  await player.ready;
  assert.equal(await player.play('cue'), null);
  assert.equal(await player.play('raw'), null);
  assert.equal(data.fetches.some((url) => new URL(url).pathname === data.descriptor.src), false);
  assert.equal(nodes[0].messages.some((message) => ['asset', 'play'].includes(message.type)), false);
  assert.equal(errors.length, 2);
  player.destroy();
});

test('explicit original menu routing accepts AuxB writes without creating a second playback owner', async () => {
  const data = fixture();
  data.sidecar.effectProfiles.menu.routing = structuredClone(menuRouting);
  data.descriptor.unrenderedSends = ['auxB'];
  const { player, nodes, errors } = owner(data);
  assert.equal(await player.ready, true);
  assert.equal(typeof await player.play('cue'), 'number');
  assert.equal(nodes[0].messages.filter((message) => message.type === 'asset').length, 1);
  assert.equal(nodes[0].messages.filter((message) => message.type === 'play').length, 1);
  assert.deepEqual(errors, []);
  player.destroy();
});

test('engine admits inactive sends only for the verified static menu routing context', () => {
  const data = fixture();
  const channels = decodePreparedBuses(data.buffer, data.descriptor);
  const descriptor = { ...data.descriptor, unrenderedSends: ['auxB'] };
  const routeProfile = { ...profile, routing: menuRouting };
  const engine = new PreparedEffectsEngine(routeProfile);
  engine.addAsset('cue', descriptor, channels);
  engine.play(1, 'cue');
  engine.render(new Float32Array(96), new Float32Array(96));
  engine.reset();
  engine.replaceEffect(routeProfile);
  assert.throws(() => engine.replaceEffect(profile), /routing context/);
  assert.throws(() => engine.replaceEffect({ ...routeProfile, callback: 'home-direct' }),
    /routing context/);
});

test('loader refuses invented, incomplete or HOME-scoped inactive-route claims', async () => {
  for (const routing of [null, { context: 'other', inactiveAuxiliaryBuses: ['auxB', 'auxC'] },
    { context: 'system-menu-usa-4.3', inactiveAuxiliaryBuses: ['auxB'] }]) {
    const data = fixture();
    data.sidecar.effectProfiles.menu.routing = routing;
    await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, data.fetchResource),
      /routing context/);
  }
  const home = fixture();
  home.sidecar.effectProfiles.menu.callback = 'home-direct';
  home.sidecar.effectProfiles.menu.routing = menuRouting;
  await assert.rejects(loadPreparedBusCatalog(asset, baseUrl, home.fetchResource), /profile/);
});

test('processor errors dispose the node and pending ownership once', async () => {
  const { player, nodes, errors } = owner(fixture());
  await player.ready;
  await player.play('cue');
  nodes[0].onprocessorerror();
  assert.equal(player.getStatus().destroyed, true);
  assert.equal(player.getStatus().effectCount, 0);
  assert.equal(errors.length, 1);
  assert.equal(await player.play('cue'), null);
});
