import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { decodeGif } from '../../tools/gif-image.mjs';
import { readCustomPackage } from '../../tools/custom-channels.mjs';
import { indexLayout } from '../src/animation.js';
import { poseChannel } from '../src/channel-animation.js';
import { createDisplay, prepareAspectLayout } from '../src/display.js';
import { Renderer } from '../src/renderer.js';

const project = new URL('../../', import.meta.url).pathname;
const example = join(project, 'examples/custom-channels/custom-artwork-qa-da0a7872');

function subjectBounds(frame, width, height, background) {
  const points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (!background.every((value, channel) => frame.rgba[offset + channel] === value))
        points.push([x, y]);
    }
  }
  return {
    x: Math.min(...points.map(([x]) => x)),
    y: Math.min(...points.map(([, y]) => y)),
    width: Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)) + 1,
    height: Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y)) + 1,
  };
}

test('artwork QA banner preserves its source frames and preview placement', async () => {
  const decoded = decodeGif(await readFile(join(example, 'banner.gif')));
  assert.deepEqual([decoded.width, decoded.height], [200, 100]);
  assert.deepEqual(
    decoded.frames.map((frame) => frame.durationMs),
    [200, 300, 400],
  );
  assert.deepEqual(
    decoded.frames.map((frame) =>
      subjectBounds(frame, decoded.width, decoded.height, [255, 244, 214, 255]),
    ),
    [
      { x: 15, y: 25, width: 56, height: 56 },
      { x: 70, y: 25, width: 56, height: 56 },
      { x: 125, y: 25, width: 56, height: 56 },
    ],
  );

  const prepared = await readCustomPackage(example);
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    const source = prepareAspectLayout(prepared.layouts.banner, display);
    const posed = poseChannel({ banner: source }, 'banner', 0);
    const renderer = Object.create(Renderer.prototype);
    renderer.bounds = new Map();
    renderer.quad = () => {};
    renderer.display = display;
    renderer.draw(posed);
    const rectangle = renderer.rect('Artwork');
    assert.ok(rectangle);
    assert.ok(rectangle.x >= -1e-10);
    assert.ok(rectangle.x + rectangle.w <= display.width + 1e-10);
    assert.ok(rectangle.y >= -1e-10);
    assert.ok(rectangle.y + rectangle.h <= display.bannerContentHeight + 1e-10);
    assert.ok(
      Math.abs(rectangle.y + rectangle.h / 2 - display.bannerContentHeight / 2) < 1e-10,
    );
    if (aspect === '4:3') {
      assert.deepEqual(rectangle, { x: 0, y: 17.5, w: 608, h: 304 });
    } else {
      assert.ok(Math.abs(rectangle.x - 68.07894736842104) < 1e-10);
      assert.ok(Math.abs(rectangle.w - 695.8421052631579) < 1e-10);
      assert.deepEqual(rectangle, { x: rectangle.x, y: 0, w: rectangle.w, h: 339 });
    }
    assert.deepEqual(indexLayout(source).panes.get('Artwork').translation, [0, 58.5, 0]);
  }
});
