import test from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFont } from '../src/font.js';
import { fragmentSource } from '../src/renderer.js';

function drawMaterial(format, colorMapping) {
  let result;
  const font = new BitmapFont(
    {
      width: 32,
      height: 38,
      characters: { 65: 0 },
      defaultGlyph: 0,
      glyphs: [{ sheet: 0, x: 1, y: 1, width: 20, height: 36, left: 0, advance: 22 }],
      sheets: [{ width: 256, height: 256, format }],
    },
    {
      quad: (layout) => {
        result = layout.materials[0];
      },
    },
  );
  font.draw('A', 0, 0, [20, 20], { colorMapping });
  return result;
}

test('default I4/I8 glyphs retain vertex color instead of darkening coverage twice', () => {
  const defaultMapping = [
    [0, 0, 0, 0],
    [255, 255, 255, 255],
  ];
  for (const format of [0, 1]) {
    for (const mapping of [undefined, defaultMapping]) {
      const material = drawMaterial(format, mapping);
      assert.equal(material.glyphAlphaOnly, true);
      assert.match(
        fragmentSource(material),
        /vec4\(raster\.rgb,\s*raster\.a\s*\*\s*texture\(t0,\s*texUV0\)\.a\)/,
      );
    }
  }
});

test('intensity-alpha fonts and explicit nondefault mappings retain texture RGB', () => {
  for (const format of [2, 3]) {
    assert.equal(drawMaterial(format).glyphAlphaOnly, false);
  }
  const mapping = [
    [20, 30, 40, 0],
    [210, 220, 230, 255],
  ];
  const material = drawMaterial(0, mapping);
  assert.equal(material.glyphAlphaOnly, false);
  assert.deepEqual(material.colors.slice(0, 2), mapping);
  assert.match(
    fragmentSource(material),
    /mix\(r0,\s*r1,\s*texture\(t0,\s*texUV0\)\)\s*\*\s*raster/,
  );
});

test('the visible Space marker uses the original Wii keycap glyph when U+2423 is absent', () => {
  const font = new BitmapFont({
    characters: { 0xe057: 1 },
    defaultGlyph: 0,
    glyphs: [
      { sheet: 0, x: 0, y: 0, width: 1, height: 1, left: 0, advance: 1 },
      { sheet: 0, x: 1, y: 0, width: 2, height: 1, left: 0, advance: 2 },
    ],
    sheets: [{ width: 4, height: 1, format: 0 }],
  }, {});
  assert.equal(font.glyph('\u2423'), font.font.glyphs[1]);
});
