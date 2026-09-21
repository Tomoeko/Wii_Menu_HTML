import test from 'node:test';
import assert from 'node:assert/strict';
import { SequenceReverb } from '../src/sequence-reverb.js';
import { SequenceEngine } from '../src/sequence-engine.js';
import { decodeSequenceWave, loadSequenceResources } from '../src/sequence-resources.js';

function fixture() {
  return {
    definition: {
      schemaVersion: 1,
      sampleRate: 32000,
      loopStartTick: 0,
      loopEndTick: 2,
      gain: 32 / 127,
      regions: [{ wave: 0, root: 60, volume: 127, pan: 64, tune: 1, envelope: [127, 127, 127, 127] }],
      events: [
        { track: 0, tick: 0, kind: 'volume', value: 127 },
        { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
        { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
        { track: 0, tick: 1, kind: 'volume', value: 0 },
      ],
      tables: {
        attack: Array(128).fill(0),
        sustain: Array(128).fill(0),
        decibels: Array(965).fill(1),
        pan: Array(257).fill(1),
      },
    },
    waves: [{ rate: 32000, channels: [new Float32Array(1200).fill(30000 / 32768)] }],
  };
}

function render(engine, length) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  engine.render(left, right);
  return [left, right];
}

function renderBuses(engine, length) {
  const channels = Array.from({ length: 4 }, () => new Float32Array(length));
  engine.renderBuses(...channels);
  return channels;
}

test('native note-gain rounding reaches signed PCM and survives callback splits', () => {
  for (const [velocity, volume, coefficient] of [[39, 127, 3090], [50, 115, 4598]]) {
    const { definition, waves } = fixture();
    definition.gain = 1;
    definition.loopStartTick = null;
    definition.loopEndTick = null;
    definition.regions[0].volume = volume;
    definition.events = [
      { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity, length: 0 },
    ];
    waves[0].channels = [Float32Array.from({ length: 192 },
      (_, index) => index % 2 ? 32767 / 32768 : -1)];
    const expected = Float32Array.from({ length: 192 },
      (_, index) => (index % 2 ? coefficient - 1 : -coefficient) / 32768);
    const output = render(new SequenceEngine(definition, waves), 192);
    assert.deepEqual(output, [expected, expected]);

    const fragmented = new SequenceEngine(definition, waves);
    const actual = new Float32Array(192);
    let position = 0;
    for (const count of [1, 94, 2, 95]) {
      actual.set(render(fragmented, count)[0], position);
      position += count;
    }
    assert.deepEqual(actual, expected);
  }
});

test('external bus rendering preserves unclipped main output and independently quantized sends', () => {
  const { definition, waves } = fixture();
  definition.gain = 1;
  definition.reverb = syntheticReverb();
  definition.events.unshift({ track: 0, tick: 0, kind: 'auxA', value: 64 });
  waves[0].channels = [new Float32Array(1200).fill(0.75)];
  const engine = new SequenceEngine(definition, waves, { auxiliary: 'external' });
  const channels = renderBuses(engine, 1);
  assert.deepEqual(channels.map((channel) => channel[0] * 32768),
    [49150, 49150, 24768, 24768]);
  assert.equal(engine.samplePosition, 1);
});

test('external bus rendering retains every send across irregular callback and loop boundaries', () => {
  const { definition, waves } = fixture();
  definition.reverb = syntheticReverb();
  definition.events.unshift({ track: 0, tick: 0, kind: 'auxA', value: 64 });
  definition.events.push({ track: 0, tick: 1, kind: 'auxA', value: 0 });
  const expected = renderBuses(new SequenceEngine(definition, waves,
    { auxiliary: 'external' }), 8192);
  const engine = new SequenceEngine(definition, waves, { auxiliary: 'external' });
  const actual = Array.from({ length: 4 }, () => new Float32Array(8192));
  let position = 0;
  for (const count of [1, 95, 1, 127, 128, 2048, 5792]) {
    const block = renderBuses(engine, count);
    block.forEach((channel, index) => actual[index].set(channel, position));
    position += count;
  }
  assert.equal(position, 8192);
  assert.deepEqual(actual, expected);
  assert.equal(actual[2][384], 0);
  assert.notEqual(actual[2][0], 0);
  assert.equal(engine.samplePosition, 8192);
});

test('bus reads require explicit external ownership and validate outputs before consuming samples', () => {
  const { definition, waves } = fixture();
  assert.throws(() => renderBuses(new SequenceEngine(definition, waves), 1), /external/);
  const engine = new SequenceEngine(definition, waves, { auxiliary: 'external' });
  const output = new Float32Array(2);
  assert.throws(() => engine.renderBuses(output, output, output, new Float32Array(1)),
    /equal-length/);
  assert.equal(engine.samplePosition, 0);
  assert.equal(renderBuses(engine, 1)[0][0] * 32768, 15116);
});

test('controller writes affect sustained notes and archive gain applies before PCM saturation', () => {
  const { definition, waves } = fixture();
  const engine = new SequenceEngine(definition, waves);
  const [left, right] = render(engine, 1200);
  assert.equal(left[0] * 32768, 15116);
  assert.ok(left[383] > 0);
  assert.equal(left[384] * 32768, 15116);
  assert.equal(left[479] * 32768, 156);
  assert.equal(left[480], 0);
  assert.deepEqual(left, right);
  assert.ok(Math.max(...left) < 1);
  assert.ok(engine.loopCount >= 1);
});

test('envelope ramps use the initial sample and reset discarded remainders each AX block', () => {
  const { definition, waves } = fixture();
  definition.gain = 1;
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.regions[0].envelope[0] = 32;
  definition.tables.attack[32] = 0.5;
  definition.tables.decibels.fill(0);
  definition.tables.decibels[791] = 0.5;
  definition.tables.decibels[890] = 0.75;
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  waves[0].channels = [new Float32Array(1200).fill(0.5)];
  const [left] = render(new SequenceEngine(definition, waves), 192);
  // Independent instruction checkpoints: 0 -> 16383 has delta 170;
  // 16383 -> 24575 has delta 85. Each sample multiplies PCM 16384.
  const indices = [0, 1, 95, 96, 97, 191];
  assert.deepEqual(indices.map((index) => left[index] * 32768),
    [0, 85, 8075, 8191, 8234, 12229]);
  const fragmented = new SequenceEngine(definition, waves);
  const actual = new Float32Array(192);
  let position = 0;
  for (const count of [1, 94, 1, 1, 95]) {
    actual.set(render(fragmented, count)[0], position);
    position += count;
  }
  assert.deepEqual(actual, left);
});

test('main and auxiliary send changes remain immediate while volume uses a ramp', () => {
  const { definition, waves } = fixture();
  definition.gain = 1;
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.events = [
    { track: 0, tick: 0, kind: 'auxA', value: 127 },
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
    { track: 0, tick: 1, kind: 'mainSend', value: 0 },
    { track: 0, tick: 1, kind: 'auxA', value: 0 },
  ];
  waves[0].channels = [new Float32Array(1200).fill(0.5)];
  const engine = new SequenceEngine(definition, waves);
  const [before] = render(engine, 384);
  assert.ok(before.every((sample) => sample * 32768 === 16383));
  assert.ok(engine.auxLeft.every((sample) => sample * 32768 === 16383));
  const [after] = render(engine, 96);
  assert.ok(after.every((sample) => sample === 0));
  assert.ok(engine.auxLeft.every((sample) => sample === 0));
});

test('decay and release preserve native float32 progression across a decibel-table boundary', () => {
  for (const phase of ['decay', 'release']) {
    const { definition, waves } = fixture();
    definition.gain = 1;
    definition.loopStartTick = null;
    definition.loopEndTick = null;
    definition.regions[0].envelope = [127, 112, 0, 112];
    definition.tables.sustain[0] = -904;
    definition.tables.decibels.fill(0);
    definition.tables.decibels[887] = 0.75;
    definition.events = [
      { track: 0, tick: 0, kind: 'tempo', value: 416 },
      { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127,
        length: phase === 'release' ? 1 : 0 },
    ];
    waves[0].channels = [new Float32Array(1200).fill(0.5)];
    const engine = new SequenceEngine(definition, waves);
    render(engine, 8 * 96);
    // Original instruction checkpoints: rate bits 0x3F5B6DB6, decrement
    // 0x40249248, seventh decrement 0xC18FFFFF. Collapsing operations gives
    // -18 instead and selects the adjacent zero-valued table entry here.
    assert.equal(engine.voices[0].envelopeState, phase);
    assert.equal(engine.voices[0].envelopeLevel, -17.999998092651367);
    assert.equal(render(engine, 1)[0][0] * 32768, 12287);
  }
});

test('envelope lookup preserves the native divide/multiply rounding at a reachable decay boundary', () => {
  const { definition, waves } = fixture();
  definition.gain = 1;
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.regions[0].envelope = [127, 108, 0, 127];
  definition.tables.sustain[0] = -904;
  definition.tables.decibels.fill(0);
  definition.tables.decibels[878] = 0.75;
  definition.tables.decibels[879] = 0.25;
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  waves[0].channels = [new Float32Array(1500).fill(0.5)];
  const engine = new SequenceEngine(definition, waves);
  render(engine, 14 * 96);
  // Decay 108 reaches the same boundary as Symbol Page Open's second voice.
  // Original fdivs gives -2.5999999046325684; fmuls then gives exactly -26.
  // Truncating the envelope directly would select index 879 and PCM 4095.
  assert.equal(engine.voices[0].envelopeLevel, -25.999998092651367);
  assert.equal(render(engine, 1)[0][0] * 32768, 12287);
});

test('offline blocks and irregular live callback sizes produce identical samples through loops', () => {
  const { definition, waves } = fixture();
  definition.reverb = syntheticReverb();
  definition.events.unshift({ track: 0, tick: 0, kind: 'auxA', value: 64 });
  const whole = new SequenceEngine(definition, waves);
  const live = new SequenceEngine(definition, waves);
  const expected = render(whole, 8192);
  const actual = [new Float32Array(8192), new Float32Array(8192)];
  let position = 0;
  for (const count of [1, 127, 128, 511, 2048, 5377]) {
    const block = render(live, count);
    actual[0].set(block[0], position);
    actual[1].set(block[1], position);
    position += count;
  }
  assert.equal(position, 8192);
  assert.deepEqual(actual, expected);
  assert.ok(live.loopCount > 5);
});

test('each voice rounds envelope and independent output sends before summation', () => {
  const { definition, waves } = fixture();
  definition.gain = 0.5;
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.tables.pan.fill(0.5);
  definition.events = [
    { track: 0, tick: 0, kind: 'auxA', value: 64 },
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  waves[0].channels = [Float32Array.from([1, -1, 3, -3, 1001, -1001], (sample) => sample / 32768)];
  const engine = new SequenceEngine(definition, waves);
  const [left, right] = render(engine, 6);
  assert.deepEqual(Array.from(left, (sample) => sample * 32768), [0, -2, 0, -2, 500, -502]);
  assert.deepEqual(right, left);
  assert.deepEqual(Array.from(engine.auxLeft.slice(0, 6), (sample) => sample * 32768),
    [0, -2, 0, -2, 250, -254]);
});

test('integer volume stages preserve the existing fractional interpolation positions', () => {
  const { definition, waves } = fixture();
  definition.gain = 1;
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  waves[0].rate = 16000;
  waves[0].channels = [Float32Array.from([0, 100, 200, 300], (sample) => sample / 32768)];
  const [left] = render(new SequenceEngine(definition, waves), 7);
  assert.deepEqual(Array.from(left, (sample) => sample * 32768), [0, 49, 99, 149, 199, 249, 299]);
});

test('noninteger source rates retain fixed-point phase across blocks and callback splits', () => {
  const { definition, waves } = fixture();
  definition.gain = 1;
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  waves[0].rate = 44100;
  waves[0].channels = [new Float32Array(2000).fill(0.5, 1379)];
  const [expected] = render(new SequenceEngine(definition, waves), 1002);
  // Step 90316/65536 reaches 1378 + 7392/65536 at output 1000.
  // Linear interpolation gives PCM 1848, then the envelope stage gives 1847.
  assert.deepEqual(Array.from(expected.slice(999), (sample) => sample * 32768),
    [0, 1847, 16383]);
  const fragmented = new SequenceEngine(definition, waves);
  const actual = new Float32Array(1002);
  let position = 0;
  for (const count of [511, 489, 1, 1]) {
    actual.set(render(fragmented, count)[0], position);
    position += count;
  }
  assert.deepEqual(actual, expected);
});

test('an immediate note release silences an unfinished attack on the following AX update', () => {
  const { definition, waves } = fixture();
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 1 },
  ];
  definition.loopEndTick = 100;
  definition.regions[0].envelope = [32, 80, 0, 127];
  definition.tables.attack.fill(0.5);
  definition.tables.sustain.fill(-723);
  definition.tables.decibels = Array.from({ length: 965 }, (_, index) =>
    index === 0 ? 0 : 10 ** ((index - 904) / 200),
  );
  const [left] = render(new SequenceEngine(definition, waves), 960);
  assert.equal(left[0], 0);
  assert.ok(left[96] > 0);
  assert.ok(left[384] > 0);
  assert.ok(left.slice(480).every((sample) => sample === 0));
});

