import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { createDisplay, screenPoint } from '../src/display.js';
import {
  DEFAULT_GRAPHICS,
  graphicsDimensions,
  normalizeGraphics,
  presentationDimensions,
  usesPresentationPass,
} from '../src/graphics.js';
import { createRenderPresentation, presentationFragmentSource } from '../src/render-presentation.js';
import { Renderer } from '../src/renderer.js';

function gpuFixture({ maxSize = 8192, viewport = [8192, 8192], complete = true } = {}) {
  const calls = [];
  const values = new Map([
    ['MAX_TEXTURE_SIZE', maxSize],
    ['MAX_VIEWPORT_DIMS', viewport],
    ['UNPACK_PREMULTIPLY_ALPHA_WEBGL', false],
    ['VERTEX_ARRAY_BINDING', 'scene-vertex-array'],
  ]);
  let id = 0;
  const methods = {
    getParameter: (name) => values.get(name),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getError: () => 'NO_ERROR',
    getUniformLocation: (_, name) => name,
    checkFramebufferStatus: () => complete ? 'FRAMEBUFFER_COMPLETE' : 'incomplete',
  };
  const gl = new Proxy(methods, {
    get(target, name) {
      if (name in target) return target[name];
      if (/^[A-Z\d_]+$/.test(name)) return name;
      return (...args) => {
        calls.push({ name, args });
        if (name.startsWith('create')) return { type: name, id: ++id };
        if (name === 'pixelStorei') values.set(args[0], args[1]);
        if (name === 'bindVertexArray') values.set('VERTEX_ARRAY_BINDING', args[0]);
      };
    },
  });
  return { gl, calls, values };
}

test('default configuration enables the lightweight presentation pass', () => {
  assert.deepEqual(normalizeConfig({ display: { aspectRatio: '4:3' } }).graphics, DEFAULT_GRAPHICS);
  assert.equal(DEFAULT_GRAPHICS.antiAliasing, 'ssaa-4x');
  assert.equal(DEFAULT_GRAPHICS.colorCorrection, 'gamma');
  assert.equal(usesPresentationPass(DEFAULT_GRAPHICS), true);
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    assert.deepEqual(graphicsDimensions(display), {
      width: 640, height: 456, internalWidth: 1280, internalHeight: 912, rasterScale: 2,
    });
  }
});

test('enhancement raster dimensions leave the original projection and pointer coordinates intact', () => {
  const display = createDisplay('16:9');
  const options = normalizeGraphics({ resolutionScale: 3, antiAliasing: 'ssaa-4x' });
  assert.deepEqual(graphicsDimensions(display, options), {
    width: 1920, height: 1368, internalWidth: 3840, internalHeight: 2736, rasterScale: 6,
  });
  assert.deepEqual(screenPoint(display, { left: 0, top: 0, width: 1920, height: 1080 }, 960, 540),
    { x: 416, y: 228 });
  assert.equal(display.framebufferWidth, 640);
  assert.deepEqual(graphicsDimensions(display, normalizeGraphics({ antiAliasing: 'post-process' })), {
    width: 640, height: 456, internalWidth: 640, internalHeight: 456, rasterScale: 1,
  }, 'legacy post-process mode retains its 1× raster size');
});

test('presentation pixels follow a high-DPI surface without inflating the scene raster', () => {
  const scene = { width: 640, height: 456 };
  assert.deepEqual(presentationDimensions(1920, 1080, 2, scene), {
    width: 3840,
    height: 2160,
  });
  assert.deepEqual(presentationDimensions(8000, 4500, 2, scene), {
    width: 3840,
    height: 2160,
  });
  assert.deepEqual(presentationDimensions(320, 228, 1, scene), scene);
});

test('high-DPI presentation decodes source gamma before the final sRGB encode', () => {
  const source = presentationFragmentSource(DEFAULT_GRAPHICS);
  const upscale = source.slice(source.indexOf('if (outputSize'));
  assert.ok(upscale.indexOf('result.rgb = pow(straightColor') >= 0);
  assert.ok(upscale.indexOf('result.rgb = pow(straightColor') <
    upscale.indexOf('vec3 linearColor = result.rgb / result.a'));
});

