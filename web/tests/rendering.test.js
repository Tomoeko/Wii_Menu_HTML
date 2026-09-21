import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, indexLayout, poseLayout, paneMatrix, transform3D } from '../src/animation.js';
import {
  Renderer,
  fragmentSource,
  materialShaderKey,
  rasterColor,
  windowQuads,
  windowFrameUV,
} from '../src/renderer.js';
import { BitmapFont } from '../src/font.js';

const white = [255, 255, 255, 255];
function pane(name, options = {}) {
  return {
    name,
    type: 'pic1',
    flags: 1,
    alpha: 255,
    origin: 4,
    size: [20, 10],
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1],
    material: 0,
    vertexColors: [white, white, white, white],
    children: [],
    ...options,
  };
}
function material(name = 'mat', options = {}) {
  return {
    name,
    colors: [[0, 0, 0, 0], white, white],
    konstColors: [white, white, white, white],
    textureMaps: [],
    textureSRTs: [],
    texCoordGens: [],
    tevStages: [],
    ...options,
  };
}
function layout(root, options = {}) {
  return { root, groups: {}, materials: [material()], textures: [], ...options };
}
const move = (name) => ({
  name,
  type: 0,
  tracks: [{ kind: 'RLPA', target: 0, curveType: 2, keys: [{ frame: 0, value: 20, slope: 0 }] }],
});

test('group binding preserves independent child animations unless recursive is requested', () => {
  const source = layout(pane('parent', { children: [pane('child', { material: 1 })] }), {
    groups: { focus: ['parent'] },
    materials: [material('parentMat'), material('childMat')],
  });
  const animation = {
    frames: 20,
    targets: [
      move('parent'),
      move('child'),
      {
        name: 'parentMat',
        type: 1,
        tracks: [{ kind: 'RLMC', target: 4, keys: [{ frame: 0, value: 80 }] }],
      },
      {
        name: 'childMat',
        type: 1,
        tracks: [{ kind: 'RLMC', target: 4, keys: [{ frame: 0, value: 90 }] }],
      },
    ],
  };
  const direct = poseLayout(source, [{ animation, frame: 0, group: 'focus' }]);
  assert.equal(direct.root.translation[0], 20);
  assert.equal(direct.root.children[0].translation[0], 0);
  assert.equal(direct.materials[0].colors[0][0], 80);
  assert.equal(direct.materials[1].colors[0][0], 0);
  const recursive = poseLayout(source, [{ animation, frame: 0, group: 'focus', recursive: true }]);
  assert.equal(recursive.root.children[0].translation[0], 20);
  assert.equal(recursive.materials[1].colors[0][0], 90);
  assert.equal(source.root.translation[0], 0);
});

test('texture patterns switch on the key frame without changing texture table or wrapping', () => {
  const source = layout(pane('image'), {
    materials: [material('static', { textureMaps: [{ texture: 0, wrapS: 1, wrapT: 2 }] })],
    textures: [{ name: 'first.tpl', url: 'first.png' }],
    resourceTextures: { 'second.tpl': { name: 'second.tpl', url: 'second.png' } },
  });
  const animation = {
    frames: 8,
    textures: ['first.tpl', 'second.tpl'],
    targets: [
      {
        name: 'static',
        type: 1,
        tracks: [
          {
            kind: 'RLTP',
            id: 0,
            target: 0,
            curveType: 1,
            keys: [
              { frame: 0, value: 0 },
              { frame: 4, value: 1 },
            ],
          },
        ],
      },
    ],
  };
  const before = poseLayout(source, [{ animation, frame: 3.99 }]);
  const after = poseLayout(source, [{ animation, frame: 4 }]);
  assert.equal(before.materials[0].textureMaps[0].textureName, 'first.tpl');
  assert.equal(after.materials[0].textureMaps[0].textureName, 'second.tpl');
  assert.deepEqual(after.materials[0].textureMaps[0], {
    texture: 0,
    wrapS: 1,
    wrapT: 2,
    textureName: 'second.tpl',
  });
  assert.deepEqual(source.materials[0].textureMaps[0], { texture: 0, wrapS: 1, wrapT: 2 });
  assert.equal(after.textures.length, 1);
});

test('mixed raster sources retain black material RGB and independently faded vertex alpha', () => {
  assert.deepEqual(
    rasterColor({ channelControl: [0, 1], materialColor: [0, 0, 0, 255] }, white, 0.5),
    [0, 0, 0, 0.5],
  );
  assert.deepEqual(
    rasterColor({ channelControl: [1, 0], materialColor: [0, 0, 0, 128] }, [255, 0, 0, 0], 0.5),
    [1, 0, 0, 64 / 255],
  );
  assert.deepEqual(rasterColor({}, [255, 0, 128, 255], 1), [1, 0, 128 / 255, 1]);
});