test('unmapped sample and malformed event inputs fail before playback', () => {
  const { definition, waves } = fixture();
  definition.regions[0].wave = 99;
  assert.throws(() => new SequenceEngine(definition, waves), /instrument region/);
  definition.regions[0].wave = 0;
  definition.events[0].tick = -1;
  assert.throws(() => new SequenceEngine(definition, waves), /event ordering/);
});

test('zero-length note wait resumes after DSP completion, then observes the explicit rest', () => {
  const { definition, waves } = fixture();
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.gain = 1;
  waves[0].channels = [new Float32Array(199).fill(0.25)];
  waves.push({ rate: 32000, channels: [new Float32Array(360).fill(-0.5)] });
  definition.regions.push({ ...definition.regions[0], wave: 1 });
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0, waitForEnd: true },
    { track: 0, tick: 1, kind: 'note', region: 1, key: 60, velocity: 127, length: 0 },
  ];
  const whole = render(new SequenceEngine(definition, waves), 1800)[0];
  assert.ok(whole.slice(0, 199).every((sample) => sample === 8191 / 32768));
  assert.ok(whole.slice(199, 1056).every((sample) => sample === 0));
  assert.ok(whole.slice(1056, 1416).every((sample) => sample === -0.5));
  assert.ok(whole.slice(1416).every((sample) => sample === 0));
  const live = new SequenceEngine(definition, waves);
  const fragmented = new Float32Array(1800);
  let position = 0;
  for (const count of [1, 198, 185, 288, 383, 1, 744]) {
    fragmented.set(render(live, count)[0], position);
    position += count;
  }
  assert.deepEqual(fragmented, whole);
  definition.events[0].waitForEnd = false;
  const withoutWait = render(new SequenceEngine(definition, waves), 800)[0];
  assert.equal(withoutWait[384], -0.5);
});

