import test from 'node:test';
import assert from 'node:assert/strict';
import { SequenceAuxiliaryBus } from '../src/sequence-aux-bus.js';
import { SequenceReverb } from '../src/sequence-reverb.js';

const identity = { process: (channel, value) => value };
const amplify = { process: (channel, value) => value * 10 };

function process(bus, left = 0, right = left) {
  const input = [left, right].map((value) => new Float32Array(96).fill(value));
  const output = [new Float32Array(96), new Float32Array(96)];
  bus.processBlock(...input, ...output);
  return output;
}

test('independent native slots return each stereo send two blocks later', () => {
  const bus = new SequenceAuxiliaryBus(identity);
  assert.equal(process(bus, 1, -2)[0][0], 0);
  assert.equal(process(bus, 3, -4)[0][0], 0);
  const first = process(bus, 5, -6);
  assert.ok(first[0].every((sample) => sample === 1));
  assert.ok(first[1].every((sample) => sample === -2));
  const second = process(bus);
  assert.equal(second[0][95], 3);
  assert.equal(second[1][95], -4);
});

test('replacement preserves an old processed return and applies the new filter to pending input', () => {
  for (let phase = 0; phase < 3; phase += 1) {
    for (const unregisterFirst of [false, true]) {
      const bus = new SequenceAuxiliaryBus(identity);
      for (let block = 0; block < phase; block += 1) process(bus);
      process(bus, 1);
      process(bus, 2);
      if (unregisterFirst) bus.replaceEffect(null);
      // No newly built null block intervened, so its deferred-clear flags do
      // not prevent the admitted replacement from consuming pending data.
      bus.replaceEffect(amplify);
      assert.equal(process(bus)[0][0], 1);
      assert.equal(process(bus)[0][0], 20);
      assert.equal(process(bus)[0][0], 0);
    }
  }
});

test('unregistering clears pending input only if a null-callback update actually occurs', () => {
  for (let phase = 0; phase < 3; phase += 1) {
    for (let nullBlocks = 0; nullBlocks <= 3; nullBlocks += 1) {
      const bus = new SequenceAuxiliaryBus(identity);
      for (let block = 0; block < phase; block += 1) process(bus);
      process(bus, 1);
      bus.replaceEffect(null);
      for (let block = 0; block < nullBlocks; block += 1) process(bus, 99);
      bus.replaceEffect(amplify);
      assert.equal(process(bus)[0][0], 0);
      assert.equal(process(bus)[0][0], nullBlocks === 0 ? 10 : 0,
        `ring phase ${phase}, ${nullBlocks} disabled updates`);
      assert.equal(process(bus)[0][0], 0);
    }
  }
});

test('new null blocks suppress both buses while retained slots await their own CPU clear', () => {
  for (let phase = 0; phase < 3; phase += 1) {
    const bus = new SequenceAuxiliaryBus(identity);
    for (let block = 0; block < phase; block += 1) process(bus);
    process(bus, 1, -2);
    process(bus, 3, -4);
    const retainedReturn = bus.slots[bus.readIndex];
    const retainedSamples = retainedReturn.map((channel) => channel.slice());
    bus.replaceEffect(null);
    const input = [new Float32Array(96).fill(99), new Float32Array(96).fill(-99)];
    // Reused nonzero output buffers must be overwritten with silence even
    // though this separate retained slot has not reached the CPU clear yet.
    const output = retainedSamples.map((channel) => channel.slice());
    bus.processBlock(...input, ...output);
    assert.ok(output.every((channel) => channel.every((sample) => sample === 0)));
    assert.deepEqual(retainedReturn, retainedSamples);
    for (let block = 0; block < 2; block += 1) {
      assert.ok(process(bus, 99).every((channel) => channel.every((sample) => sample === 0)));
    }
    bus.replaceEffect(identity);
    for (let block = 0; block < 5; block += 1) {
      assert.ok(process(bus).every((channel) => channel.every((sample) => sample === 0)));
    }
  }
});

test('continuous shared ReverbHi matches a delayed filter and processes tails with no new sends', () => {
  const preset = { delayFrames: [101, 149, 193, 29, 11, 7, 13, 17],
    preset: [0, 0.1, 0.5, 0.1, 0, 1] };
  const bus = new SequenceAuxiliaryBus(new SequenceReverb(preset));
  const reference = new SequenceReverb(preset);
  const expected = [new Float32Array(96 * 40), new Float32Array(96 * 40)];
  const actual = expected.map((channel) => new Float32Array(channel.length));
  for (let block = 0; block < 40; block += 1) {
    const input = [new Float32Array(96), new Float32Array(96)];
    if (block === 0 || block === 2) {
      input[0][7] = 0.5;
      input[1][7] = -0.25;
    }
    const output = [new Float32Array(96), new Float32Array(96)];
    bus.processBlock(...input, ...output);
    for (let channel = 0; channel < 2; channel += 1) {
      actual[channel].set(output[channel], block * 96);
      for (let frame = 0; frame < 96; frame += 1) {
        const value = reference.process(channel, input[channel][frame]);
        const target = block * 96 + frame + 192;
        if (target < expected[channel].length) expected[channel][target] = value;
      }
    }
  }
  assert.deepEqual(actual, expected);
  assert.ok(actual[0].slice(1000, 2000).some((sample) => sample !== 0));
});

test('invalid callback or block cannot replace the effect or advance its transport', () => {
  const bus = new SequenceAuxiliaryBus(identity);
  const samples = new Float32Array(96);
  assert.throws(() => bus.replaceEffect({}), /provide process/);
  assert.throws(() => bus.processBlock(samples, samples, samples, new Float32Array(95)),
    /96-sample/);
  process(bus, 2);
  process(bus);
  assert.equal(process(bus)[0][0], 2);
});
