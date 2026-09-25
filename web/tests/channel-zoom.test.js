import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelZoom,
  channelZoomCenters,
  drawChannelZoom,
  sourceAnchorMatrices,
} from '../src/channel-zoom.js';
import { readFileSync, existsSync } from 'node:fs';
import { poseLayout } from '../src/animation.js';
import { Renderer } from '../src/renderer.js';
import { createDisplay, prepareAspectLayout } from '../src/display.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
test('native zoom draws both black fades around the captured preview', { skip: !manifest }, () => {
  const source = JSON.parse(readFileSync(new URL(manifest.layouts.my_IplTop_a.url, manifestUrl)));
  const display = createDisplay('16:9');
  const zoom = channelZoom({
    frame: 14,
    center: [-264, 145],
    wide: true,
    projection: display.projection,
  });
  const grid = poseLayout(prepareAspectLayout(source, display), [
    {
      animation: source.animations.my_IplTop_a,
      frame: zoom.layoutFrame,
      loop: false,
    },
  ]);
  const layers = [];
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, { display, bounds: new Map() });
  renderer.quad = (layout, pane, matrix, alpha) => {
    layers.push({
      name: pane.name,
      alpha: (layout.materials[pane.material].colors[1][3] / 255) * alpha,
    });
  };
  renderer.drawCapture = (_capture, { alpha }) => layers.push({ name: 'preview', alpha });
  drawChannelZoom(renderer, grid, zoom, {}, (_rect, alpha) =>
    layers.push({ name: 'outside', alpha }),
  );
  assert.deepEqual(
    layers.slice(0, 2).map((layer) => layer.name),
    ['ChMask', 'preview'],
  );
  assert.ok(layers.slice(2).every((layer) => layer.name === 'outside'));
  close(layers[0].alpha, 0.5);
  close(layers[2].alpha, 127 / 255);
  // Fresh native Disc frame 12627: corner mean 57.53, baseline 231.48.
  // This bounded comparison permits native quantization and changing backdrop;
  // omitting either source layer instead predicts approximately 116.
  const corner = 231.48 * (1 - layers[0].alpha) * (1 - layers[2].alpha);
  assert.ok(Math.abs(corner - 57.53) < 1, `Native midpoint corner differs: ${corner}`);
});
test('native zoom starts at the thumbnail and ends at the complete preview', () => {
  const start = channelZoom({ frame: 0, center: [-192, 145] });
  start.cameraMatrix.forEach((value, i) => close(value, [1, 0, 0, 1, 0, 0][i]));
  assert.deepEqual(start.screenRect, { x: 48, y: 35, w: 128, h: 96 });
  assert.equal(start.alpha, 0);
  const end = channelZoom({ frame: 28, center: [-192, 145] });
  end.previewMatrix.forEach((value, i) => close(value, [1, 0, 0, 1, 0, 0][i]));
  assert.deepEqual(end.outsideRects, []);
  assert.equal(end.alpha, 1);
  assert.equal(end.bannerStarts, true);
});

test('cached zoom centers retain all twelve source anchors in both aspect modes',
  { skip: !manifest }, () => {
    const source = JSON.parse(readFileSync(new URL(manifest.layouts.my_IplTop_a.url, manifestUrl)));
    for (const [aspect, columns] of [
      ['4:3', [-192, -64, 64, 192]],
      ['16:9', [
        -262.7368421052632,
        -87.57894736842105,
        87.57894736842105,
        262.7368421052632,
      ]],
    ]) {
      const display = createDisplay(aspect);
      const centers = channelZoomCenters(prepareAspectLayout(source, display), display);
      assert.equal(centers.length, 12);
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 4; column++) {
          const center = centers[row * 4 + column];
          close(center[0], columns[column]);
          close(center[1], 145 - row * 96);
        }
      }
    }
  });
test('return is the exact reverse camera and capture fade, including widescreen', () => {
  const options = {
    center: [-240, 145],
    wide: true,
    projection: { left: -416, right: 416, top: -228, bottom: 228 },
  };
  for (let frame = 0; frame <= 28; frame++) {
    const a = channelZoom({ ...options, frame }),
      b = channelZoom({ ...options, frame: 28 - frame, direction: 'out' });
    assert.deepEqual(a.cameraMatrix, b.cameraMatrix);
    assert.deepEqual(a.previewMatrix, b.previewMatrix);
    assert.equal(a.alpha, b.alpha);
    const covered =
      a.outsideRects.reduce((sum, rect) => sum + rect.w * rect.h, 0) +
      a.screenRect.w * a.screenRect.h;
    close(covered, 832 * 456);
  }
  assert.equal(channelZoom({ ...options, frame: 14 }).alpha, 127 / 255);
});
test('clock anchors retain hidden panes and copy translation without inherited scale', () => {
  const pane = (name, translation, scale = [1, 1], flags = 1, children = []) => ({
    name,
    translation: [...translation, 0],
    scale,
    rotation: [0, 0, 0],
    flags,
    children,
  });
  const layout = {
    root: pane('root', [10, 20], [2, 3], 1, [
      pane('N_Clock0', [-5, 4]),
      pane('hidden', [100, 0], [1, 1], 0, [pane('N_Clock2', [7, -4], [4, 5], 0)]),
    ]),
  };
  assert.deepEqual(sourceAnchorMatrices(layout), [
    { name: 'N_Clock0', matrix: [1, 0, 0, 1, 0, 32] },
    { name: 'N_Clock2', matrix: [1, 0, 0, 1, 224, 8] },
  ]);
});