test('a voice-finish wait holds same-tick controls without blocking another track', () => {
  const { definition, waves } = fixture();
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.gain = 1;
  waves[0].channels = [new Float32Array(199).fill(0.25)];
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0, waitForEnd: true },
    { track: 0, tick: 0, kind: 'volume', value: 0 },
    { track: 0, tick: 1, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
    { track: 1, tick: 1, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  const [left] = render(new SequenceEngine(definition, waves), 1500);
  assert.equal(left[0], 8191 / 32768);
  assert.equal(left[384], 8191 / 32768);
  assert.ok(left.slice(583).every((sample) => sample === 0));
});

test('unverified looping or nonzero-length voice-finish waits fail before playback', () => {
  const { definition, waves } = fixture();
  definition.events[1].waitForEnd = true;
  assert.throws(() => new SequenceEngine(definition, waves), /sequence note/);
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.events[1].length = 2;
  assert.throws(() => new SequenceEngine(definition, waves), /sequence note/);
});

test('voice-finish waits include earlier overlapping voices on the same track', () => {
  const { definition, waves } = fixture();
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.gain = 1;
  waves[0].channels = [new Float32Array(500).fill(0.25)];
  waves.push({ rate: 32000, channels: [new Float32Array(199).fill(0.25)] });
  waves.push({ rate: 32000, channels: [new Float32Array(32).fill(-0.5)] });
  definition.regions.push({ ...definition.regions[0], wave: 1 });
  definition.regions.push({ ...definition.regions[0], wave: 2 });
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
    { track: 0, tick: 0, kind: 'note', region: 1, key: 60, velocity: 127, length: 0, waitForEnd: true },
    { track: 0, tick: 1, kind: 'note', region: 2, key: 60, velocity: 127, length: 0 },
  ];
  const [left] = render(new SequenceEngine(definition, waves), 1500);
  assert.ok(left.slice(0, 199).every((sample) => sample === 16382 / 32768));
  assert.ok(left.slice(199, 500).every((sample) => sample === 8191 / 32768));
  assert.ok(left.slice(500, 1344).every((sample) => sample === 0));
  assert.ok(left.slice(1344, 1376).every((sample) => sample === -0.5));
});