test('only alpha-influencing ancestors contribute to descendant opacity', () => {
  const source = layout(
    pane('influencer', {
      flags: 3,
      alpha: 128,
      children: [pane('local', { alpha: 64, children: [pane('leaf')] })],
    }),
  );
  const renderer = Object.create(Renderer.prototype);
  renderer.bounds = new Map();
  const drawn = new Map();
  renderer.quad = (_layout, p, _matrix, a) => drawn.set(p.name, a);
  renderer.draw(source, { alpha: 0.5 });
  assert.equal(drawn.get('influencer'), 64 / 255);
  assert.equal(drawn.get('local'), 0.5 * (64 / 255) * (128 / 255));
  assert.equal(drawn.get('leaf'), 64 / 255);
  // A child's flag does not retroactively make its parent an influencer.
  source.root.flags = 1;
  source.root.children[0].flags = 3;
  renderer.draw(source);
  assert.equal(drawn.get('local'), 64 / 255);
  assert.equal(drawn.get('leaf'), 64 / 255);
});

function quadRecorder() {
  const captured = { textures: [], uploadBuffers: [], samplers: [], samplerParameters: [] };
  let unit;
  const functions = {
    bufferSubData: (_target, _offset, data) => {
      captured.uploadBuffers.push(data);
      captured.vertices = new Float32Array(data);
    },
    createSampler: () => ({}),
    bindSampler: (...args) => captured.samplers.push(args),
    samplerParameteri: (...args) => captured.samplerParameters.push(args),
    blendFuncSeparate: (...factors) => (captured.blend = factors),
    activeTexture: (value) => {
      unit = value;
    },
    bindTexture: (_target, texture) => captured.textures.push([unit, texture]),
  };
  const gl = new Proxy(functions, {
    get: (target, name) =>
      name in target ? target[name] : /^[A-Z_0-9]+$/.test(name) ? name : () => {},
  });
  const renderer = Object.create(Renderer.prototype);
  const program = { p: {}, attributes: {}, uniforms: {} };
  Object.assign(renderer, {
    gl,
    buffer: {},
    blendFactors: ['ZERO', 'ONE', 'DST_COLOR', 'ONE_MINUS_DST_COLOR', 'SRC_ALPHA',
      'ONE_MINUS_SRC_ALPHA', 'DST_ALPHA', 'ONE_MINUS_DST_ALPHA'],
    white: 'white',
    textures: new Map([['second.png', 'second-texture']]),
    vertices: new Float32Array(90),
    textureCoordinates: new Float32Array(32),
    registerColors: new Float32Array(12),
    constantColors: new Float32Array(16),
    samplers: new Map(),
    boundTextures: Array(4).fill(null),
    boundSamplers: Array(4).fill(null),
    statistics: {
      quads: 0, vertexUploads: 0, uniformUploads: 0, programBinds: 0, textureBinds: 0, samplerBinds: 0,
      bufferBinds: 0, blendToggles: 0, blendFunctionChanges: 0,
    },
    program: () => program,
  });
  return { renderer, captured };
}

test('quad submission uses the GX diagonal and binds an animated-only image', () => {
  const source = layout(pane('quad'), {
    materials: [
      material('mat', {
        textureMaps: [{ texture: 0, textureName: 'second.tpl', wrapS: 1, wrapT: 2 }],
      }),
    ],
    textures: [{ name: 'first.tpl', url: 'first.png' }],
    resourceTextures: { 'second.tpl': { name: 'second.tpl', url: 'second.png' } },
  });
  const { renderer, captured } = quadRecorder();
  renderer.quad(source, source.root, identity, 1);
  const positions = Array.from({ length: 6 }, (_, i) =>
    Array.from(captured.vertices.slice(i * 15, i * 15 + 2)),
  );
  assert.deepEqual(positions, [
    [-10, 5],
    [10, 5],
    [10, -5],
    [-10, 5],
    [10, -5],
    [-10, -5],
  ]);
  assert.equal(captured.textures[0][1], 'second-texture');
  assert.deepEqual(captured.blend, [
    'SRC_ALPHA',
    'ONE_MINUS_SRC_ALPHA',
    'ONE',
    'ONE_MINUS_SRC_ALPHA',
  ]);
});

