import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/renderer.js';

function pane(name, options = {}) {
  return {
    name,
    type: 'pic1',
    material: 0,
    flags: 1,
    alpha: 255,
    origin: 4,
    size: [20, 10],
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1],
    children: [],
    ...options,
  };
}

test('a separate native opacity context preserves transforms and external scene opacity', () => {
  const source = {
    root: pane('parent', {
      flags: 3,
      alpha: 128,
      translation: [30, 20, 0],
      scale: [0.5, 0.5],
      children: [
        pane('sheet', {
          flags: 3,
          alpha: 64,
          translation: [10, -5, 0],
          children: [pane('intermediate', { alpha: 32, children: [pane('text')] })],
        }),
        pane('ordinary', { alpha: 64 }),
      ],
    }),
  };
  const renderer = Object.create(Renderer.prototype);
  renderer.bounds = new Map();
  const opacity = new Map();
  renderer.quad = (_layout, item, _matrix, alpha) => opacity.set(item.name, alpha);
  renderer.draw(source, { alpha: 0.5 });
  const ordinarySheet = renderer.rect('sheet');
  assert.equal(opacity.get('sheet'), 0.5 * (128 / 255) * (64 / 255));
  renderer.draw(source, { alpha: 0.5, alphaContextRoots: new Set(['sheet']) });
  assert.deepEqual(renderer.rect('sheet'), ordinarySheet);
  assert.equal(opacity.get('sheet'), 0.5 * (64 / 255));
  assert.equal(opacity.get('intermediate'), 0.5 * (64 / 255) * (32 / 255));
  assert.equal(opacity.get('text'), 0.5 * (64 / 255));
  assert.equal(opacity.get('ordinary'), 0.5 * (128 / 255) * (64 / 255));
});
