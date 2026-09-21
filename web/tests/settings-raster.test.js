import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createDisplay } from '../src/display.js';
import { poseLayout, indexLayout } from '../src/animation.js';
import { nativeFadeSample } from '../src/native-fader.js';
import {
  SETTINGS_FIRST_TEXTURE_FRAME,
  advanceSettingsTextureFrame,
  quantizeSettingsRaster,
  settingsCrossfadeAlpha,
  settingsRasterPoint,
} from '../src/settings-raster-math.js';

test('Settings raster uses native RGB565 truncation and bit expansion, not rounded RGB8', () => {
  const input = new Uint8ClampedArray([
    127, 127, 127, 100, 255, 255, 255, 0, 7, 3, 7, 255, 8, 4, 8, 255,
  ]);
  assert.deepEqual(
    [...quantizeSettingsRaster(input)],
    [123, 125, 123, 255, 255, 255, 255, 255, 0, 0, 0, 255, 8, 4, 8, 255],
  );
});

test('Settings is centered at its original 608-pixel width in widescreen input space', () => {
  assert.deepEqual(settingsRasterPoint(112, 0, createDisplay('16:9')), { x: 0, y: 0 });
  assert.deepEqual(settingsRasterPoint(720, 456, createDisplay('16:9')), { x: 608, y: 456 });
  assert.deepEqual(settingsRasterPoint(304, 228, createDisplay('4:3')), { x: 304, y: 228 });
});

test('Settings page fade follows the binary integer alpha steps over 20 updates', () => {
  assert.equal(settingsCrossfadeAlpha(0), 0);
  assert.equal(settingsCrossfadeAlpha(1), 12 / 255);
  assert.equal(settingsCrossfadeAlpha(10.9), 127 / 255);
  assert.equal(settingsCrossfadeAlpha(20), 1);
  assert.equal(settingsCrossfadeAlpha(100), 1);
});

test('first Settings texture and global scene fade remain in phase on a shared clock', () => {
  for (let updates = 0; updates <= 23; updates += 0.25) {
    const texture = settingsCrossfadeAlpha(SETTINGS_FIRST_TEXTURE_FRAME + updates);
    const globalReveal = 1 - nativeFadeSample(updates, 'in').opacity;
    assert.ok(Math.abs(texture - globalReveal) < 1e-12, `update ${updates}`);
  }
  // Fresh Dolphin entry frame 34875 is the midpoint of two overlapping fades.
  const midpoint = settingsCrossfadeAlpha(SETTINGS_FIRST_TEXTURE_FRAME + 11);
  assert.ok(Math.abs(midpoint * midpoint - 0.2473) < 0.001);
});

test('inert input during global fade does not pause the shared Settings texture clock', () => {
  let frame = SETTINGS_FIRST_TEXTURE_FRAME;
  for (let update = 1; update <= 21; update++) {
    frame = advanceSettingsTextureFrame(frame, 1, { externalClock: true, inert: true });
    assert.ok(
      Math.abs(settingsCrossfadeAlpha(frame) - (1 - nativeFadeSample(update, 'in').opacity)) <
        1e-12,
    );
  }
  assert.equal(settingsCrossfadeAlpha(frame), 1);
  assert.equal(
    advanceSettingsTextureFrame(frame, 10, { externalClock: true, hidden: true }),
    frame,
  );
  assert.equal(advanceSettingsTextureFrame(frame, 10, { inert: true }), frame);
});

const scrollResource = new URL(
  '../public/assets/layouts/setting/SceenChange_b.json',
  import.meta.url,
);
test(
  'original Settings page-scroll planes use authored 477-pixel displacement and alpha',
  {
    skip:
      !existsSync(scrollResource) &&
      'Prepare a local menu WAD to test its original animation resource.',
  },
  () => {
    const source = JSON.parse(readFileSync(scrollResource));
    for (const [name, direction, active, inactive] of [
      ['Right', -1, 'Tex1', 'Tex2'],
      ['Left', 1, 'Tex2', 'Tex1'],
    ]) {
      const pose = poseLayout(source, [
        { animation: source.animations[`SceenChange_b_${name}`], frame: 25, loop: false },
      ]);
      const { panes } = indexLayout(pose);
      assert.equal(panes.get('N_Tra0').translation[0], direction * 477);
      assert.equal(panes.get(active).alpha, 255);
      assert.equal(panes.get(inactive).alpha, 0);
      assert.deepEqual(panes.get('Tex0').size, [1824, 456]);
      assert.deepEqual(panes.get('Tex0').texCoords[0], [
        [-1, 0],
        [2, 0],
        [-1, 1],
        [2, 1],
      ]);
    }
  },
);
