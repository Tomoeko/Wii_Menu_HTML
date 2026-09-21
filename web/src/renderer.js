import { identity, multiply, paneMatrix, paneCorners, paneVertices } from './animation.js';
import { standardDisplay, paneForDisplay } from './display.js';
import { graphicsDimensions, normalizeGraphics } from './graphics.js';
import { createRenderPresentation } from './render-presentation.js';

const WHITE = [255, 255, 255, 255];
const QUAD_INDICES = [0, 1, 3, 0, 3, 2];
const ATTRIBUTE_LAYOUT = [['position', 3], ['color', 4], ['uv0', 2], ['uv1', 2],
  ['uv2', 2], ['uv3', 2]];
const defaultUV = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
const vertexSource = `#version 300 es
in vec3 position;
uniform vec2 projectionHalfSize;
in vec4 color;
in vec2 uv0;
in vec2 uv1;
in vec2 uv2;
in vec2 uv3;
out vec4 raster;
out vec2 texUV0;
out vec2 texUV1;
out vec2 texUV2;
out vec2 texUV3;

void main() {
  gl_Position = vec4(position.xy / projectionHalfSize, -position.z / 100.0, 1.0);
  raster = color;
  texUV0 = uv0;
  texUV1 = uv1;
  texUV2 = uv2;
  texUV3 = uv3;
}`;

function konst(sel, alpha) {
  if (sel < 8) return alpha ? ((8 - sel) / 8).toFixed(3) : `vec3(${(8 - sel) / 8})`;
  if (!alpha && sel >= 12 && sel < 16) return `kc[${sel - 12}].rgb`;
  if (sel >= 16)
    return alpha
      ? `kc[${(sel - 16) % 4}][${Math.floor((sel - 16) / 4)}]`
      : `vec3(kc[${(sel - 16) % 4}][${Math.floor((sel - 16) / 4)}])`;
  return alpha ? '1.0' : 'vec3(1.)';
}
function colorInput(n) {
  return [
    'p.rgb',
    'vec3(p.a)',
    'r0.rgb',
    'vec3(r0.a)',
    'r1.rgb',
    'vec3(r1.a)',
    'r2.rgb',
    'vec3(r2.a)',
    'tex.rgb',
    'vec3(tex.a)',
    'ras.rgb',
    'vec3(ras.a)',
    'vec3(1.)',
    'vec3(.5)',
    'kcolor',
    'vec3(0.)',
  ][n];
}
function alphaInput(n) {
  return ['p.a', 'r0.a', 'r1.a', 'r2.a', 'tex.a', 'ras.a', 'kalpha', '0.0'][n];
}
function operation(bytes, alpha) {
  const input = alpha ? alphaInput : colorInput;
  const [ab, cd, op, cl] = bytes,
    a = input(ab & 15),
    b = input(ab >> 4),
    c = input(cd & 15),
    d = input(cd >> 4);
  const bias = [0, 0.5, -0.5, 0][(op >> 4) & 3],
    scale = [1, 2, 4, 0.5][op >> 6];
  const kind = op & 15;
  let code;
  if (kind >= 8) {
    const comparison = kind & 1 ? '==' : '>';
    if (alpha) {
      code = `${d} + ((tevAlpha8(${a}) ${comparison} tevAlpha8(${b})) ? ${c} : 0.0)`;
    } else if (kind >= 14) {
      const fn = kind & 1 ? 'equal' : 'greaterThan';
      code = `${d} + mix(vec3(0.), ${c}, ${fn}(tevColor8(${a}), tevColor8(${b})))`;
    } else {
      const packed = (value) =>
        kind < 10
          ? `tevColor8(${value}).r`
          : kind < 12
            ? `dot(tevColor8(${value}).rg, vec2(1.,256.))`
            : `dot(tevColor8(${value}), vec3(1.,256.,65536.))`;
      code = `${d} + ((${packed(a)} ${comparison} ${packed(b)}) ? ${c} : vec3(0.))`;
    }
  } else {
    code = `((${d} ${kind === 1 ? '-' : '+'} mix(${a},${b},${c})) + ${alpha ? bias.toFixed(1) : `vec3(${bias})`}) * ${scale.toFixed(1)}`;
  }
  if (cl & 1) code = `clamp(${code},${alpha ? '0.0' : 'vec3(0.)'},${alpha ? '1.0' : 'vec3(1.)'})`;
  return { code, dest: ['p', 'r0', 'r1', 'r2'][(cl >> 1) & 3] };
}
function alphaTestSource(compare) {
  if (!compare) return '';
  const [comparisons, operation, reference0, reference1] = compare;
  if (comparisons === 0x77 && operation < 2) return '';
  const condition = (kind, reference) =>
    kind === 0
      ? 'false'
      : kind === 7
        ? 'true'
        : `(tevAlpha8(p.a) ${['', '<', '==', '<=', '>', '!=', '>='][kind]} ${reference.toFixed(1)})`;
  const first = condition(comparisons & 15, reference0),
    second = condition(comparisons >> 4, reference1);
  return `if (!(${first} ${['&&', '||', '!=', '=='][operation]} ${second})) {
    discard;
  }`;
}
/** Only these source fields affect generated GLSL. Read values, not object
 * identities: animation clones materials and callers may edit a TEV stage. */