test('original instrument PCM preserves channels and sample rate without browser resampling', () => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  for (const [index, value] of [32767, -32768, 16384, -16384].entries()) {
    view.setInt16(index * 2, value, true);
  }
  const wave = decodeSequenceWave(buffer, { frames: 2, channels: 2, rate: 44100 });
  assert.equal(wave.rate, 44100);
  assert.deepEqual([...wave.channels[0]], [32767 / 32768, 0.5]);
  assert.deepEqual([...wave.channels[1]], [-1, -0.5]);
  assert.throws(() => decodeSequenceWave(buffer, { frames: 3, channels: 2, rate: 44100 }), /PCM resource/);
});

test('sequence resource loading refuses remote instrument requests', async () => {
  const requested = [];
  const fetchResource = async (url) => {
    requested.push(url);
    return { ok: true, json: async () => ({ waves: [{ src: 'https://outside.invalid/private.pcm' }] }) };
  };
  await assert.rejects(
    loadSequenceResources({ src: '/assets/sequence.json' }, 'http://127.0.0.1:5173/', fetchResource),
    /local host/,
  );
  assert.deepEqual(requested, ['http://127.0.0.1:5173/assets/sequence.json']);
});

function syntheticReverb() {
  return { delayFrames: [101, 149, 193, 29, 11, 7, 13, 17], preset: [0, 0.1, 0.5, 0.1, 0, 1] };
}

