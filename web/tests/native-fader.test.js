import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeFadeSample, menuEntranceSample } from '../src/native-fader.js';

test('native fade uses integer opacity and preserves the terminal status delay', () => {
  assert.equal(nativeFadeSample(0).alpha, 255);
  assert.equal(nativeFadeSample(1).alpha, 255);
  assert.equal(nativeFadeSample(2).alpha, 243);
  assert.equal(nativeFadeSample(11).alpha, 128);
  assert.deepEqual(nativeFadeSample(21), { alpha: 0, opacity: 0, complete: false });
  assert.equal(nativeFadeSample(22).complete, true);
  assert.equal(nativeFadeSample(21, 'out').alpha, 255);
  assert.equal(nativeFadeSample(22, 'out').complete, false);
  assert.equal(nativeFadeSample(23, 'out').complete, true);
});
test('health handoff holds the black output before revealing a static grid', () => {
  assert.equal(menuEntranceSample(22).phase, 'black');
  assert.equal(menuEntranceSample(23).alpha, 255);
  assert.equal(menuEntranceSample(44).alpha, 0);
  assert.equal(menuEntranceSample(45).complete, true);
  assert.equal(menuEntranceSample(22, { healthShown: false }).complete, true);
  for (let frame = 0; frame < 46; frame++) assert.equal(menuEntranceSample(frame).gridFrame, 0);
});