test('configuration rejects unsupported, malformed and misspelled enhancement options', () => {
  for (const value of [null, [], false, { resolutionScale: 0 }, { resolutionScale: 1.5 },
    { resolutionScale: 5 }, { antiAliasing: 'msaa' }, { colorCorrection: 'hdr' },
    { sourceGamma: NaN }, { sourceGamma: Infinity }, { sourceGamma: 0.9 },
    { sourceGamma: 3.1 }, { sourceGamma: '2.35' }, { antialiasing: 'none' }]) {
    assert.throws(() => normalizeGraphics(value));
  }
});

test('presentation reuses scene storage and unchanged Settings uploads across frames', () => {
  const { gl, calls, values } = gpuFixture();
  const presentation = createRenderPresentation(gl,
    normalizeGraphics({ antiAliasing: 'ssaa-4x', colorCorrection: 'ntsc-m' }));
  const background = { canvas: { width: 1280, height: 912 }, revision: 7 };
  presentation.begin(640, 456);
  presentation.present(640, 456, background);
  presentation.begin(640, 456);
  presentation.present(640, 456, background);
  let uploads = calls.filter(({ name }) => name === 'texImage2D');
  assert.equal(uploads.length, 3, 'one placeholder, one scene allocation, one Settings upload');
  assert.deepEqual(uploads[1].args.slice(3, 5), [1280, 912]);
  assert.equal(values.get('UNPACK_PREMULTIPLY_ALPHA_WEBGL'), false);
  assert.equal(values.get('VERTEX_ARRAY_BINDING'), 'scene-vertex-array');
  presentation.begin(640, 456);
  presentation.present(640, 456, { ...background, revision: 8 });
  uploads = calls.filter(({ name }) => name === 'texImage2D');
  assert.equal(uploads.length, 3, 'changed Settings pixels retain existing GPU storage');
  assert.equal(calls.filter(({ name }) => name === 'texSubImage2D').length, 1);
  presentation.begin(1280, 912);
  presentation.present(1280, 912);
  uploads = calls.filter(({ name }) => name === 'texImage2D');
  assert.deepEqual(uploads.at(-1).args.slice(3, 5), [2560, 1824]);
  assert.ok(calls.some(({ name, args }) => name === 'uniform1i' &&
    args[0] === 'hasBackground' && args[1] === false));
  assert.deepEqual(presentation.getStatus(), {
    frames: 4, sceneAllocations: 2, backgroundAllocations: 1, backgroundUploads: 2,
    maxTextureSize: 8192, maxViewport: [8192, 8192],
  });
  presentation.destroy();
  const afterDestroy = calls.length;
  presentation.destroy();
  assert.equal(calls.length, afterDestroy);
  assert.equal(calls.filter(({ name }) => name === 'deleteTexture').length, 2);
});

test('unsupported graphics sizes and incomplete framebuffer fail without silently reducing quality', () => {
  for (const limits of [{ maxSize: 1024 }, { viewport: [1024, 1024] }]) {
    const { gl, calls } = gpuFixture(limits);
    const presentation = createRenderPresentation(gl, normalizeGraphics({ antiAliasing: 'ssaa-4x' }));
    assert.throws(() => presentation.begin(640, 456), /1280×912.*Reduce graphics/);
    assert.equal(calls.filter(({ name }) => name === 'texImage2D').length, 1);
  }
  const { gl } = gpuFixture({ complete: false });
  const presentation = createRenderPresentation(gl, normalizeGraphics({ colorCorrection: 'gamma' }));
  assert.throws(() => presentation.begin(640, 456), /framebuffer is incomplete/);
});

test('unsupported internal raster fails during renderer setup and releases presentation resources', () => {
  const { gl, calls } = gpuFixture({ maxSize: 1024 });
  const canvas = { width: 640, height: 456, getContext: () => gl };
  assert.throws(() => new Renderer(canvas, { graphics: { antiAliasing: 'ssaa-4x' } }),
    /1280×912.*Reduce graphics/);
  assert.equal(calls.filter(({ name }) => name === 'deleteTexture').length, 2);
  assert.equal(calls.filter(({ name }) => name === 'deleteProgram').length, 1);
  assert.equal(calls.filter(({ name }) => name === 'createBuffer').length, 0);
});
