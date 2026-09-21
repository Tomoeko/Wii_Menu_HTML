import test from 'node:test';
import assert from 'node:assert/strict';

let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.messages = [];
    this.port = { postMessage: (message) => this.messages.push(message) };
  }
};
globalThis.registerProcessor = (name, constructor) => {
  assert.equal(name, 'wii-menu-prepared-effects');
  Processor = constructor;
};
globalThis.sampleRate = 48000;
await import('../src/prepared-effects-worklet.js');

function initialized() {
  const processor = new Processor();
  const send = (data) => processor.port.onmessage({ data });
  send({ type: 'initialize', epoch: 0, profile: {
    callback: 'menu-chain',
    delayFrames: [101, 149, 193, 29, 11, 7, 13, 17], preset: [0, 0.1, 0.5, 0.1, 0, 1],
  } });
  const descriptor = { schemaVersion: 1, encoding: 's32le', pcmScale: 32768,
    channels: ['mainLeft', 'mainRight', 'auxALeft', 'auxARight'],
    sampleRate: 32000, blockFrames: 96, frames: 4, rendererVersion: 10,
    sha256: 'a'.repeat(64), sourceSequenceSha256: 'a'.repeat(64),
    sourceArchiveSha256: 'a'.repeat(64), sourceDriverSha256: 'a'.repeat(64), unrenderedSends: [] };
  send({ type: 'asset', epoch: 0, name: 'cue', descriptor, channels: [
    Int32Array.from([0, 1000, 2000, 3000]), Int32Array.from([0, -1000, -2000, -3000]),
    new Int32Array(4), new Int32Array(4),
  ] });
  return { processor, send };
}

function render(processor, frames) {
  const output = [new Float32Array(frames), new Float32Array(frames)];
  const running = processor.process([], [output]);
  return { output, running };
}

test('actual worklet converts native output to 48 kHz after mixing and preserves callback partitions', () => {
  const whole = initialized();
  whole.send({ type: 'play', epoch: 0, id: 1, name: 'cue', options: {} });
  const expected = render(whole.processor, 128).output;
  const reference = [0, 2000 / 3, 4000 / 3, 2000, 8000 / 3, 2000, 0];
  reference.forEach((sample, frame) => {
    assert.ok(Math.abs(expected[0][frame] * 32768 - sample) < 0.001);
    assert.ok(Math.abs(expected[1][frame] * 32768 + sample) < 0.001);
  });
  const fragmented = initialized();
  fragmented.send({ type: 'play', epoch: 0, id: 1, name: 'cue', options: {} });
  const actual = [new Float32Array(128), new Float32Array(128)];
  let position = 0;
  for (const count of [1, 2, 7, 118]) {
    const { output } = render(fragmented.processor, count);
    output.forEach((channel, index) => actual[index].set(channel, position));
    position += count;
  }
  assert.deepEqual(actual, expected);
  assert.ok(whole.processor.messages.some((message) => message.type === 'ended' && message.id === 1));
});

test('actual worklet ignores stale post-reset requests and cannot be revived after destroy', () => {
  const { processor, send } = initialized();
  send({ type: 'play', epoch: 0, id: 1, name: 'cue', options: {} });
  send({ type: 'reset', epoch: 1 });
  send({ type: 'play', epoch: 0, id: 2, name: 'cue', options: {} });
  assert.equal(processor.engine.voices.size, 0);
  send({ type: 'play', epoch: 1, id: 3, name: 'cue', options: {} });
  assert.equal(processor.engine.voices.size, 1);
  render(processor, 128);
  assert.ok(processor.messages.some((message) => message.type === 'ended' && message.id === 3 &&
    message.epoch === 1));
  send({ type: 'destroy' });
  send({ type: 'initialize', epoch: 2, profile: {} });
  assert.equal(processor.engine, null);
  assert.equal(render(processor, 128).running, false);
});