test('native reverb network retains a decaying stereo tail after the original impulse', () => {
  const reverb = new SequenceReverb(syntheticReverb());
  const output = [new Float32Array(32000), new Float32Array(32000)];
  for (let frame = 0; frame < output[0].length; frame += 1) {
    for (let channel = 0; channel < 2; channel += 1) {
      output[channel][frame] = reverb.process(channel, frame === 0 ? 0.5 : 0);
    }
  }
  assert.ok(output[0].slice(0, 101).every((sample) => sample === 0));
  assert.ok(output[0][101] < 0);
  assert.notDeepEqual(output[0], output[1]);
  assert.ok(output[0].slice(400, 2000).some((sample) => sample !== 0));
  assert.ok(output[0].slice(16000).every((sample) => sample === 0));
});

test('AX auxiliary return delays the filter output by two blocks without delaying the dry signal', () => {
  const { definition } = fixture();
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.gain = 1;
  definition.events = [
    { track: 0, tick: 0, kind: 'auxA', value: 127 },
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  definition.reverb = syntheticReverb();
  const waves = [{ rate: 32000, channels: [new Float32Array([0.5])] }];
  const output = render(new SequenceEngine(definition, waves), 2000);
  const filter = new SequenceReverb(definition.reverb);
  const expected = [new Float32Array(2000), new Float32Array(2000)];
  expected[0][0] = expected[1][0] = 16383 / 32768;
  for (let frame = 0; frame < 1808; frame++) {
    for (let channel = 0; channel < 2; channel++) {
      expected[channel][frame + 192] += filter.process(channel, frame === 0 ? 16383 / 32768 : 0);
    }
  }
  assert.deepEqual(output, expected);
  assert.ok(output[0].slice(1, 293).every((sample) => sample === 0));
  assert.notEqual(output[0][293], 0);
});

test('AuxA automation changes sustained voices and leaves an unsent sequence completely dry', () => {
  const { definition, waves } = fixture();
  definition.loopStartTick = null;
  definition.loopEndTick = null;
  definition.events = [
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
  ];
  const [dry] = render(new SequenceEngine(definition, waves), 8000);
  definition.reverb = syntheticReverb();
  const [unsent] = render(new SequenceEngine(definition, waves), 8000);
  assert.deepEqual(unsent, dry);
  definition.events.push({ track: 0, tick: 1, kind: 'auxA', value: 64 });
  const engine = new SequenceEngine(definition, waves);
  const [wet] = render(engine, 8000);
  assert.deepEqual(wet.slice(0, 677), dry.slice(0, 677));
  assert.notEqual(wet[677], dry[677]);
  assert.ok(wet.slice(1200, 2000).some((sample) => sample !== 0));
  assert.equal(engine.loopCount, 0);
  assert.equal(engine.voices.length, 0);
});

test('envelope overrides apply at note-on in original command order', () => {
  const { definition, waves } = fixture();
  definition.events = [
    { track: 0, tick: 0, kind: 'attack', value: 32 },
    { track: 0, tick: 0, kind: 'note', region: 0, key: 60, velocity: 127, length: 0 },
    { track: 0, tick: 0, kind: 'attack', value: 127 },
  ];
  const engine = new SequenceEngine(definition, waves);
  render(engine, 1);
  assert.equal(engine.voices[0].envelope[0], 32);
  assert.equal(engine.tracks[0].attack, 127);
});