export function materialShaderKey(material) {
  const alpha = material.alphaCompare?.join(',') ?? '';
  if (material.glyphAlphaOnly) return `glyph|${alpha}`;
  if (material.tevStages?.length) {
    return `tev|${material.tevStages.map((stage) => stage.join(',')).join(';')}|` +
      `${material.tevSwapTable?.join(',') ?? ''}|${alpha}`;
  }
  return `simple|${material.textureMaps?.length ?? 0}|${alpha}`;
}
export function fragmentSource(material) {
  const statements = [];
  if (material.glyphAlphaOnly) {
    statements.push('p = vec4(raster.rgb, raster.a * texture(t0, texUV0).a);');
  } else if (material.tevStages?.length) {
    material.tevStages.forEach((stage, i) => {
      const slot = ((stage[3] & 1) << 8) | stage[2],
        coord = stage[0];
      const sw = material.tevSwapTable || [228, 192, 213, 234];
      const swizzle = (n) => [0, 2, 4, 6].map((shift) => 'rgba'[(n >> shift) & 3]).join('');
      const textureSample = slot < 4 && coord < 4 ? `texture(t${slot}, texUV${coord})` : 'vec4(1.)';
      const rasterSample =
        stage[1] === 255 || stage[1] === 6 || stage[1] === 7 ? 'vec4(0.)' : 'raster';
      statements.push(
        `// Original TEV stage ${i}.`,
        `tex = ${textureSample};`,
        `tex = tex.${swizzle(sw[(stage[3] >> 3) & 3])};`,
        `ras = ${rasterSample};`,
        `ras = ras.${swizzle(sw[(stage[3] >> 1) & 3])};`,
        `kcolor = ${konst(stage[7] >> 3, false)};`,
        `kalpha = ${konst(stage[11] >> 3, true)};`,
      );
      const color = operation(stage.slice(4, 8), false),
        alpha = operation(stage.slice(8, 12), true);
      statements.push(
        `vec3 c${i} = ${color.code};`,
        `float a${i} = ${alpha.code};`,
        `${color.dest}.rgb = c${i};`,
        `${alpha.dest}.a = a${i};`,
      );
    });
  } else {
    const count = material.textureMaps?.length || 0;
    if (!count) statements.push('p = r1 * raster;');
    else if (count === 1) statements.push('p = mix(r0, r1, texture(t0, texUV0)) * raster;');
    else
      statements.push(
        'p = mix(r0, r1, mix(texture(t1, texUV1), texture(t0, texUV0), kc[3].a)) * raster;',
      );
  }
  const alphaTest = alphaTestSource(material.alphaCompare);
  if (alphaTest) statements.push(alphaTest);
  statements.push('result = p;');
  return `#version 300 es
precision highp float;
uniform sampler2D t0;
uniform sampler2D t1;
uniform sampler2D t2;
uniform sampler2D t3;
uniform vec4 regs[3];
uniform vec4 kc[4];
in vec4 raster;
in vec2 texUV0;
in vec2 texUV1;
in vec2 texUV2;
in vec2 texUV3;
out vec4 result;

vec3 tevColor8(vec3 value) {
  return mod(floor(value * 255.0 + 0.5), 256.0);
}

float tevAlpha8(float value) {
  return mod(floor(value * 255.0 + 0.5), 256.0);
}

void main() {
  vec4 p = vec4(0.0);
  vec4 r0 = regs[0];
  vec4 r1 = regs[1];
  vec4 r2 = regs[2];
  vec4 tex;
  vec4 ras;
  vec3 kcolor;
  float kalpha;
  ${statements.join('\n  ')}
}`;
}

