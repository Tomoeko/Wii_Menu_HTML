import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/renderer.js';
import { createDisplay } from '../src/display.js';

function captureRenderer() {
  const state = {
    FRAMEBUFFER_BINDING: 'screen',
    VIEWPORT: [0, 0, 1600, 900],
    SCISSOR_BOX: [8, 9, 100, 200],
    COLOR_WRITEMASK: [true, true, true, true],
    COLOR_CLEAR_VALUE: [0.9, 0.9, 0.9, 1],
    scissor: true,
  };
  const calls = {
    textures: 0,
    framebuffers: 0,
    allocations: 0,
    deletedTextures: 0,
    deletedFramebuffers: 0,
  };
  const functions = {
    getParameter: (name) => state[name],
    isEnabled: () => state.scissor,
    createTexture: () => ({ texture: ++calls.textures }),
    createFramebuffer: () => ({ framebuffer: ++calls.framebuffers }),
    deleteTexture: () => calls.deletedTextures++,
    deleteFramebuffer: () => calls.deletedFramebuffers++,
    texImage2D: () => calls.allocations++,
    bindTexture() {},
    texParameteri() {},
    framebufferTexture2D() {},
    checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',
    bindFramebuffer: (_target, value) => {
      state.FRAMEBUFFER_BINDING = value;
    },
    viewport: (...value) => {
      state.VIEWPORT = value;
    },
    scissor: (...value) => {
      state.SCISSOR_BOX = value;
    },
    colorMask: (...value) => {
      state.COLOR_WRITEMASK = value;
    },
    clearColor: (...value) => {
      state.COLOR_CLEAR_VALUE = value;
    },
    enable: () => {
      state.scissor = true;
    },
    disable: () => {
      state.scissor = false;
    },
    clear() {},
  };
  const gl = new Proxy(functions, {
    get: (target, name) => (name in target ? target[name] : name),
  });
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, {
    gl,
    canvas: { width: 1600, height: 900 },
    display: createDisplay(),
    bounds: new Map([['screen-pane', {}]]),
    textures: new Map(),
  });
  return { renderer, state, calls };
}

test('capture restores output state and hit targets, and reuses its GPU storage', () => {
  const { renderer, state, calls } = captureRenderer(),
    before = structuredClone(state),
    bounds = renderer.bounds;
  const handle = renderer.capture(() => {
    assert.notEqual(state.FRAMEBUFFER_BINDING, 'screen');
    assert.deepEqual(state.COLOR_WRITEMASK, [true, true, true, false]);
    assert.equal(state.scissor, false);
    renderer.bounds.set('preview-pane', {});
  });
  assert.deepEqual(state, before);
  assert.equal(renderer.bounds, bounds);
  assert.equal(renderer.bounds.has('preview-pane'), false);
  assert.equal(handle.logicalWidth, 832);
  assert.equal(handle.logicalHeight, 456);
  assert.equal(
    renderer.capture(() => {}, { reuse: handle }),
    handle,
  );
  assert.equal(calls.textures, 1);
  assert.equal(calls.framebuffers, 1);
  assert.equal(calls.allocations, 1);
  renderer.canvas.width = 1920;
  renderer.canvas.height = 1080;
  renderer.capture(() => {}, { reuse: handle });
  assert.equal(calls.allocations, 2);
  renderer.releaseCapture(handle);
  renderer.releaseCapture(handle);
  assert.equal(calls.deletedTextures, 1);
  assert.equal(calls.deletedFramebuffers, 1);
  assert.equal(renderer.textures.size, 0);
  assert.throws(() => renderer.capture(() => {}, { reuse: handle }), /Invalid capture/);
});

test('captured composite draws one logical quad with framebuffer orientation and one alpha', () => {
  const { renderer } = captureRenderer(),
    handle = renderer.capture(() => {}),
    draws = [];
  renderer.quad = (...args) => draws.push(args);
  const matrix = [0.5, 0, 0, 0.5, 100, 20];
  renderer.drawCapture(handle, { matrix, alpha: 128 / 255 });
  assert.equal(draws.length, 1);
  const [layout, pane, transform, alpha] = draws[0];
  assert.equal(layout, handle.layout);
  assert.equal(transform, matrix);
  assert.equal(alpha, 128 / 255);
  assert.deepEqual(pane.size, [832, 456]);
  assert.deepEqual(pane.texCoords, [
    [
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 0],
    ],
  ]);
});

test('a failed draw restores framebuffer and bounds and releases its new resources', () => {
  const { renderer, state, calls } = captureRenderer(),
    before = structuredClone(state),
    bounds = renderer.bounds;
  assert.throws(
    () =>
      renderer.capture(() => {
        throw new Error('Preview failed');
      }),
    /Preview failed/,
  );
  assert.deepEqual(state, before);
  assert.equal(renderer.bounds, bounds);
  assert.equal(calls.deletedTextures, 1);
  assert.equal(calls.deletedFramebuffers, 1);
});
