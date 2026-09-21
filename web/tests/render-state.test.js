import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/renderer.js';
import { identity } from '../src/animation.js';

function stateRenderer() {
  const state = {
    MAX_VIEWPORT_DIMS: [8192, 8192],
    FRAMEBUFFER_BINDING: null,
    VIEWPORT: [0, 0, 640, 456],
    SCISSOR_BOX: [0, 0, 640, 456],
    COLOR_WRITEMASK: [true, true, true, true],
    COLOR_CLEAR_VALUE: [0, 0, 0, 0],
    enabled: new Set(),
    buffer: null,
    blend: [],
  };
  const calls = { bufferBinds: 0, blendToggles: 0, blendFunctions: 0 };
  const draws = [];
  const uploads = [];
  const functions = {
    getParameter: (name) => state[name],
    isEnabled: (name) => state.enabled.has(name),
    bindBuffer: (_target, buffer) => {
      state.buffer = buffer;
      calls.bufferBinds++;
    },
    bufferSubData: () => uploads.push(state.buffer),
    enable: (name) => {
      state.enabled.add(name);
      if (name === 'BLEND') calls.blendToggles++;
    },
    disable: (name) => {
      state.enabled.delete(name);
      if (name === 'BLEND') calls.blendToggles++;
    },
    blendFuncSeparate: (...factors) => {
      state.blend = factors;
      calls.blendFunctions++;
    },
    drawArrays: () => draws.push({
      buffer: state.buffer,
      enabled: state.enabled.has('BLEND'),
      factors: [...state.blend],
    }),
    bindFramebuffer: (_target, value) => { state.FRAMEBUFFER_BINDING = value; },
    viewport: (...value) => { state.VIEWPORT = value; },
    scissor: (...value) => { state.SCISSOR_BOX = value; },
    colorMask: (...value) => { state.COLOR_WRITEMASK = value; },
    clearColor: (...value) => { state.COLOR_CLEAR_VALUE = value; },
    checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',
  };
  const gl = new Proxy(functions, {
    get(target, name) {
      if (name in target) return target[name];
      if (/^[A-Z\d_]+$/.test(name)) return name;
      if (name.startsWith('create')) return () => ({});
      return () => {};
    },
  });
  const renderer = new Renderer({ width: 640, height: 456, getContext: () => gl }, {
    graphics: { antiAliasing: 'none', colorCorrection: 'none' },
  });
  const program = { p: {}, attributes: {}, uniforms: {} };
  renderer.program = () => program;
  return { renderer, gl, calls, draws, uploads };
}

function scene(blendMode) {
  return {
    root: { origin: 4, size: [20, 10], material: 0 },
    textures: [],
    materials: [{ colors: Array(3).fill([255, 255, 255, 255]), blendMode }],
  };
}

test('draws observe disabled blending and in-place changes to every supported RGB factor', () => {
  const { renderer, draws } = stateRenderer();
  const source = scene();
  const draw = () => {
    renderer.quad(source, source.root, identity, 0.5);
    return draws.at(-1);
  };
  assert.deepEqual(draw().factors,
    ['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA']);
  source.materials[0].blendMode = [0, 1, 0];
  assert.equal(draw().enabled, false);
  assert.equal(draw().enabled, false);
  const factors = ['ZERO', 'ONE', 'DST_COLOR', 'ONE_MINUS_DST_COLOR', 'SRC_ALPHA',
    'ONE_MINUS_SRC_ALPHA', 'DST_ALPHA', 'ONE_MINUS_DST_ALPHA'];
  source.materials[0].blendMode[0] = 1;
  for (let index = 0; index < factors.length; index++) {
    source.materials[0].blendMode[1] = index;
    source.materials[0].blendMode[2] = 7 - index;
    const result = draw();
    assert.equal(result.enabled, true);
    assert.deepEqual(result.factors,
      [factors[index], factors[7 - index], 'ONE', 'ONE_MINUS_SRC_ALPHA']);
  }
  delete source.materials[0].blendMode;
  assert.deepEqual(draw().factors,
    ['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA']);
});

test('capture, presentation, clear and external handoffs cannot leak buffer or blend state', () => {
  const { renderer, gl, draws, uploads } = stateRenderer();
  const source = scene([1, 2, 3]);
  const captured = scene([0, 0, 1]);
  const draw = () => renderer.quad(source, source.root, identity, 1);
  const verify = () => {
    draw();
    assert.deepEqual(draws.at(-1), {
      buffer: renderer.buffer,
      enabled: true,
      factors: ['DST_COLOR', 'ONE_MINUS_DST_COLOR', 'ONE', 'ONE_MINUS_SRC_ALPHA'],
    });
    assert.equal(uploads.at(-1), renderer.buffer);
  };
  const disturb = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, { external: true });
    gl.disable(gl.BLEND);
    gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE);
  };
  verify();
  const handle = renderer.capture(() => renderer.quad(captured, captured.root, identity, 1));
  verify();
  renderer.releaseCapture(handle);
  assert.throws(() => renderer.capture(() => {
    disturb();
    throw new Error('Interrupted capture');
  }), /Interrupted capture/);
  verify();
  disturb();
  renderer.clear();
  verify();
  renderer.presentation = { present: disturb };
  renderer.present();
  renderer.presentation = null;
  verify();
  disturb();
  renderer.invalidateGpuState();
  verify();
});

test('472 unchanged quads keep every upload and draw while submitting buffer and blend state once', () => {
  const { renderer, calls, draws, uploads } = stateRenderer();
  const source = scene();
  renderer.invalidateGpuState();
  const before = { ...calls };
  for (let index = 0; index < 472; index++) {
    renderer.quad(source, source.root, identity, 1);
  }
  assert.equal(draws.length, 472);
  assert.equal(uploads.length, 472);
  assert.ok(uploads.every((buffer) => buffer === renderer.buffer));
  assert.equal(calls.bufferBinds - before.bufferBinds, 1);
  assert.equal(calls.blendToggles - before.blendToggles, 1);
  assert.equal(calls.blendFunctions - before.blendFunctions, 1);
});
