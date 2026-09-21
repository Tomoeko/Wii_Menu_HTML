import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageEffectBuses, writeSequenceBuses } from '../../tools/assets/render_sequence_buses.mjs';
import { readLocalSequenceResources } from '../../tools/assets/sequence_resources.mjs';

function fixture() {
  return {
    definition: {
      schemaVersion: 1,
      rendererVersion: 10,
      sourceArchiveSha256: 'a'.repeat(64),
      sourceDriverSha256: 'b'.repeat(64),
      sampleRate: 32000,
      loopStartTick: null,
      loopEndTick: null,
      gain: 1,
      offline: { frames: 1200, trimSilence: true },
      regions: [{ wave: 0, root: 60, volume: 127, pan: 64, tune: 1,
        envelope: [127, 127, 127, 127] }],
      events: [
        { track: 0, tick: 0, kind: 'auxA', value: 64 },
        { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
        { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
      ],
      tables: {
        attack: Array(128).fill(0),
        sustain: Array(128).fill(0),
        decibels: Array(965).fill(1),
        pan: Array(257).fill(1),
      },
    },
    waves: [{ rate: 32000, channels: [new Float32Array([0.75, -0.75, 0])] }],
  };
}

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-sequence-buses-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('bus export retains signed overlap headroom and trims only trailing dry/send zeros', async (t) => {
  const directory = await temporary(t);
  const { definition, waves } = fixture();
  const path = join(directory, 'cue.pcm');
  const descriptor = await writeSequenceBuses(definition, waves, path);
  const bytes = await readFile(path);
  const samples = Array.from({ length: bytes.length / 4 },
    (_, index) => bytes.readInt32LE(index * 4));
  assert.deepEqual(samples, [49150, 49150, 24768, 24768, -49152, -49152, -24770, -24770]);
  assert.equal(descriptor.frames, 2);
  assert.equal(descriptor.pcmScale, 32768);
  assert.equal(descriptor.peakPcm, 49152);
  assert.equal(descriptor.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(descriptor.rendererVersion, 10);
  assert.equal(descriptor.schemaVersion, 1);
});

test('bus export keeps native note-gain boundaries in both dry and auxiliary PCM', async (t) => {
  const directory = await temporary(t);
  const { definition, waves } = fixture();
  definition.regions[0].volume = 115;
  definition.events = [
    { track: 0, tick: 0, kind: 'auxA', value: 127 },
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 50, length: 0 },
  ];
  waves[0].channels = [new Float32Array([-1, 32767 / 32768])];
  const path = join(directory, 'note-gain.pcm');
  const descriptor = await writeSequenceBuses(definition, waves, path);
  const bytes = await readFile(path);
  const samples = Array.from({ length: bytes.length / 4 },
    (_, index) => bytes.readInt32LE(index * 4));
  assert.deepEqual(samples, [-4598, -4598, -4598, -4598, 4597, 4597, 4597, 4597]);
  assert.equal(descriptor.frames, 2);
});

test('bus export preserves leading silence and a loop period including its trailing zeros', async (t) => {
  const directory = await temporary(t);
  const finite = fixture();
  finite.definition.events.forEach((event) => { event.tick = 1; });
  const finitePath = join(directory, 'delayed.pcm');
  const finiteDescriptor = await writeSequenceBuses(finite.definition, finite.waves, finitePath);
  const delayed = await readFile(finitePath);
  assert.equal(finiteDescriptor.frames, 386);
  assert.ok(delayed.subarray(0, 384 * 16).every((byte) => byte === 0));
  assert.equal(delayed.readInt32LE(384 * 16), 49150);

  const periodic = fixture();
  periodic.definition.loopStartTick = 0;
  periodic.definition.loopEndTick = 1;
  periodic.definition.offline = { frames: 384, trimSilence: true,
    loopStart: 0, loopEnd: 384 / 32000 };
  const periodicPath = join(directory, 'loop.pcm');
  const descriptor = await writeSequenceBuses(periodic.definition, periodic.waves, periodicPath);
  assert.equal(descriptor.frames, 384);
  assert.equal(descriptor.loopEndFrame, 384);
  assert.equal((await readFile(periodicPath)).length, 384 * 16);
});

test('bus descriptors disclose sends outside the implemented Aux A route', async (t) => {
  const directory = await temporary(t);
  const { definition, waves } = fixture();
  definition.events.unshift({ track: 0, tick: 0, kind: 'auxB', value: 127 });
  const descriptor = await writeSequenceBuses(definition, waves, join(directory, 'cue.pcm'));
  assert.deepEqual(descriptor.unrenderedSends, ['auxB']);
});

test('bus export rejects fractional loop markers before creating an output file', async (t) => {
  const directory = await temporary(t);
  const { definition, waves } = fixture();
  definition.offline.loopStart = 0;
  definition.offline.loopEnd = 1.5 / 32000;
  const path = join(directory, 'invalid.pcm');
  await assert.rejects(writeSequenceBuses(definition, waves, path), /integer frame/);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

async function preparedFixture(directory) {
  const assets = join(directory, 'assets');
  await mkdir(join(assets, 'audio'), { recursive: true });
  const { definition } = fixture();
  definition.reverb = {
    delayFrames: [101, 149, 193, 29, 11, 7, 13, 17],
    preset: [0, 0.1, 0.5, 0.1, 0, 1],
  };
  definition.waves = [{ src: '/assets/audio/wave.pcm', rate: 32000, channels: 1, frames: 1 }];
  const bytes = Buffer.alloc(2);
  bytes.writeInt16LE(24576);
  await writeFile(join(assets, 'audio/wave.pcm'), bytes);
  await writeFile(join(assets, 'audio/cue-sequence.json'), JSON.stringify(definition));
  const catalog = {
    cue: { src: '/assets/audio/cue.wav', sourceSymbol: 'SYNTHETIC_CUE',
      rendering: 'original-sequence-built-in-dry-approximate' },
    raw: { src: '/assets/audio/raw.wav', rendering: 'decoded-original-wave' },
    background: { src: '/assets/audio/background.wav', rendering: 'native-capture' },
  };
  await writeFile(join(assets, 'audio.json'), JSON.stringify(catalog));
  return assets;
}

test('staged exporter emits an additive sidecar and preserves the existing audio catalog', async (t) => {
  const directory = await temporary(t);
  const assets = await preparedFixture(directory);
  const before = await readFile(join(assets, 'audio.json'));
  const output = join(directory, 'staged');
  const result = await stageEffectBuses(assets, output);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.sounds.cue.schemaVersion, 1);
  assert.equal(result.effectProfiles.menu.callback, 'menu-chain');
  assert.deepEqual(result.effectProfiles.menu.routing, {
    context: 'system-menu-usa-4.3', inactiveAuxiliaryBuses: ['auxB', 'auxC'],
  });
  assert.deepEqual(Object.keys(result.sounds), ['cue']);
  assert.deepEqual(Object.keys(result.unsupported), ['raw']);
  assert.equal(result.sounds.cue.src, '/assets/audio/cue-buses.pcm');
  assert.equal(result.sounds.cue.sourceSymbol, 'SYNTHETIC_CUE');
  assert.equal(result.sourceAudioSha256, createHash('sha256').update(before).digest('hex'));
  assert.deepEqual(JSON.parse(await readFile(join(output, 'audio-buses.json'), 'utf8')), result);
  assert.deepEqual(await readFile(join(assets, 'audio.json')), before);
  await assert.rejects(stageEffectBuses(assets, output), /empty staging/);
});

test('staged WSD buses use their own definition and baked archive gain without mutating WAV catalog', async (t) => {
  const directory = await temporary(t);
  const assets = await preparedFixture(directory);
  const catalog = JSON.parse(await readFile(join(assets, 'audio.json'), 'utf8'));
  catalog.raw = { sourceSymbol: 'WSD_SELECT', rendering: 'decoded-original-wave', gain: 96 / 127 };
  await writeFile(join(assets, 'audio.json'), JSON.stringify(catalog));
  const before = await readFile(join(assets, 'audio.json'));
  const resources = join(directory, 'wsd');
  await mkdir(join(resources, 'audio'), { recursive: true });
  const { definition: sequence } = fixture();
  const definition = {
    schemaVersion: 1, sourceKind: 'wsd', sourceSymbol: 'WSD_SELECT',
    sampleRate: 32000, outputMode: 'stereo', pitch: 1, pan: 64, surroundPan: 0,
    mainSend: 127, auxiliarySends: [0, 0, 0], envelope: [127, 127, 127, 127], archiveVolume: 96,
    tables: sequence.tables, rendererVersion: 10,
    sourceArchiveSha256: sequence.sourceArchiveSha256,
    sourceDriverSha256: sequence.sourceDriverSha256,
    waves: [{ src: '/assets/audio/wsd.pcm', rate: 32000, channels: 2, frames: 2 }],
  };
  definition.tables.pan[128] = 0.5;
  definition.tables.pan[256] = 0;
  const bytes = Buffer.alloc(8);
  bytes.writeInt16LE(10000, 0);
  bytes.writeInt16LE(-10000, 2);
  await writeFile(join(resources, 'audio/wsd.pcm'), bytes);
  await writeFile(join(resources, 'audio/raw-wsd.json'), JSON.stringify(definition));
  const output = join(directory, 'staged-wsd');
  const result = await stageEffectBuses(assets, output, { wsdResources: resources });
  assert.deepEqual(Object.keys(result.sounds), ['cue', 'raw']);
  const descriptor = result.sounds.raw;
  assert.equal(descriptor.schemaVersion, 2);
  assert.equal(descriptor.sourceKind, 'wsd');
  assert.equal(descriptor.gainOwner, 'buses');
  assert.equal(descriptor.archiveVolume, 96);
  assert.equal(descriptor.frames, 2); // finite source length retains its trailing zero
  assert.equal(descriptor.sourceSequenceSha256, undefined);
  assert.match(descriptor.sourceDefinitionSha256, /^[a-f0-9]{64}$/);
  const rendered = await readFile(join(output, 'audio/raw-buses.pcm'));
  assert.equal(rendered.readInt32LE(0), 7558);
  assert.equal(rendered.readInt32LE(4), -7559);
  assert.deepEqual(await readFile(join(assets, 'audio.json')), before);
});

test('staged exporter rejects the input directory and aliases into it', async (t) => {
  const directory = await temporary(t);
  const assets = await preparedFixture(directory);
  await assert.rejects(stageEffectBuses(assets, assets), /outside the input assets/);
  await assert.rejects(stageEffectBuses(assets, join(assets, 'new-output')), /outside/);
  const alias = join(directory, 'input-alias');
  await symlink(assets, alias, 'dir');
  await assert.rejects(stageEffectBuses(assets, alias), /outside the input assets/);
  await assert.rejects(stageEffectBuses(assets, join(alias, 'new-output')), /outside/);
  await assert.rejects(stat(join(assets, 'new-output')), { code: 'ENOENT' });
});

test('shared local resource reader rejects a wave path escaping the prepared assets', async (t) => {
  const directory = await temporary(t);
  const assets = await preparedFixture(directory);
  const path = join(assets, 'audio/cue-sequence.json');
  const definition = JSON.parse(await readFile(path, 'utf8'));
  definition.waves[0].src = '/assets/../outside.pcm';
  await writeFile(path, JSON.stringify(definition));
  await assert.rejects(readLocalSequenceResources(path, assets), /escapes/);
});