/** GX can select material and vertex sources independently for RGB and alpha. */
export function rasterColor(material, vertexColor, alpha) {
  const colorSource = material.channelControl?.[0] ?? 1;
  const alphaSource = material.channelControl?.[1] ?? 1;
  const materialColor = material.materialColor || WHITE;
  const rgb = colorSource === 0 ? materialColor : vertexColor;
  const a = alphaSource === 0 ? materialColor[3] : vertexColor[3];
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, (a / 255) * alpha];
}

function textureDescriptor(layout, mapping) {
  return mapping?.textureName
    ? layout.resourceTextures?.[mapping.textureName] ||
        layout.textures.find((item) => item.name === mapping.textureName)
    : layout.textures[mapping?.texture];
}

const frameFlips = [
  [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    [0, 1],
  ],
  [
    [
      [1, 0],
      [0, 0],
      [1, 1],
      [0, 1],
    ],
    [0, 1],
  ],
  [
    [
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 0],
    ],
    [0, 1],
  ],
  [
    [
      [0, 1],
      [0, 0],
      [1, 1],
      [1, 0],
    ],
    [1, 0],
  ],
  [
    [
      [1, 1],
      [0, 1],
      [1, 0],
      [0, 0],
    ],
    [0, 1],
  ],
  [
    [
      [1, 0],
      [1, 1],
      [0, 0],
      [0, 1],
    ],
    [1, 0],
  ],
];

/** NW4R's corner-anchored window UVs can extend beyond the texture boundary. */
export function windowFrameUV(size, textureSize, flip, corner) {
  const [coords, indices] = frameFlips[flip],
    result = Array.from({ length: 4 }, () => [0, 0]);
  for (let axis = 0; axis < 2; axis++) {
    const index = indices[axis],
      bit = 1 << axis,
      anchor = coords[corner][index];
    const opposite =
      anchor + size[axis] / ((coords[corner ^ bit][index] - anchor) * textureSize[index]);
    for (let vertex = 0; vertex < 4; vertex++)
      result[vertex][index] = (vertex & bit) === (corner & bit) ? anchor : opposite;
  }
  return result;
}

/** lyt_window.cpp: content inflation plus original 1/4/8-frame draw order. */
export function windowQuads(layout, pane) {
  const frames = pane.frames || [],
    count = frames.length,
    [width, height] = pane.size;
  const texture = (frame) =>
    textureDescriptor(layout, layout.materials[frame?.material]?.textureMaps?.[0]);
  let l = 0,
    r = 0,
    t = 0,
    b = 0;
  if (count === 1 || count === 4 || count === 8) {
    const lt = texture(frames[0]),
      rb = texture(frames[count === 1 ? 0 : 3]);
    l = lt?.width || 0;
    t = lt?.height || 0;
    r = rb?.width || 0;
    b = rb?.height || 0;
  }
  const [il, ir, it, ib] = pane.inflation || [0, 0, 0, 0];
  const quads = [
    {
      x: l - il,
      y: t - it,
      size: [width - l - r + il + ir, height - t - b + it + ib],
      material: pane.material,
      vertexColors: pane.vertexColors,
      texCoords: pane.texCoords,
    },
  ];
  const add = (index, corner, x, y, w, h, flip) => {
    const frame = frames[index],
      descriptor = texture(frame);
    if (!descriptor?.width || !descriptor?.height) return;
    quads.push({
      x,
      y,
      size: [w, h],
      material: frame.material,
      vertexColors: [WHITE, WHITE, WHITE, WHITE],
      texCoords: [
        windowFrameUV([w, h], [descriptor.width, descriptor.height], flip ?? frame.flip, corner),
      ],
    });
  };
  if (count === 1 || count === 4) {
    add(0, 0, 0, 0, width - r, t, count === 1 ? 0 : undefined);
    add(count === 1 ? 0 : 1, 1, width - r, 0, r, height - b, count === 1 ? 1 : undefined);
    add(count === 1 ? 0 : 3, 3, l, height - b, width - l, b, count === 1 ? 4 : undefined);
    add(count === 1 ? 0 : 2, 2, 0, t, l, height - t, count === 1 ? 2 : undefined);
  } else if (count === 8) {
    add(0, 0, 0, 0, l, t);
    add(6, 0, l, 0, width - l - r, t);
    add(1, 1, width - r, 0, r, t);
    add(5, 1, width - r, t, r, height - t - b);
    add(3, 3, width - r, height - b, r, b);
    add(7, 3, l, height - b, width - l - r, b);
    add(2, 2, 0, height - b, l, b);
    add(4, 2, 0, t, l, height - t - b);
  }
  return quads;
}

