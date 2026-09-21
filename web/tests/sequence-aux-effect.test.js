import test from 'node:test';
import assert from 'node:assert/strict';
import { SequenceAuxiliaryBus } from '../src/sequence-aux-bus.js';
import { SequenceAuxiliaryEffect } from '../src/sequence-aux-effect.js';
import { SequenceReverb } from '../src/sequence-reverb.js';

const profile = {
  callback: 'menu-chain',
  delayFrames: [101, 149, 193, 29, 11, 7, 13, 17],
  preset: [0, 0.1, 0.5, 0.1, 0, 1],
};

function channels(value = 0) {
  return [new Float32Array(96).fill(value), new Float32Array(96).fill(-value)];
}

function process(bus, value = 0) {
  const output = channels();
  bus.processBlock(...channels(value), ...output);
  return output;
}

test('menu clears two complete callbacks without feeding or advancing the reverb', () => {
  const callback = new SequenceAuxiliaryEffect(profile);
  const pristine = structuredClone(callback.reverb);
  for (const value of [0.25, -0.5]) {
    const buffer = channels(value);
    callback.processBlock(...buffer);
    assert.ok(buffer.every((channel) => channel.every((sample) => sample === 0)));
    assert.deepEqual(structuredClone(callback.reverb), pristine);
  }
  const actual = channels(0.125);
  const expected = channels(0.125);
  const reference = new SequenceReverb(profile);
  for (let frame = 0; frame < 96; frame += 1) {
    for (let channel = 0; channel < 2; channel += 1) {
      expected[channel][frame] = reference.process(channel, expected[channel][frame]);
    }
  }
  callback.processBlock(...actual);
  assert.deepEqual(actual, expected);
  assert.deepEqual(structuredClone(callback.reverb), structuredClone(reference));
});

test('HOME direct registration processes immediately despite identical numeric profile', () => {
  const home = new SequenceAuxiliaryEffect({ ...profile, callback: 'home-direct' });
  const menu = new SequenceAuxiliaryEffect(profile);
  const homeBuffer = channels(0.5);
  const menuBuffer = channels(0.5);
  home.processBlock(...homeBuffer);
  menu.processBlock(...menuBuffer);
  assert.notDeepEqual(structuredClone(home.reverb), structuredClone(menu.reverb));
  // The first block need not have a nonzero return yet: the input must still
  // be retained in HOME's delay lines and emerge during later zero input.
  let homeTail = false;
  for (let block = 0; block < 12; block += 1) {
    const homeOutput = channels();
    const menuOutput = channels();
    home.processBlock(...homeOutput);
    menu.processBlock(...menuOutput);
    homeTail ||= homeOutput[0].some((sample) => sample !== 0);
    assert.ok(menuOutput[0].every((sample) => sample === 0));
  }
  assert.equal(homeTail, true);
});

test('menu replacement keeps queued old returns but clears pending sends at each ring phase', () => {
  for (let phase = 0; phase < 3; phase += 1) {
    const bus = new SequenceAuxiliaryBus({ process: (channel, sample) => sample });
    for (let block = 0; block < phase; block += 1) process(bus);
    process(bus, 0.25);
    process(bus, 0.5);
    const menu = new SequenceAuxiliaryEffect(profile);
    bus.replaceEffect(menu);
    const queuedReturn = process(bus, 0.75);
    assert.equal(queuedReturn[0][0], 0.25);
    assert.equal(queuedReturn[1][0], -0.25);
    // First callback discarded pending 0.5; second discards the 0.75 that
    // arrived during replacement. Neither send can seed the fresh filter.
    for (let block = 0; block < 12; block += 1) {
      assert.ok(process(bus)[0].every((sample) => sample === 0));
    }
  }
});

test('null updates do not consume a future menu callback startup counter', () => {
  const bus = new SequenceAuxiliaryBus(null);
  for (let block = 0; block < 5; block += 1) process(bus, 1);
  const menu = new SequenceAuxiliaryEffect(profile);
  bus.replaceEffect(menu);
  process(bus, 0.5);
  process(bus);
  for (let block = 0; block < 12; block += 1) {
    assert.ok(process(bus)[0].every((sample) => sample === 0));
  }
});

test('invalid callback ownership and block dimensions fail before consuming startup state', () => {
  assert.throws(() => new SequenceAuxiliaryEffect({ ...profile, callback: undefined }),
    /explicit callback/);
  const menu = new SequenceAuxiliaryEffect(profile);
  assert.throws(() => menu.processBlock(new Float32Array(95), new Float32Array(96)),
    /96-sample/);
  assert.equal(menu.remainingClearBlocks, 2);
});
