import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisplay, prepareAspectLayout, screenPoint } from '../src/display.js';
import { Renderer } from '../src/renderer.js';

const pane = (name, options = {}) => ({
  name,
  type: 'pan1',
  flags: 1,
  origin: 4,
  alpha: 255,
  size: [20, 10],
  translation: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1],
  children: [],
  ...options,
});
function recorder(display) {
  const renderer = Object.create(Renderer.prototype);
  renderer.bounds = new Map();
  renderer.display = display;
  renderer.graphics = {
    resolutionScale: 1,
    antiAliasing: 'none',
    colorCorrection: 'none',
    sourceGamma: 2.35,
  };
  return renderer;
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('source projection and output aspect are independent for widescreen', () => {
  const wide = createDisplay(),
    narrow = createDisplay('4:3');
  assert.deepEqual(wide.projection, { left: -416, right: 416, top: -228, bottom: 228 });
  assert.deepEqual(narrow.projection, { left: -304, right: 304, top: -228, bottom: 228 });
  assert.equal(wide.outputAspect, 16 / 9);
  assert.equal(wide.thumbnailHalfWidth, 85);
  assert.equal(narrow.thumbnailHalfWidth, 64);
  assert.throws(() => createDisplay('stretch'), RangeError);
  assert.deepEqual(screenPoint(wide, { left: 10, top: 20, width: 1600, height: 900 }, 810, 470), {
    x: 416,
    y: 228,
  });
});

test('NW4R location adjustment widens translations while preserving flagged pane widths', () => {
  const source = {
    root: pane('Root', {
      children: [
        pane('adjusted', {
          flags: 5,
          translation: [100, 30, 0],
          children: [pane('child', { translation: [20, 0, 0] })],
        }),
        pane('stretched', { translation: [-100, 30, 0] }),
      ],
    }),
  };
  const wide = createDisplay(),
    renderer = recorder(wide);
  renderer.draw(source);
  const adjusted = renderer.rect('adjusted'),
    stretched = renderer.rect('stretched');
  near(adjusted.x + adjusted.w / 2, 416 + 100 * wide.rootScaleX);
  near(adjusted.w, 20);
  near(stretched.w, 20 * wide.rootScaleX);
  near(renderer.rect('child').x + 10, 416 + 100 * wide.rootScaleX + 20);
  assert.deepEqual(source.root.scale, [1, 1]);
  assert.deepEqual(source.root.children[0].scale, [1, 1]);
  renderer.setDisplay(createDisplay('4:3'));
  renderer.draw(source);
  assert.deepEqual(renderer.rect('adjusted'), { x: 394, y: 193, w: 20, h: 10 });
});

test('embedded channel layouts reuse a grid anchor scale exactly once', () => {
  const wide = createDisplay(),
    renderer = recorder(wide),
    scale = wide.rootScaleX;
  const icon = { root: pane('icon', { children: [pane('art', { flags: 5 })] }) };
  renderer.draw(icon, { matrix: [scale, 0, 0, 1, 200, 0], layoutMode: 'embedded' });
  near(renderer.rect('art').w, 20);
  near(renderer.rect('art').x + 10, 616);
  renderer.draw(icon, { matrix: [1, 0, 0, 1, 200, 0] });
  near(renderer.rect('art').w, 20);
  near(renderer.rect('art').x + 10, 616);
});

test('widescreen source texture donors replace only requested material slots', () => {
  const source = {
    name: 'my_TVShade_a',
    root: pane('Root', {
      children: [
        pane('16x9', { material: 0 }),
        pane('4x3', { material: 1 }),
        pane('4x3_dummy', { material: 2 }),
      ],
    }),
    materials: [
      { name: 'wide', textureMaps: [{ texture: 2, wrapS: 1, wrapT: 2 }] },
      { name: 'front', textureMaps: [{ texture: 0, wrapS: 0, wrapT: 0 }, { texture: 3 }] },
      { name: 'back', textureMaps: [{ texture: 1, wrapS: 0, wrapT: 0 }] },
    ],
  };
  const output = prepareAspectLayout(source, createDisplay());
  assert.deepEqual(output.materials[1].textureMaps, [
    { texture: 2, wrapS: 1, wrapT: 2 },
    { texture: 3 },
  ]);
  assert.equal(output.materials[2].textureMaps[0].texture, 2);
  assert.equal(source.materials[1].textureMaps[0].texture, 0);
  assert.equal(prepareAspectLayout(source, createDisplay('4:3')), source);
});

test('scissor uses current projection with independently scaled output axes', () => {
  const renderer = recorder(createDisplay()),
    calls = [];
  renderer.canvas = { width: 1600, height: 900 };
  renderer.gl = { SCISSOR_TEST: 1, enable() {}, scissor: (...args) => calls.push(args) };
  renderer.clip({ x: 208, y: 114, w: 416, h: 228 });
  assert.deepEqual(calls[0], [400, 225, 800, 450]);
});

test('native framebuffer sampling is independent of projection and pointer display size', () => {
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    assert.equal(display.framebufferWidth, 640);
    assert.equal(display.framebufferHeight, 456);
    const renderer = recorder(display);
    const calls = [];
    renderer.canvas = {
      width: display.framebufferWidth,
      height: display.framebufferHeight,
    };
    renderer.gl = { SCISSOR_TEST: 1, enable() {}, scissor: (...args) => calls.push(args) };
    renderer.clip({ x: display.width / 4, y: 114, w: display.width / 2, h: 228 });
    assert.deepEqual(calls, [[160, 114, 320, 228]]);
    assert.deepEqual(
      screenPoint(display, { left: 10, top: 20, width: 1200, height: 900 }, 610, 470),
      { x: display.width / 2, y: 228 },
      'hit testing remains in logical coordinates after the raster is stretched for display',
    );
  }
});


test('P1 authored hand and shadow stay anchored at CSS hit coordinates including the screen edges', () => {
  // Original P1_Def: N_Trans has location-adjust flag 0x04. The hand is
  // centered at (8, -20), size54, with a separate (3, -3) shadow parent.
  const cursor = { root: pane('Root', { children: [pane('N_Trans', {
    flags: 5,
    children: [
      pane('N_Rot', { children: [pane('hand', { translation: [8, -20, 0], size: [54, 54] })] }),
      pane('N_SRot', { translation: [3, -3, 0], children: [
        pane('shadow', { translation: [8, -20, 0], size: [54, 54] }),
      ] }),
    ],
  })] }) };
  const bounds = { left: 17.25, top: 31.5, width: 1234.5, height: 777.25 };
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    for (const [u, v] of [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]]) {
      const point = screenPoint(display, bounds, bounds.left + u * bounds.width, bounds.top + v * bounds.height);
      const renderer = recorder(display);
      renderer.draw(cursor, { matrix: [1, 0, 0, 1, point.x - display.halfWidth, display.halfHeight - point.y] });
      const hand = renderer.rect('hand');
      const shadow = renderer.rect('shadow');
      near(hand.x + 19, point.x);
      near(hand.y + 7, point.y);
      near(hand.w, 54);
      near(hand.h, 54);
      near(shadow.x - hand.x, 3);
      near(shadow.y - hand.y, 3);
    }
  }
});