/** Original pane transforms, texture coordinates and the direct TEV combiner subset. */
export class Renderer {
  constructor(canvas, {
    display = standardDisplay,
    graphics,
    sceneDimensions,
    preserveDrawingBuffer = true,
  } = {}) {
    this.canvas = canvas;
    this.display = display;
    this.graphics = Object.freeze(normalizeGraphics(graphics));
    const resolvedSceneDimensions = sceneDimensions ?? graphicsDimensions(display, this.graphics);
    this.sceneOutputWidth = resolvedSceneDimensions.width;
    this.sceneOutputHeight = resolvedSceneDimensions.height;
    this.sceneInternalWidth = resolvedSceneDimensions.internalWidth;
    this.sceneInternalHeight = resolvedSceneDimensions.internalHeight;
    this.preserveDrawingBuffer = preserveDrawingBuffer;
    this.gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer,
    });
    if (!this.gl) throw new Error('This browser needs WebGL 2 to display the menu.');
    const viewportLimit = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS);
    if (canvas.width > viewportLimit[0] || canvas.height > viewportLimit[1]) {
      throw new Error(`Graphics require a ${canvas.width}×${canvas.height} canvas, but this GPU ` +
        `supports a ${viewportLimit[0]}×${viewportLimit[1]} viewport. ` +
        'Reduce graphics resolution or anti-aliasing.');
    }
    this.presentation = createRenderPresentation(this.gl, this.graphics);
    try {
      // Fail while the application's startup error handler still owns setup,
      // rather than terminating the first animation callback without a notice.
      this.presentation?.begin(this.sceneOutputWidth, this.sceneOutputHeight);
    } catch (error) {
      this.presentation?.destroy();
      throw error;
    }
    this.textures = new Map();
    this.textureLoads = new Map();
    this.programs = new Map();
    this.bounds = new Map();
    const gl = this.gl;
    this.buffer = gl.createBuffer();
    this.blendFactors = [
      gl.ZERO,
      gl.ONE,
      gl.DST_COLOR,
      gl.ONE_MINUS_DST_COLOR,
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.DST_ALPHA,
      gl.ONE_MINUS_DST_ALPHA,
    ];
    this.vertices = new Float32Array(90);
    this.textureCoordinates = new Float32Array(32);
    this.registerColors = new Float32Array(12);
    this.constantColors = new Float32Array(16);
    this.samplers = new Map();
    this.boundTextures = Array(4).fill(null);
    this.boundSamplers = Array(4).fill(null);
    this.boundProgram = null;
    this.activeTextureUnit = -1;
    this.boundArrayBuffer = this.buffer;
    this.blendEnabled = true;
    this.blendSource = gl.SRC_ALPHA;
    this.blendDestination = gl.ONE_MINUS_SRC_ALPHA;
    this.statistics = {
      quads: 0, vertexAllocations: 1, vertexUploads: 0, shaderCompiles: 0,
      programBinds: 0, textureBinds: 0, samplerBinds: 0, uniformUploads: 0,
      bufferBinds: 1, blendToggles: 1, blendFunctionChanges: 1,
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(WHITE),
    );
  }
  setDisplay(display) {
    this.display = display;
  }
  get rasterWidth() {
    return this.presentation ? this.sceneInternalWidth : this.canvas.width;
  }
  get rasterHeight() {
    return this.presentation ? this.sceneInternalHeight : this.canvas.height;
  }
  getGraphicsStatus() {
    return {
      ...this.graphics,
      outputWidth: this.canvas.width,
      outputHeight: this.canvas.height,
      sceneOutputWidth: this.sceneOutputWidth,
      sceneOutputHeight: this.sceneOutputHeight,
      internalWidth: this.rasterWidth,
      internalHeight: this.rasterHeight,
      presentationPass: Boolean(this.presentation),
      outputColorSpace: 'srgb',
      preserveDrawingBuffer: this.preserveDrawingBuffer,
      presentation: this.presentation?.getStatus() ?? null,
      renderer: this.statistics ? { ...this.statistics, samplers: this.samplers.size } : null,
    };
  }
  present({ background } = {}) {
    this.presentation?.present(this.canvas.width, this.canvas.height, background);
    if (this.presentation) this.invalidateGpuState();
  }
  /** Call after any direct GL resource upload or offscreen state handoff. */
  invalidateGpuState() {
    this.boundProgram = null;
    this.activeTextureUnit = -1;
    this.boundArrayBuffer = null;
    this.blendEnabled = null;
    this.blendSource = null;
    this.blendDestination = null;
    this.boundTextures?.fill(null);
    this.boundSamplers?.fill(null);
  }
  /**
   * Capture the already-composited RGB scene, as ChannelTitle's layer 1 does.
   * Reuse a handle during a transition and release it afterward. The physical
   * target follows the canvas; its quad retains the logical projection size.
   * ChannelTitle requests RGB565. This target currently retains RGB8 precision.
   */
  capture(draw, { reuse } = {}) {
    const gl = this.gl,
      display = this.display || standardDisplay;
    if (reuse && (reuse.owner !== this || reuse.released))
      throw new Error('Invalid capture handle');
    const handle = reuse || {
      owner: this,
      key: Symbol('scene capture'),
      texture: gl.createTexture(),
      framebuffer: gl.createFramebuffer(),
    };
    const previous = {
      framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport: gl.getParameter(gl.VIEWPORT),
      scissor: gl.isEnabled(gl.SCISSOR_TEST),
      scissorBox: gl.getParameter(gl.SCISSOR_BOX),
      colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
      clearColor: gl.getParameter(gl.COLOR_CLEAR_VALUE),
      bounds: this.bounds,
    };
    try {
      this.invalidateGpuState();
      gl.bindTexture(gl.TEXTURE_2D, handle.texture);
      if (handle.width !== this.rasterWidth || handle.height !== this.rasterHeight) {
        handle.width = this.rasterWidth;
        handle.height = this.rasterHeight;
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          handle.width,
          handle.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, handle.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        handle.texture,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Scene capture framebuffer is incomplete');
      gl.viewport(0, 0, handle.width, handle.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // The native EFB capture is a complete opaque scene. Keep its alpha one
      // even when translucent source panes blend into its RGB channels.
      gl.colorMask(true, true, true, false);
      this.bounds = new Map();
      draw();
      handle.logicalWidth = display.width;
      handle.logicalHeight = display.height;
      handle.layout = {
        textures: [{ url: handle.key }],
        materials: [
          {
            name: 'scene capture',
            colors: [[0, 0, 0, 0], WHITE, WHITE],
            textureMaps: [{ texture: 0, wrapS: 0, wrapT: 0 }],
          },
        ],
      };
      this.textures.set(handle.key, handle.texture);
      return handle;
    } catch (error) {
      if (!reuse) this.releaseCapture(handle);
      throw error;
    } finally {
      this.bounds = previous.bounds;
      gl.bindFramebuffer(gl.FRAMEBUFFER, previous.framebuffer);
      gl.viewport(...previous.viewport);
      gl.scissor(...previous.scissorBox);
      if (previous.scissor) gl.enable(gl.SCISSOR_TEST);
      else gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(...previous.colorMask);
      gl.clearColor(...previous.clearColor);
      this.invalidateGpuState();
    }
  }
  drawCapture(handle, { matrix = identity, alpha = 1 } = {}) {
    if (!handle || handle.owner !== this || handle.released)
      throw new Error('Invalid capture handle');
    this.quad(
      handle.layout,
      {
        origin: 4,
        size: [handle.logicalWidth, handle.logicalHeight],
        material: 0,
        // An FBO's first texture row is the bottom of the rendered image.
        texCoords: [
          [
            [0, 1],
            [1, 1],
            [0, 0],
            [1, 0],
          ],
        ],
      },
      matrix,
      alpha,
    );
  }
  releaseCapture(handle) {
    if (!handle || handle.released) return;
    if (handle.owner !== this) throw new Error('Capture belongs to a different renderer');
    this.gl.deleteFramebuffer(handle.framebuffer);
    this.gl.deleteTexture(handle.texture);
    this.textures.delete(handle.key);
    this.invalidateGpuState();
    handle.released = true;
  }
  async load(layout) {
    // BRLAN texture-pattern files may not appear in BRLYT's static txl1 table.
    const descriptors = new Map(
      [...layout.textures, ...Object.values(layout.resourceTextures || {})]
        .filter((descriptor) => descriptor.url)
        .map((descriptor) => [descriptor.url, descriptor]),
    );
    await Promise.all(
      [...descriptors.values()].map((descriptor) => this.loadTexture(descriptor.url)),
    );
  }
  async loadTexture(url) {
    if (this.textures.has(url)) return;
    if (this.textureLoads.has(url)) return this.textureLoads.get(url);
    // Startup loads layouts concurrently. Share decoding and GPU allocation,
    // including when font aliases or animated textures refer to the same URL.
    const pending = (async () => {
      const img = new Image();
      img.src = new URL(url, new URL('/assets/', location.href));
      await img.decode();
      const gl = this.gl,
        texture = gl.createTexture();
      if (!texture) throw new Error(`Unable to create texture: ${url}`);
      try {
        this.invalidateGpuState();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.textures.set(url, texture);
      } catch (error) {
        gl.deleteTexture(texture);
        throw error;
      }
    })();
    this.textureLoads.set(url, pending);
    try {
      await pending;
    } finally {
      // Failed loads must remain retryable after their shared rejection.
      this.textureLoads.delete(url);
    }
  }
  program(material) {
    const key = materialShaderKey(material);
    if (this.programs.has(key)) return this.programs.get(key);
    const source = fragmentSource(material);
    const gl = this.gl,
      p = gl.createProgram();
    for (const [type, text] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, source],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(p, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const info = {
      p,
      attributes: Object.fromEntries(
        ['position', 'color', 'uv0', 'uv1', 'uv2', 'uv3'].map((n) => [
          n,
          gl.getAttribLocation(p, n),
        ]),
      ),
      uniforms: Object.fromEntries(
        ['regs', 'kc', 't0', 't1', 't2', 't3', 'projectionHalfSize'].map((n) => [
          n,
          gl.getUniformLocation(p, n),
        ]),
      ),
    };
    this.programs.set(key, info);
    this.statistics.shaderCompiles++;
    return info;
  }
  sampler(wrapS = 0, wrapT = 0) {
    const key = wrapS * 3 + wrapT;
    if (this.samplers.has(key)) return this.samplers.get(key);
    const gl = this.gl;
    const sampler = gl.createSampler();
    if (!sampler) throw new Error('This GPU could not allocate a texture sampler.');
    const wrap = [gl.CLAMP_TO_EDGE, gl.REPEAT, gl.MIRRORED_REPEAT];
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wrap[wrapS]);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, wrap[wrapT]);
    gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.samplers.set(key, sampler);
    return sampler;
  }
  clear({ transparent = false } = {}) {
    const gl = this.gl;
    this.invalidateGpuState();
    if (this.presentation) this.presentation.begin(this.sceneOutputWidth, this.sceneOutputHeight);
    else gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    if (transparent) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(0.92, 0.92, 0.92, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.bounds.clear();
  }
  clip(rect) {
    const gl = this.gl;
    if (!rect) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const display = this.display || standardDisplay;
    gl.enable(gl.SCISSOR_TEST);
    const sx = this.rasterWidth / display.width,
      sy = this.rasterHeight / display.height;
    gl.scissor(rect.x * sx, (display.height - rect.y - rect.h) * sy, rect.w * sx, rect.h * sy);
  }
  draw(
    layout,
    {
      matrix = identity,
      alpha = 1,
      exclude = new Set(),
      alphaContextRoots = new Set(),
      onPane,
      prefix = '',
      layoutMode = 'ipl',
    } = {},
  ) {
    const visit = (pane, parent, ancestorAlpha) => {
      if (!(pane.flags & 1) || exclude.has(pane.name)) return;
      // A separately recalculated native pane keeps its parent's matrix but
      // starts with the restored DrawInfo opacity (Pane::CalcMatrix
      // 0x8151F3D4..4E4). Address Book redraws individual sheets this way.
      if (alphaContextRoots.has(pane.name)) ancestorAlpha = 1;
      const adjusted = paneForDisplay(pane, this.display || standardDisplay, {
        root: pane === layout.root,
        layoutMode,
      });
      const m = multiply(parent, paneMatrix(adjusted));
      const paneAlpha = pane.alpha / 255;
      const a = alpha * paneAlpha * ancestorAlpha;
      const corners = paneCorners(pane, m);
      this.bounds.set(prefix + pane.name, { corners, matrix: m, pane });
      if (onPane?.(pane, m, a) === false) return;
      if (a > 0 && pane.material !== undefined) {
        if (pane.type === 'pic1') this.quad(layout, pane, m, a);
        else if (pane.type === 'wnd1') this.window(layout, pane, m, a);
      }
      // An alpha-influencing pane affects descendants. A non-influencing
      // intermediate pane's own opacity must not leak into grandchildren.
      const childAlpha = ancestorAlpha * (pane.flags & 2 ? paneAlpha : 1);
      for (const child of pane.children || []) visit(child, m, childAlpha);
    };
    visit(layout.root, matrix, 1);
  }
  window(layout, pane, matrix, alpha) {
    const left = (-(pane.origin % 3) * pane.size[0]) / 2,
      top = (Math.floor(pane.origin / 3) * pane.size[1]) / 2;
    for (const quad of windowQuads(layout, pane)) {
      this.quad(
        layout,
        { ...quad, origin: 0 },
        multiply(matrix, [1, 0, 0, 1, left + quad.x, top - quad.y]),
        alpha,
      );
    }
  }
  quad(layout, pane, matrix, alpha) {
    const mat = layout.materials[pane.material];
    if (!mat) return;
    const gl = this.gl,
      info = this.program(mat);
    const programChanged = this.boundProgram !== info.p;
    if (programChanged) {
      gl.useProgram(info.p);
      this.boundProgram = info.p;
      this.statistics.programBinds++;
    }
    if (!info.cachedUniforms) {
      info.cachedUniforms = {
        projection: [NaN, NaN],
        regs: new Float32Array(12).fill(NaN),
        kc: new Float32Array(16).fill(NaN),
      };
      for (let unit = 0; unit < 4; unit++) gl.uniform1i(info.uniforms['t' + unit], unit);
      this.statistics.uniformUploads += 4;
    }
    const display = this.display || standardDisplay;
    if (info.cachedUniforms.projection[0] !== display.halfWidth ||
        info.cachedUniforms.projection[1] !== display.halfHeight) {
      gl.uniform2f(info.uniforms.projectionHalfSize, display.halfWidth, display.halfHeight);
      info.cachedUniforms.projection[0] = display.halfWidth;
      info.cachedUniforms.projection[1] = display.halfHeight;
      this.statistics.uniformUploads++;
    }
    // Native Graphics::setOrthoProjection clips Z to -100..100 with depth tests off.
    const points = paneVertices(pane, matrix);
    const values = this.vertices;
    const uvs = this.textureCoordinates;
    for (let i = 0; i < 4; i++) {
      const generator = mat.texCoordGens?.[i];
      const uv =
        pane.texCoords?.[(generator?.source ?? 4 + i) - 4] || pane.texCoords?.[0] || defaultUV;
      const srt =
        generator?.matrix === 60
          ? null
          : mat.textureSRTs?.[Math.floor(((generator?.matrix ?? 30 + i * 3) - 30) / 3)];
      const radians = srt ? (srt.rotation * Math.PI) / 180 : 0;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      for (let corner = 0; corner < 4; corner++) {
        const [u, v] = uv[corner];
        const offset = i * 8 + corner * 2;
        if (srt) {
          const x = (u - 0.5) * srt.scale[0];
          const y = (v - 0.5) * srt.scale[1];
          uvs[offset] = cosine * x - sine * y + 0.5 + srt.translate[0];
          uvs[offset + 1] = sine * x + cosine * y + 0.5 + srt.translate[1];
        } else {
          uvs[offset] = u;
          uvs[offset + 1] = v;
        }
      }
    }
    // GX_QUADS splits LT–RB; the local corner table is LT, RT, LB, RB.
    let cursor = 0;
    for (const index of QUAD_INDICES) {
      const vertex = pane.vertexColors?.[index] || WHITE;
      const materialColor = mat.materialColor || WHITE;
      const color = mat.channelControl?.[0] === 0 ? materialColor : vertex;
      const opacity = mat.channelControl?.[1] === 0 ? materialColor[3] : vertex[3];
      values[cursor++] = points[index][0];
      values[cursor++] = points[index][1];
      values[cursor++] = points[index][2];
      values[cursor++] = color[0] / 255;
      values[cursor++] = color[1] / 255;
      values[cursor++] = color[2] / 255;
      values[cursor++] = (opacity / 255) * alpha;
      for (let i = 0; i < 4; i++) {
        values[cursor++] = uvs[i * 8 + index * 2];
        values[cursor++] = uvs[i * 8 + index * 2 + 1];
      }
    }
    if (this.boundArrayBuffer !== this.buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      this.boundArrayBuffer = this.buffer;
      this.statistics.bufferBinds++;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, values);
    this.statistics.vertexUploads++;
    if (programChanged) {
      let offset = 0;
      for (const [name, size] of ATTRIBUTE_LAYOUT) {
        const loc = info.attributes[name];
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 60, offset * 4);
        }
        offset += size;
      }
    }
    for (let i = 0; i < 4; i++) {
      const mapping = mat.textureMaps?.[i];
      const desc = textureDescriptor(layout, mapping);
      const texture = this.textures.get(desc?.url) || this.white;
      const sampler = this.sampler(mapping?.wrapS || 0, mapping?.wrapT || 0);
      if (this.boundTextures[i] !== texture) {
        if (this.activeTextureUnit !== i) {
          gl.activeTexture(gl.TEXTURE0 + i);
          this.activeTextureUnit = i;
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        this.boundTextures[i] = texture;
        this.statistics.textureBinds++;
      }
      if (this.boundSamplers[i] !== sampler) {
        gl.bindSampler(i, sampler);
        this.boundSamplers[i] = sampler;
        this.statistics.samplerBinds++;
      }
    }
    for (let color = 0; color < 4; color++) {
      for (let channel = 0; channel < 4; channel++) {
        if (color < 3) this.registerColors[color * 4 + channel] = mat.colors[color][channel] / 255;
        this.constantColors[color * 4 + channel] =
          (mat.konstColors?.[color] ?? WHITE)[channel] / 255;
      }
    }
    this.uploadColorUniform(info, 'regs', this.registerColors);
    this.uploadColorUniform(info, 'kc', this.constantColors);
    const blend = mat.blendMode;
    const blendEnabled = blend?.[0] !== 0;
    if (this.blendEnabled !== blendEnabled) {
      if (blendEnabled) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      this.blendEnabled = blendEnabled;
      this.statistics.blendToggles++;
    }
    if (blendEnabled) {
      const source = this.blendFactors[blend?.[1] ?? 4];
      const destination = this.blendFactors[blend?.[2] ?? 5];
      // RGB follows GX. Separate alpha retains proper coverage when this
      // premultiplied canvas displays HOME/pointer over an HTML settings page.
      if (this.blendSource !== source || this.blendDestination !== destination) {
        gl.blendFuncSeparate(source, destination, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.blendSource = source;
        this.blendDestination = destination;
        this.statistics.blendFunctionChanges++;
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.statistics.quads++;
  }
  uploadColorUniform(info, name, values) {
    const cached = info.cachedUniforms[name];
    let changed = false;
    for (let index = 0; index < values.length; index++) {
      if (values[index] !== cached[index]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.gl.uniform4fv(info.uniforms[name], values);
    cached.set(values);
    this.statistics.uniformUploads++;
  }
  rect(name) {
    const b = this.bounds.get(name);
    if (!b) return null;
    const display = this.display || standardDisplay;
    const xs = b.corners.map((p) => p[0] + display.halfWidth),
      ys = b.corners.map((p) => display.halfHeight - p[1]);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
}
