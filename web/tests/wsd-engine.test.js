import test from 'node:test';
import assert from 'node:assert/strict';
import { WsdEngine } from '../src/wsd-engine.js';

function fixture({ rate = 32000, stereo = false } = {}) {
  const pan = Array(257).fill(0.5);
  pan[0] = 1;
  pan[256] = 0;
  const definition = {
    schemaVersion: 1, sourceKind: 'wsd', sampleRate: 32000, outputMode: 'stereo',
    pitch: 1, pan: 64, surroundPan: 0, mainSend: 127, auxiliarySends: [0, 0, 0],
    envelope: [127, 127, 127, 127], archiveVolume: 96,
    tables: { attack: Array(128).fill(0), sustain: Array(128).fill(0),
      decibels: Array(965).fill(1), pan },
  };
  const left = Float32Array.from([10000, -10000, 20000, -20000, 30000, -30000],
    (value) => value / 32768);
  const channels = [left];
  if (stereo) channels.push(Float32Array.from(left, (value) => -value));
  return { definition, waves: [{ rate, channels }] };
}

function render(engine, frames) {
  const output = Array.from({ length: 4 }, () => new Float32Array(frames));
  engine.renderBuses(...output);
  return output.map((channel) => Array.from(channel, (sample) => sample * 32768));
}

test('WSD stereo keeps independent hard-panned source channels and applies archive gain once', () => {
  const { definition, waves } = fixture({ stereo: true });
  const engine = new WsdEngine(definition, waves);
  // Native VE truncates float32(96/127 * 32767) to 24768. A stereo source
  // uses send 32768 on its own side, not the center-pan coefficient.
  assert.equal(engine.frames, 6);
  const output = render(engine, 8);
  assert.deepEqual(output[0], [7558, -7559, 15117, -15118, 22675, -22676, 0, 0]);
  assert.deepEqual(output[1], [-7559, 7558, -15118, 15117, -22676, 22675, 0, 0]);
  assert.ok(output.slice(2).flat().every((value) => value === 0));
});

test('WSD mono duplicates only after the integer envelope and independently floors center sends', () => {
  const { definition, waves } = fixture();
  const output = render(new WsdEngine(definition, waves), 6);
  assert.deepEqual(output[0], [3779, -3780, 7558, -7559, 11337, -11338]);
  assert.deepEqual(output[1], output[0]);
});

test('44.1 kHz WSD uses the native 16.16 step and finite sample completion across calls', () => {
  const { definition, waves } = fixture({ rate: 44100, stereo: true });
  definition.archiveVolume = 127;
  const engine = new WsdEngine(definition, waves);
  assert.equal(engine.voice.speed, 90316 / 65536);
  assert.equal(engine.frames, 5);
  // Source locations: 0, 1.37811279, 2.75622559, 4.13433838, 5.51245117.
  // The final location clamps its next sample to the finite wave end.
  const first = render(engine, 2);
  const second = render(engine, 5);
  assert.deepEqual([...first[0], ...second[0]], [9999, 1343, -10249, 21939, -30000, 0, 0]);
  const contiguous = render(new WsdEngine(definition, waves), 7);
  assert.deepEqual([...first[1], ...second[1]], contiguous[1]);
});

test('WSD rejects dynamic, looping, noncentered and unverified source parameters', () => {
  for (const change of [
    { sourceKind: 'sequence' }, { outputMode: 'mono' }, { pitch: 2 }, { pan: 63 },
    { envelope: [104, 127, 127, 125] }, { auxiliarySends: [0, 1, 0] },
    { archiveVolume: 128 },
  ]) {
    const { definition, waves } = fixture();
    assert.throws(() => new WsdEngine({ ...definition, ...change }, waves), /Unsupported/);
  }
});

test('WSD validates output channels before consuming its first sample', () => {
  const { definition, waves } = fixture();
  const engine = new WsdEngine(definition, waves);
  assert.throws(() => engine.renderBuses(new Float32Array(1)), /four equal/);
  assert.equal(render(engine, 1)[0][0], 3779);
});
