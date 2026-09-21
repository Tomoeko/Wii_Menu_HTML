import test from 'node:test';
import assert from 'node:assert/strict';
import { dragAudioParameters } from '../src/drag-audio.js';

test('native drag sound is silent when grabbed or held still', () => {
  const point = { x: 152, y: 30 };
  assert.deepEqual(dragAudioParameters(point, null), { gain: 0, pan: 0.5 });
  assert.deepEqual(dragAudioParameters(point, point), { gain: 0, pan: 0.5 });
});

test('drag volume follows distance per native update and normalizes browser refresh rate', () => {
  const before = { x: 0, y: 0 };
  const after = { x: 3, y: 4 };
  assert.equal(dragAudioParameters(after, before).gain, 10 / 304);
  assert.equal(dragAudioParameters({ x: 6, y: 8 }, before, 2).gain, 10 / 304);
  assert.deepEqual(dragAudioParameters({ x: 608, y: 0 }, before), {
    gain: 1,
    pan: 1,
    pitch: 608 / 30,
  });
});
