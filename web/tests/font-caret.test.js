import test from 'node:test';
import assert from 'node:assert/strict';
import { BitmapFont } from '../src/font.js';
import { keyboardCaretOpacity } from '../src/keyboard-caret.js';
const pane = {
  origin: 0,
  fontSize: [20, 32],
  size: [40, 100],
  textPosition: 0,
  charSpace: 0,
  lineSpace: 0,
  caretIndex: 3,
};
const face = (calls) =>
  new BitmapFont(
    {
      width: 20,
      height: 32,
      lineFeed: 42,
      baseline: 26,
      ascent: 26,
      characters: { 87: 0, 105: 1 },
      glyphs: [{ advance: 20 }, { advance: 5 }],
      defaultGlyph: 1,
      sheets: [],
    },
    { quad: (...args) => calls.push(args) },
  );

test('caret follows original variable glyph widths, wrapping and explicit newline positions', () => {
  const calls = [],
    font = face(calls),
    matrix = [1, 0, 0, 1, 0, 0];
  const layout = font.layoutPaneText('WiWi', pane);
  assert.deepEqual(
    layout.lines.map((line) => line.text),
    ['Wi', 'Wi'],
  );
  font.drawCaret('WiWi', pane, matrix);
  assert.deepEqual(calls[0][2], [1, 0, 0, 1, 18, -44]);
  font.drawCaret('W\ni', { ...pane, caretIndex: 2 }, matrix);
  assert.deepEqual(calls[1][2], [1, 0, 0, 1, -2, -44]);
  font.drawCaret('', { ...pane, caretIndex: 0 }, matrix);
  assert.deepEqual(calls[2][2], [1, 0, 0, 1, -2, -2]);
  font.drawCaret('', { ...pane, caretIndex: 0, caretVisible: false }, matrix);
  assert.equal(calls.length, 3);
});

test('native caret keeps its centered thickness at fractional proportional-glyph boundaries', () => {
  const calls = [];
  const font = face(calls);
  const text = 'iWi';
  const field = { ...pane, fontSize: [19, 32], noWrap: true, charSpace: 0.35 };
  for (let caretIndex = 0; caretIndex <= text.length; caretIndex++)
    font.drawCaret(text, { ...field, caretIndex }, [1, 0, 0, 1, 0, 0]);
  const positions = font.layoutPaneText(text, field).lines[0].carets;
  for (const [index, call] of calls.entries()) {
    assert.deepEqual(call[1].size, [4, 28]);
    assert.deepEqual(call[1].vertexColors[0], [255, 50, 50, 255]);
    assert.ok(Math.abs(call[2][4] + 2 - positions[index].x) < 1e-10);
    assert.equal(call[2][5], -2);
  }
  font.renderer.display = { width: 832 };
  font.drawCaret(text, { ...field, caretIndex: 2 }, [1, 0, 0, 1, 0, 0]);
  assert.equal(calls.at(-1)[1].size[0], 17 / 6);
});

test('native caret fades continuously through its 45-update pulse and retains pane opacity', () => {
  const calls = [];
  const font = face(calls);
  assert.equal(keyboardCaretOpacity(0), 127 / 255);
  assert.equal(keyboardCaretOpacity(11.25), 254 / 255);
  assert.equal(keyboardCaretOpacity(33.75), 0);
  assert.ok(Math.abs(keyboardCaretOpacity(45) - keyboardCaretOpacity(0)) <= 1 / 255);
  font.drawCaret('', { ...pane, caretIndex: 0, caretOpacity: 0.25 }, [1, 0, 0, 1, 0, 0], 0.5);
  assert.equal(calls[0][3], 0.125);
});

test('composition color follows UTF-16 ranges across wrapping without moving glyphs', () => {
  const calls = [];
  const font = new BitmapFont(
    {
      width: 20,
      height: 32,
      lineFeed: 42,
      baseline: 26,
      ascent: 26,
      characters: { 87: 0, 105: 1 },
      glyphs: [
        { advance: 20, width: 20, height: 32, sheet: 0, x: 0, y: 0, left: 0 },
        { advance: 5, width: 5, height: 32, sheet: 0, x: 20, y: 0, left: 0 },
      ],
      defaultGlyph: 1,
      sheets: [{ width: 32, height: 32 }],
    },
    { quad: (...args) => calls.push(args) },
  );
  const red = [255, 51, 51, 255];
  font.drawPane(
    'WiWi',
    {
      ...pane,
      textColors: [
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ],
      textColorRanges: [{ start: 1, end: 3, color: red }],
    },
    [1, 0, 0, 1, 0, 0],
  );
  assert.deepEqual(
    calls.map((call) => call[1].vertexColors[0]),
    [[0, 0, 0, 255], red, red, [0, 0, 0, 255]],
  );
  assert.deepEqual(
    calls.map((call) => call[2].slice(4)),
    [
      [0, 0],
      [20, 0],
      [0, -42],
      [20, -42],
    ],
  );
});

test('single-line no-wrap fields retain original glyph positions beyond the viewport', () => {
  const font = face([]);
  const layout = font.layoutPaneText('WiWiWi', { ...pane, noWrap: true });
  assert.equal(layout.lines.length, 1);
  assert.equal(layout.lineHeight, 42);
  assert.equal(layout.lines[0].carets.at(-1).x, 75);
});


test('explicit line feeds draw the native marker without adding wrap lines or caret positions', () => {
  const calls = [];
  const font = new BitmapFont({
    width: 20, height: 32, lineFeed: 42, baseline: 26, ascent: 26,
    characters: { 87: 0, 105: 1, 0xE056: 2 },
    glyphs: [
      { advance: 20, width: 20, height: 32, sheet: 0, x: 0, y: 0, left: 0 },
      { advance: 5, width: 5, height: 32, sheet: 0, x: 20, y: 0, left: 0 },
      { advance: 30, width: 21, height: 32, sheet: 0, x: 32, y: 0, left: 3 },
    ],
    defaultGlyph: 1,
    sheets: [{ width: 64, height: 32 }],
  }, { quad: (...args) => calls.push(args) });
  const field = {
    ...pane, showLineFeeds: true, charSpace: 0.5,
    textColors: [[10, 20, 30, 160], [40, 50, 60, 160]],
  };
  const text = 'WiW\ni\n';
  const layout = font.layoutPaneText(text, field);
  assert.deepEqual(layout.lines.map((line) => [line.text, line.start, line.end]), [
    ['Wi', 0, 2], ['W', 2, 3], ['i', 4, 5], ['', 6, 6],
  ]);
  font.drawPane(text, field, [1, 0, 0, 1, 0, 0], 0.5);
  const markers = calls.filter((call) => call[1].vertexColors[0][0] === 200);
  assert.equal(markers.length, 2, 'automatic wrapping does not introduce a marker');
  assert.deepEqual(markers.map((call) => call[2].slice(4)), [[23.5, -42], [8.5, -84]]);
  assert.deepEqual(markers[0][1].vertexColors, Array.from({ length: 4 }, () => [200, 200, 200, 160]));
  assert.equal(markers[0][3], 0.5);
  assert.deepEqual(font.layoutPaneText(text, field), layout, 'decorations do not change layout');
  calls.length = 0;
  font.drawPane(text, { ...field, showLineFeeds: false }, [1, 0, 0, 1, 0, 0]);
  assert.equal(calls.length, 4, 'ordinary labels and posted readers keep standard line breaks');
});
