import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keyboardCaretAtPoint,
  keyboardSecondaryTarget,
  routeKeyboardTextPointer,
} from '../src/keyboard-text-hit.js';
import { BitmapFont } from '../src/font.js';

const pane = (name, changes = {}) => ({
  name,
  flags: 1,
  origin: 0,
  alpha: 255,
  translation: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1],
  size: [100, 60],
  children: [],
  ...changes,
});
const layout = {
  materials: [],
  root: pane('root', {
    children: [pane('text', { translation: [-50, 50, 0] })],
  }),
};
const measure = () => ({
  lineHeight: 20,
  lines: [
    { start: 0, y: 0, carets: [{ index: 0, x: 0 }, { index: 1, x: 10 }, { index: 3, x: 30 }] },
    { start: 4, y: -20, carets: [{ index: 4, x: 0 }, { index: 5, x: 15 }] },
  ],
});
const hit = (point, changes = {}) => keyboardCaretAtPoint({
  layout,
  paneName: 'text',
  text: 'A😀\nB',
  display: { width: 608 },
  measure,
  point,
  ...changes,
});

test('text hit testing uses glyph widths and wrapped line positions instead of character counts', () => {
  assert.equal(hit({ x: 279, y: 188 }), 3);
  assert.equal(hit({ x: 269, y: 208 }), 5);
  assert.equal(hit({ x: 253, y: 188 }), null);
});

test('text hit testing reverses the displayed wide-screen root projection', () => {
  const wideX = 416 + (279 - 304) * 832 / 608;
  assert.equal(hit({ x: wideX, y: 188 }, { display: { width: 832 } }), 3);
});

test('clipped scrolling text is selectable inside its viewport and never outside it', () => {
  const clip = { x: 270, y: 180, w: 140, h: 40 };
  assert.equal(hit({ x: 260, y: 188 }, { clip }), null);
  assert.equal(hit({ x: 400, y: 188 }, { clip }), 3);
});

test('a fixed viewport selects scrolled text beyond the text resource original height', () => {
  const scrolled = structuredClone(layout);
  scrolled.root.children[0].translation[1] += 200;
  scrolled.root.children.push(pane('viewport', { translation: [-50, 50, 0] }));
  const options = {
    layout: scrolled, hitPaneName: 'viewport',
    measure: () => ({
      lineHeight: 20,
      lines: [{ start: 10, y: -200, carets: [{ index: 10, x: 0 }, { index: 11, x: 10 }] }],
    }),
  };
  assert.equal(hit({ x: 265, y: 188 }, options), 11);
  assert.equal(hit({ x: 265, y: 148 }, options), null);
});

test('multiline selection follows actual proportional wrapping after scrolling and pane transforms', () => {
  const font = new BitmapFont({
    width: 20,
    height: 32,
    lineFeed: 42,
    baseline: 26,
    ascent: 26,
    characters: { 87: 0, 105: 1 },
    glyphs: [{ advance: 20 }, { advance: 5 }],
    defaultGlyph: 1,
    sheets: [],
  }, {});
  const text = 'WiWi\niW';
  const scrolled = {
    root: pane('root', { children: [pane('text', {
      translation: [-50, 92, 0],
      scale: [1.25, 1],
      size: [40, 100],
      textPosition: 0,
      fontSize: [20, 32],
    })] }),
  };
  const select = (x, y) => hit({ x, y }, {
    layout: scrolled,
    text,
    measure: (value, field) => font.layoutPaneText(value, field),
    clip: { x: 254, y: 177, w: 50, h: 84 },
  });
  assert.equal(select(279, 198), 3, 'wrapped second line, after the wide W');
  assert.equal(select(260.25, 240), 6, 'explicit third line, after the narrow i');
  assert.equal(select(279, 176), null, 'scrolled-off text is not selectable');
});


test('topmost visible keyboard control occludes text even while its input is disabled', () => {
  const rect = { x: 10, y: 10, w: 100, h: 40 };
  let selections = 0;
  const controls = [
    { id: 'lower', rect },
    { id: 'candidate', rect },
    { id: 'disabled', rect, disabled: true },
  ];
  const select = () => { selections++; return true; };
  const covered = routeKeyboardTextPointer({ x: 20, y: 20 }, controls, select);
  assert.equal(covered.control.id, 'disabled');
  assert.equal(covered.control.disabled, true);
  assert.equal(covered.selected, false);
  assert.equal(selections, 0);
  assert.equal(routeKeyboardTextPointer({ x: 0, y: 0 }, controls, select).selected, true);
  assert.equal(selections, 1);
});

test('a disabled text opener blocks selection without opening its editor', () => {
  let selections = 0;
  const control = {
    id: 'scene-memo-edit', rect: { x: 10, y: 10, w: 100, h: 40 }, disabled: true,
  };
  const result = routeKeyboardTextPointer({ x: 20, y: 20 }, [control], () => {
    selections++;
    return true;
  });
  assert.equal(result.control, control);
  assert.equal(result.selected, false);
  assert.equal(selections, 0);
});

test('secondary clicks target only unobstructed enabled phone keys in the active host surface', () => {
  const rect = { x: 10, y: 10, w: 100, h: 40 };
  const point = { x: 20, y: 20 };
  for (const prefix of ['scene-', 'settings-keyboard-']) {
    const key = { id: `${prefix}key-phone-1`, rect };
    assert.deepEqual(keyboardSecondaryTarget(point, [key]), { prefix, id: 'key-phone-1' });
    assert.equal(keyboardSecondaryTarget(point, [{ ...key, disabled: true }]), null);
    assert.equal(keyboardSecondaryTarget(point, [key, { id: 'dialog', rect }]), null);
    assert.equal(keyboardSecondaryTarget({ x: 0, y: 0 }, [key]), null);
    for (const id of ['key-back', 'key-phone-mode-1', 'key-more', 'key-backspace']) {
      assert.equal(keyboardSecondaryTarget(point, [{ id: prefix + id, rect }]), null);
    }
  }
  assert.equal(keyboardSecondaryTarget(point, [{ id: 'key-phone-1', rect }]), null);
});
