import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoEditorScroll } from '../src/memo-editor-scroll.js';
import { createCandidateStrip } from '../src/keyboard-candidates.js';
import { createKeyboardTextField } from '../src/keyboard-text-field.js';

const lines = Array.from({ length: 12 }, (_, index) => ({
  start: index * 5,
  text: 'text',
  end: index * 5 + 4,
}));

test('Memo editing keeps the caret inside the native two-line window with 15-update motion', () => {
  let sounds = 0;
  const scroll = createMemoEditorScroll(() => sounds++);
  scroll.measure({ lines, lineHeight: 42 }, 52, true);
  assert.equal(scroll.snapshot().offset, 0);
  scroll.advance(7.5);
  assert.equal(scroll.snapshot().offset, 189);
  scroll.advance(7.5);
  assert.equal(scroll.snapshot().offset, 378);
  assert.equal(scroll.snapshot().maximum, 420);
  scroll.measure({ lines, lineHeight: 42 }, 0, true);
  scroll.advance(15);
  assert.equal(scroll.snapshot().offset, 0);
  assert.equal(sounds, 2);
});

test('Memo display page scroll advances three ruled lines and clamps to original bounds', () => {
  const scroll = createMemoEditorScroll();
  scroll.measure({ lines, lineHeight: 42 }, 0, false);
  assert.equal(scroll.scroll(-1), false);
  assert.equal(scroll.scroll(1), true);
  assert.equal(scroll.scroll(1), false);
  scroll.advance(15);
  assert.equal(scroll.snapshot().offset, 126);
  for (let index = 0; index < 5; index++) {
    scroll.scroll(1);
    scroll.advance(15);
  }
  assert.equal(scroll.snapshot().offset, 404);
  assert.equal(scroll.snapshot().next, false);
});

test('candidate paging overlaps the partial word and safely traverses an oversized word', () => {
  const strip = createCandidateStrip(['wide', 'b', 'c'], {
    measure: (value) => (value === 'wide' ? 1000 : 200),
    areaWidth: 390,
    projectionWidth: 608,
  });
  assert.equal(strip.snapshot().entries.length, 1);
  strip.scroll(1);
  strip.advance(15);
  assert.equal(strip.snapshot().scrolling, true, 'the scalar endpoint is still input-locked');
  assert.equal(strip.scroll(-1), false);
  strip.advance(1);
  assert.equal(strip.snapshot().first, 1);
  assert.equal(strip.snapshot().entries.length, 2);
  strip.scroll(-1);
  strip.advance(16);
  assert.equal(strip.snapshot().first, 0);
});

test('deleting text during a scroll cannot move Memo or Settings text past its new bounds', () => {
  const memo = createMemoEditorScroll();
  memo.measure({ lines, lineHeight: 42 }, 52, true);
  memo.advance(7);
  memo.measure({ lines: lines.slice(0, 1), lineHeight: 42 }, 0, true);
  memo.advance(8);
  assert.ok(memo.snapshot().offset <= memo.snapshot().maximum);
  const field = createKeyboardTextField({
    pane: { size: [200, 84] },
    rowLimit: 16,
    measure: (text) => ({ lineHeight: 42, lines: lines.slice(0, text.length) }),
  });
  field.update('123456789012', 52);
  field.advance(7);
  field.update('1', 0);
  field.advance(8);
  assert.equal(field.snapshot().y, 0);
  assert.equal(field.snapshot().maximum, 0);
});

test('manual editor arrows advance one ruled line and retain the requested viewport', () => {
  const scroll = createMemoEditorScroll();
  scroll.measure({ lines, lineHeight: 42 }, 10, true);
  scroll.advance(15);
  assert.equal(scroll.snapshot().offset, 42);
  assert.equal(scroll.scroll(-1, { editing: true }), true);
  scroll.measure({ lines, lineHeight: 42 }, 10, true);
  scroll.advance(7.5);
  assert.equal(scroll.snapshot().offset, 21);
  scroll.advance(7.5);
  scroll.measure({ lines, lineHeight: 42 }, 10, true);
  assert.equal(scroll.snapshot().offset, 0);
  assert.equal(scroll.snapshot().moving, false);
  scroll.scroll(1, { editing: true });
  scroll.advance(15);
  assert.equal(scroll.snapshot().offset, 42);
});

test('editor bounds use actual text lines and deletion returns smoothly to a complete line', () => {
  const scroll = createMemoEditorScroll();
  const short = lines.slice(0, 6);
  scroll.measure({ lines: short, lineHeight: 42 }, 29, true);
  scroll.advance(15);
  assert.equal(scroll.snapshot().offset, 168);
  assert.equal(scroll.snapshot().next, false);
  scroll.measure({ lines: short.slice(0, 5), lineHeight: 42 }, 24, true);
  scroll.advance(7.5);
  assert.equal(scroll.snapshot().offset, 147, 'deletion keeps the original smooth transition');
  scroll.advance(7.5);
  assert.equal(scroll.snapshot().offset, 126, 'settled offset is a whole ruled line');
  scroll.measure({ lines: short.slice(0, 1), lineHeight: 42 }, 0, true);
  scroll.advance(15);
  assert.equal(scroll.snapshot().offset, 0);
  assert.equal(scroll.snapshot().next, false, 'empty ruled footer does not create editor lines');
});