test('repeated quad submissions reuse buffers while fully replacing geometry and color', () => {
  const source = layout(pane('first'));
  const { renderer, captured } = quadRecorder();
  renderer.quad(source, source.root, identity, 1);
  const previous = captured.vertices;
  const next = { ...source.root, vertexColors: Array(4).fill([10, 20, 30, 40]) };
  renderer.quad(source, next, [1, 0, 0, 1, 17, -3], 0.5);
  assert.equal(captured.uploadBuffers[0], captured.uploadBuffers[1]);
  assert.deepEqual([...captured.vertices.slice(0, 3)], [7, 2, 0]);
  assert.deepEqual([...previous.slice(0, 3)], [-10, 5, 0]);
  assert.deepEqual([...captured.vertices.slice(3, 7)],
    [...new Float32Array([10 / 255, 20 / 255, 30 / 255, 20 / 255])]);
  assert.equal(renderer.statistics.vertexUploads, 2);
  assert.equal(renderer.statistics.quads, 2);
});

test('one texture can retain distinct cached wrapping in two simultaneous texture units', () => {
  const source = layout(pane('quad'), {
    textures: [{ url: 'second.png' }],
    materials: [material('dual', {
      textureMaps: [{ texture: 0, wrapS: 1, wrapT: 2 }, { texture: 0, wrapS: 0, wrapT: 0 }],
    })],
  });
  const { renderer, captured } = quadRecorder();
  renderer.quad(source, source.root, identity, 1);
  assert.equal(captured.textures[0][1], captured.textures[1][1]);
  assert.notEqual(captured.samplers[0][1], captured.samplers[1][1]);
  assert.equal(captured.samplerParameters.length, 8);
  renderer.quad(source, source.root, identity, 1);
  assert.equal(captured.samplerParameters.length, 8, 'steady draws do not reconfigure samplers');
});

test('shader signatures ignore animated uniforms but invalidate in-place TEV and alpha changes', () => {
  const source = material('animated', {
    textureMaps: [{ texture: 0 }],
    tevStages: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    alphaCompare: [0x77, 0, 0, 0],
  });
  const original = materialShaderKey(source);
  source.colors[0][0] = 123;
  source.textureMaps[0].texture = 9;
  assert.equal(materialShaderKey(source), original);
  source.tevStages[0][4] = 1;
  const stageChanged = materialShaderKey(source);
  assert.notEqual(stageChanged, original);
  source.alphaCompare[2] = 64;
  assert.notEqual(materialShaderKey(source), stageChanged);
});

test('cached bindings and uniforms survive unchanged draws but observe mutation and external uploads', () => {
  const source = layout(pane('quad'));
  const { renderer } = quadRecorder();
  renderer.quad(source, source.root, identity, 1);
  const first = { ...renderer.statistics };
  renderer.quad(source, source.root, identity, 0.5);
  assert.equal(renderer.statistics.programBinds, first.programBinds);
  assert.equal(renderer.statistics.textureBinds, first.textureBinds);
  assert.equal(renderer.statistics.samplerBinds, first.samplerBinds);
  assert.equal(renderer.statistics.uniformUploads, first.uniformUploads,
    'vertex alpha does not redundantly upload material uniforms');
  source.materials[0].colors[0][0] = 53;
  renderer.quad(source, source.root, identity, 1);
  assert.equal(renderer.statistics.uniformUploads, first.uniformUploads + 1);
  renderer.invalidateGpuState();
  renderer.quad(source, source.root, identity, 1);
  assert.equal(renderer.statistics.programBinds, first.programBinds + 1);
  assert.equal(renderer.statistics.textureBinds, first.textureBinds + 4);
  assert.equal(renderer.statistics.samplerBinds, first.samplerBinds + 4);
  assert.equal(renderer.statistics.uniformUploads, first.uniformUploads + 1,
    'external texture uploads do not invalidate per-program uniform contents');
});

test('clear can preserve an HTML underlay while the normal menu remains opaque', () => {
  const colors = [],
    renderer = Object.create(Renderer.prototype);
  renderer.canvas = { width: 832, height: 468 };
  renderer.bounds = new Map([['old', {}]]);
  renderer.gl = {
    viewport() {},
    disable() {},
    clearColor: (...color) => colors.push(color),
    clear() {},
  };
  renderer.clear({ transparent: true });
  renderer.clear();
  assert.deepEqual(colors, [
    [0, 0, 0, 0],
    [0.92, 0.92, 0.92, 1],
  ]);
  assert.equal(renderer.bounds.size, 0);
});

