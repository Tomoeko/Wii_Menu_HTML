import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Renderer } from '../src/renderer.js';
import { BitmapFont } from '../src/font.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;

function loaderFixture(t) {
  const originalImage = globalThis.Image;
  const originalLocation = globalThis.location;
  const decodes = [];
  const calls = { created: [], uploaded: [], deleted: [] };
  globalThis.location = { href: 'http://localhost/menu.html' };
  globalThis.Image = class {
    decode() {
      return new Promise((resolve, reject) => {
        decodes.push({ image: this, resolve, reject });
      });
    }
  };
  t.after(() => {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  });
  const gl = {
    createTexture() {
      const texture = { id: calls.created.length };
      calls.created.push(texture);
      return texture;
    },
    texImage2D(...args) {
      if (calls.uploadFailure) throw calls.uploadFailure;
      calls.uploaded.push(args.at(-1));
    },
    deleteTexture(texture) {
      calls.deleted.push(texture);
    },
    bindTexture() {},
    pixelStorei() {},
    texParameteri() {},
  };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    gl,
    textures: new Map(),
    textureLoads: new Map(),
  });
  return { renderer, decodes, calls };
}

test('concurrent layouts share static, animated and aliased texture loading', async (t) => {
  const { renderer, decodes, calls } = loaderFixture(t);
  const first = {
    textures: [{ url: 'shared.png' }, { url: 'first.png' }, {}],
    resourceTextures: { animated: { url: 'animated.png' } },
  };
  const second = {
    textures: [{ url: 'shared.png' }, { url: 'animated.png' }],
    resourceTextures: { alias: { url: 'shared.png' } },
  };
  const loads = [renderer.load(first), renderer.load(second), renderer.load(first)];
  assert.equal(decodes.length, 3);
  assert.deepEqual(
    decodes.map(({ image }) => String(image.src)),
    ['shared.png', 'first.png', 'animated.png'].map((name) => `http://localhost/assets/${name}`),
  );
  for (const decode of decodes) decode.resolve();
  await Promise.all(loads);
  assert.equal(calls.created.length, 3);
  assert.equal(calls.uploaded.length, 3);
  assert.equal(renderer.textures.size, 3);
  assert.equal(renderer.textureLoads.size, 0);
  await Promise.all([renderer.load(second), renderer.load(first)]);
  assert.equal(decodes.length, 3);
  assert.equal(calls.created.length, 3);
});

test('texture loading rejects external and non-asset resources before decoding', async (t) => {
  const { renderer, decodes } = loaderFixture(t);
  for (const url of ['https://other.example/icon.png', '//other.example/icon.png',
    'data:image/png;base64,AAAA', '../private.png']) {
    await assert.rejects(renderer.loadTexture(url), /local assets/);
  }
  assert.equal(decodes.length, 0);
});

test('a shared decode failure rejects every caller and a later load can retry', async (t) => {
  const { renderer, decodes, calls } = loaderFixture(t);
  const layout = { textures: [{ url: 'retry.png' }] };
  const failure = new Error('Image unavailable');
  const results = Promise.allSettled([renderer.load(layout), renderer.load(layout)]);
  decodes[0].reject(failure);
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, failure);
  }
  assert.equal(calls.created.length, 0);
  assert.equal(renderer.textureLoads.size, 0);
  const retry = renderer.load(layout);
  assert.equal(decodes.length, 2);
  decodes[1].resolve();
  await retry;
  assert.equal(renderer.textures.size, 1);
});

test('a failed upload releases its texture before retrying', async (t) => {
  const { renderer, decodes, calls } = loaderFixture(t);
  const layout = { textures: [{ url: 'upload.png' }] };
  const failure = new Error('Upload failed');
  calls.uploadFailure = failure;
  const first = renderer.load(layout);
  const rejected = assert.rejects(first, (error) => error === failure);
  decodes[0].resolve();
  await rejected;
  assert.deepEqual(calls.deleted, calls.created);
  assert.equal(renderer.textures.size, 0);
  assert.equal(renderer.textureLoads.size, 0);
  delete calls.uploadFailure;
  const retry = renderer.load(layout);
  decodes[1].resolve();
  await retry;
  assert.equal(calls.created.length, 2);
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.uploaded.length, 1);
});

test('original bitmap aliases retain sheet identity through reversed cold decode completion',
  { skip: !manifest?.fonts }, async (t) => {
    const { renderer, decodes, calls } = loaderFixture(t);
    const fonts = new Map(Object.entries(manifest.fonts).map(([name, descriptor]) => [
      name, new BitmapFont(JSON.parse(readFileSync(new URL(descriptor.url, manifestUrl))), renderer),
    ]));
    const sheetUrls = new Set([...fonts.values()].flatMap((font) =>
      font.font.sheets.map((sheet) => sheet.url)));
    let loaded = false;
    const loading = Promise.all([...fonts.values()].map((font) => font.load())).then(() => {
      loaded = true;
    });
    assert.equal(decodes.length, sheetUrls.size, 'aliases share every physical sheet decode');
    for (const decode of [...decodes].reverse().slice(0, -1)) decode.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loaded, false, 'the final missing atlas keeps the whole font set unready');
    decodes[0].resolve();
    await loading;
    assert.equal(calls.created.length, sheetUrls.size);
    assert.equal(renderer.textures.size, sheetUrls.size);
    const uploaded = new Map(calls.uploaded.map((image, index) => [
      String(image.src), calls.created[index],
    ]));
    for (const [name, font] of fonts) {
      for (const sheet of font.font.sheets) {
        const expected = uploaded.get(`http://localhost/assets/${sheet.url}`);
        assert.ok(expected, name);
        assert.equal(renderer.textures.get(sheet.url), expected, name);
      }
      for (const character of ['A', 'a', '0', '?']) {
        const glyph = font.glyph(character);
        assert.ok(glyph && font.font.sheets[glyph.sheet], `${name}: ${character}`);
      }
    }
    assert.equal(fonts.get('WiiBitmapFontType1.brfnt').font.sourceSha256,
      fonts.get('wbf1.brfna').font.sourceSha256);
    assert.notEqual(fonts.get('WiiBitmapFontType1.brfnt').font.sourceSha256,
      fonts.get('WiiBitmapFontType2.brfnt').font.sourceSha256);
  });
