import test from 'node:test';
import assert from 'node:assert/strict';
import { menuFooterState } from '../src/menu-footer-state.js';

test('channel zoom retains SD and restores available arrows only after zoom completion', () => {
  for (const page of [0, 1, 3]) {
    for (const kind of ['select', 'back']) {
      const screen = kind === 'select' ? 'preview' : 'grid';
      const state = menuFooterState({ screen, page, transition: { kind } });
      assert.deepEqual(state.arrows, { prev: false, next: false });
      assert.equal(state.sdVisible, true);
    }
    assert.deepEqual(menuFooterState({ screen: 'grid', page }).arrows, {
      prev: page > 0,
      next: page < 3,
    });
  }
});

test('Board return starts SD and menu arrow reappearance at its grid animation boundary', () => {
  const menu = { screen: 'board', page: 1 };
  for (const frame of [0, 1, 10, 19.999]) {
    const state = menuFooterState(menu, { transition: 'exit', frame });
    assert.equal(state.sdVisible, false);
    assert.deepEqual(state.arrows, { prev: false, next: false });
    assert.equal(state.useGridArrowClips, false);
  }
  for (const frame of [20, 21, 30, 39]) {
    const state = menuFooterState(menu, { transition: 'exit', frame });
    assert.equal(state.sdVisible, true);
    assert.deepEqual(state.arrows, { prev: true, next: true });
    assert.equal(state.useGridArrowClips, true);
  }
});

test('Board entry retains the departing menu arrows during their full disappearance', () => {
  const menu = { screen: 'board', page: 0 };
  assert.equal(menuFooterState(menu, { transition: 'enter', frame: 0 }).useGridArrowClips, true);
  assert.equal(menuFooterState(menu, { transition: 'enter', frame: 9 }).useGridArrowClips, true);
  assert.equal(menuFooterState(menu, { transition: 'enter', frame: 10 }).useGridArrowClips, false);
});