test('TEV comparison shaders generate comparison gates rather than arithmetic interpolation', () => {
  const stage = [0, 4, 0, 0, 0x28, 0xfe, 14, 1, 0x24, 0x76, 15, 1, 0, 0, 0, 0];
  const shader = fragmentSource(material('compare', { tevStages: [stage] }));
  assert.match(shader, /greaterThan\(tevColor8\(tex\.rgb\), tevColor8\(r0\.rgb\)\)/);
  assert.match(shader, /tevAlpha8\(tex\.a\) == tevAlpha8\(r1\.a\)/);
  assert.doesNotMatch(shader, /mix\(tex\.rgb,r0\.rgb/);
  assert.match(shader, /mod\(floor\(value\s*\*\s*255\.0\s*\+\s*0\.5\),\s*256\.0\)/);
  stage[6] = 10;
  const packed = fragmentSource(material('packed', { tevStages: [stage] }));
  assert.match(packed, /dot\(tevColor8\(tex\.rgb\)\.rg, vec2\(1\.,256\.\)\)/);
});

test('a group cannot select a material merely because its name matches a member pane', () => {
  const source = layout(pane('shared'), {
    groups: { g: ['shared'] },
    materials: [material('actual'), material('shared')],
  });
  const animation = {
    frames: 1,
    targets: [
      {
        name: 'shared',
        type: 1,
        tracks: [{ kind: 'RLMC', target: 4, keys: [{ frame: 0, value: 99 }] }],
      },
    ],
  };
  const result = poseLayout(source, [{ animation, frame: 0, group: 'g' }]);
  assert.equal(indexLayout(result).materials.get('shared').colors[0][0], 0);
});

function framedWindow(count = 1) {
  return layout(
    pane('window', {
      type: 'wnd1',
      size: [100, 60],
      inflation: [1, 2, 3, 4],
      frames: Array.from({ length: count }, (_, i) => ({ material: i + 1, flip: 0 })),
    }),
    {
      materials: [
        material(),
        ...Array.from({ length: count }, (_, i) =>
          material(`frame${i}`, { textureMaps: [{ texture: i }] }),
        ),
      ],
      textures: Array.from({ length: count }, (_, i) => ({
        width: i === 3 ? 12 : 8,
        height: i === 3 ? 10 : 6,
      })),
    },
  );
}

test('one-frame window uses four original pinwheel strips and inflated content', () => {
  const source = framedWindow();
  // The one-frame variant ignores its resource flip and generates four flips.
  source.root.frames[0].flip = 3;
  const quads = windowQuads(source, source.root);
  assert.deepEqual(
    quads.map((q) => [q.x, q.y, ...q.size]),
    [
      [7, 3, 87, 55],
      [0, 0, 92, 6],
      [92, 0, 8, 54],
      [8, 54, 92, 6],
      [0, 6, 8, 54],
    ],
  );
  assert.deepEqual(quads[2].texCoords[0], [
    [1, 0],
    [0, 0],
    [1, 9],
    [0, 9],
  ]);
  assert.deepEqual(quads[3].texCoords[0], [
    [11.5, 1],
    [0, 1],
    [11.5, 0],
    [0, 0],
  ]);
});

test('four-frame and eight-frame windows use distinct native material orders', () => {
  const four = framedWindow(4),
    eight = framedWindow(8);
  const fourQuads = windowQuads(four, four.root),
    eightQuads = windowQuads(eight, eight.root);
  assert.deepEqual(
    fourQuads.map((q) => q.material),
    [0, 1, 2, 4, 3],
  );
  assert.deepEqual(
    fourQuads.map((q) => q.size),
    [
      [83, 51],
      [88, 6],
      [12, 50],
      [92, 10],
      [8, 54],
    ],
  );
  assert.deepEqual(
    eightQuads.map((q) => q.material),
    [0, 1, 7, 2, 6, 4, 8, 3, 5],
  );
  assert.deepEqual(
    eightQuads.slice(1).map((q) => [q.x, q.y, ...q.size]),
    [
      [0, 0, 8, 6],
      [8, 0, 80, 6],
      [88, 0, 12, 6],
      [88, 6, 12, 44],
      [88, 50, 12, 10],
      [8, 50, 80, 10],
      [0, 50, 8, 10],
      [0, 6, 8, 44],
    ],
  );
});

test('rotated window texture coordinates retain native swapped texture dimensions', () => {
  assert.deepEqual(windowFrameUV([20, 12], [8, 10], 3, 0), [
    [0, 1],
    [0, -1],
    [1.5, 1],
    [1.5, -1],
  ]);
  assert.deepEqual(windowFrameUV([20, 12], [8, 10], 5, 3), [
    [1.5, -1],
    [1.5, 1],
    [0, -1],
    [0, 1],
  ]);
});

test('window drawing preserves pane origin, transform and alpha for all components', () => {
  const source = framedWindow(),
    renderer = Object.create(Renderer.prototype),
    drawn = [];
  renderer.quad = (_layout, p, m, a) => drawn.push({ p, m, a });
  renderer.window(source, source.root, [2, 0, 0, 3, 10, 20], 0.5);
  assert.deepEqual(drawn[0].m, [2, 0, 0, 3, -76, 101]);
  assert.equal(drawn.length, 5);
  assert.ok(drawn.every((draw) => draw.p.origin === 0 && draw.a === 0.5));
});

test('text panes respect independent font axes, spacing, line height, baseline and color mapping', () => {
  const drawn = [],
    font = new BitmapFont(
      {
        width: 40,
        height: 50,
        baseline: 35,
        ascent: 38,
        lineFeed: 55,
        defaultGlyph: 0,
        characters: { 65: 0 },
        glyphs: { 0: { sheet: 0, x: 1, y: 1, width: 20, height: 50, left: 2, advance: 22 } },
        sheets: [{ width: 128, height: 128 }],
      },
      { quad: (layout, pane, matrix, alpha) => drawn.push({ layout, pane, matrix, alpha }) },
    );
  const textBox = pane('label', {
    type: 'txt1',
    size: [80, 40],
    fontSize: [20, 20],
    charSpace: -1,
    lineSpace: 0,
    textPosition: 4,
    textColors: [
      [255, 0, 0, 255],
      [0, 0, 255, 128],
    ],
  });
  assert.equal(font.width('AA', [20, 25], -1), 21);
  assert.equal(font.width('', [20, 25], -1), 0);
  font.drawPane('AA', textBox, identity, 0.5, {
    material: material('label', { colors: [[0, 0, 0, 0], [70, 70, 70, 255], white] }),
  });
  assert.deepEqual(
    drawn.map((d) => d.pane.size),
    [
      [10, 20],
      [10, 20],
    ],
  );
  assert.deepEqual(
    drawn.map((d) => d.matrix.slice(4)),
    [
      [-9.5, 9.8],
      [0.5, 9.8],
    ],
  );
  assert.deepEqual(drawn[0].pane.vertexColors, [
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 128],
    [0, 0, 255, 128],
  ]);
  assert.deepEqual(drawn[0].layout.materials[0].colors[1], [70, 70, 70, 255]);
  assert.equal(drawn[0].alpha, 0.5);
});

