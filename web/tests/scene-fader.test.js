import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneFader } from '../src/scene-fader.js';

test('scene ownership changes only at black, and entrance waits for fade-in completion', () => {
  const fader = createSceneFader();
  let scene = 'grid';
  assert.equal(
    fader.start(() => {
      scene = 'options';
    }),
    true,
  );
  assert.equal(
    fader.start(() => {
      scene = 'wrong';
    }),
    false,
  );
  fader.advance(22);
  assert.equal(fader.revealing, false);
  assert.equal(scene, 'grid');
  assert.equal(fader.sample().alpha, 255);
  fader.advance(1);
  assert.equal(fader.revealing, true);
  assert.equal(scene, 'options');
  assert.equal(fader.sample().alpha, 255);
  fader.advance(21);
  assert.equal(fader.sample().alpha, 0);
  assert.equal(fader.active, true);
  fader.advance(1);
  assert.equal(fader.active, false);
  assert.equal(fader.revealing, false);
});

test('resource-ready handoff retains black while a Settings raster is loading', async () => {
  const fader = createSceneFader();
  let ready;
  fader.start(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  fader.advance(23);
  fader.advance(600);
  assert.equal(fader.sample().alpha, 255);
  assert.equal(fader.active, true);
  assert.equal(fader.revealing, false);
  ready();
  await Promise.resolve();
  assert.equal(fader.revealing, true);
  fader.advance(2);
  assert.equal(fader.sample().alpha, 243);
  fader.advance(20);
  assert.equal(fader.active, false);
});