test('GX alpha compare combines both reference tests after the TEV result', () => {
  const source = fragmentSource(material('alpha', { alphaCompare: [0x14, 0, 32, 192] }));
  assert.match(
    source,
    /if\s*\(!\(\(tevAlpha8\(p.a\) > 32.0\) && \(tevAlpha8\(p.a\) < 192.0\)\)\)\s*\{\s*discard;\s*\}\s*result\s*=\s*p/,
  );
  assert.match(
    fragmentSource(material('xor', { alphaCompare: [0x70, 2, 0, 0] })),
    /if\s*\(!\(false != true\)\)\s*\{\s*discard/,
  );
  assert.doesNotMatch(
    fragmentSource(material('always', { alphaCompare: [0x77, 0, 0, 0] })),
    /discard/,
  );
});

test('renderer submits all three position components through a rotated hierarchy', () => {
  const source = layout(pane('quad', { rotation: [0, 90, 0], translation: [3, 4, 5] }));
  const { renderer, captured } = quadRecorder();
  renderer.quad(source, source.root, paneMatrix(source.root), 1);
  const positions = Array.from({ length: 6 }, (_, i) =>
    Array.from(captured.vertices.slice(i * 15, i * 15 + 3)).map(Math.round),
  );
  assert.deepEqual(positions, [
    [3, 9, 15],
    [3, 9, -5],
    [3, -1, -5],
    [3, 9, 15],
    [3, -1, -5],
    [3, -1, 15],
  ]);
});

test('glyph offsets concatenate with a full 3D parent matrix', () => {
  const drawn = [],
    font = new BitmapFont(
      {
        width: 10,
        height: 10,
        defaultGlyph: 0,
        characters: { 65: 0 },
        glyphs: { 0: { sheet: 0, x: 0, y: 0, width: 8, height: 10, left: 2, advance: 10 } },
        sheets: [{ width: 16, height: 16 }],
      },
      { quad: (_layout, _pane, matrix) => drawn.push(matrix) },
    );
  const matrix = paneMatrix({ translation: [10, 20, 30], rotation: [90, 0, 0], scale: [1, 1] });
  font.draw('A', 3, 4, 10, { matrix, align: 'left' });
  assert.deepEqual(transform3D(drawn[0], 0, 0).map(Math.round), [15, 20, 34]);
});
