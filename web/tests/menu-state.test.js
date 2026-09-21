import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuState, DEFAULT_TIMING } from '../src/menu-state.js';

const channels = [
  { id: 'disc' },
  { id: 'mii' },
  null,
  { id: 'photo' },
  ...Array(8).fill(null),
  { id: 'page-two' },
];

test('SD Menu preserves the channel page through HOME and return', () => {
  const menu = createMenuState({ channels, timing: { settings: 0 } });
  menu.changePage(1);
  menu.advance(DEFAULT_TIMING.page);
  assert.equal(menu.openSD(), true);
  assert.equal(menu.getState().screen, 'sd');
  assert.equal(menu.selectChannel(12), false);
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter);
  menu.closeHome();
  menu.advance(DEFAULT_TIMING.homeExit);
  assert.equal(menu.getState().screen, 'sd');
  assert.equal(menu.back(), true);
  assert.equal(menu.getState().page, 1);
  assert.equal(menu.getState().screen, 'grid');
});

test('channel selection locks input until the complete source animation duration', () => {
  const menu = createMenuState({ channels });
  assert.equal(menu.selectChannel(2), false);
  assert.equal(menu.selectChannel(12), false);
  assert.equal(menu.selectChannel(1), true);
  assert.equal(menu.getState().screen, 'preview');
  assert.equal(menu.getState().transition.from.screen, 'grid');
  assert.equal(menu.back(), false);
  assert.equal(menu.changePreview(1), false);
  menu.advance(DEFAULT_TIMING.select / 2);
  assert.equal(menu.getState().transition.progress, 0.5);
  menu.advance(DEFAULT_TIMING.select / 2);
  assert.equal(menu.getState().locked, false);
  assert.equal(menu.back(), true);
  menu.advance(DEFAULT_TIMING.back);
  assert.equal(menu.getState().screen, 'grid');
  assert.equal(menu.getState().selectedIndex, null);
});

test('four pages have bounded navigation and cannot skip during a transition', () => {
  const menu = createMenuState({ channels });
  assert.equal(menu.changePage(-1), false);
  assert.equal(menu.changePage(2), false);
  for (let page = 1; page < 4; page += 1) {
    assert.equal(menu.changePage(1), true);
    assert.equal(menu.changePage(1), false);
    menu.advance(DEFAULT_TIMING.page);
    assert.equal(menu.getState().page, page);
  }
  assert.equal(menu.changePage(1), false);
  assert.equal(menu.selectChannel(0), false);
});

test('preview navigation skips empty slots and returns to the selected channel page', () => {
  const menu = createMenuState({ channels, timing: { select: 0, preview: 0, back: 0 } });
  menu.selectChannel(1);
  assert.equal(menu.previewNeighbor(1), 3);
  assert.equal(menu.changePreview(1), true);
  assert.equal(menu.getState().selectedIndex, 3);
  menu.changePreview(1);
  assert.equal(menu.getState().selectedIndex, 12);
  assert.equal(menu.previewNeighbor(1), 0);
  menu.back();
  assert.equal(menu.getState().page, 1);
});

test('preview arrows wrap across all slots while retaining their input direction', () => {
  const menu = createMenuState({ channels, timing: { select: 0 } });
  menu.selectChannel(0);
  assert.equal(menu.changePreview(-1), true);
  assert.equal(menu.getState().selectedIndex, 12);
  assert.equal(menu.getState().transition.direction, -1);
  menu.advance(DEFAULT_TIMING.preview);
  assert.equal(menu.changePreview(1), true);
  assert.equal(menu.getState().selectedIndex, 0);
  assert.equal(menu.getState().transition.direction, 1);
  const single = createMenuState({ channels: [{ id: 'disc' }], timing: { select: 0 } });
  single.selectChannel(0);
  assert.equal(single.previewNeighbor(1), null);
});

test('HOME overlay preserves the underlying screen and blocks its input', () => {
  const menu = createMenuState({ channels });
  menu.openSettings();
  menu.advance(DEFAULT_TIMING.settings);
  menu.openHome();
  assert.equal(menu.back(), false);
  menu.advance(DEFAULT_TIMING.homeEnter);
  assert.equal(menu.getState().screen, 'settings');
  assert.equal(menu.getState().overlay, 'home');
  assert.equal(menu.openSettings(), false);
  assert.equal(menu.changePage(1), false);
  menu.back();
  menu.advance(DEFAULT_TIMING.homeExit);
  assert.equal(menu.getState().screen, 'settings');
  assert.equal(menu.getState().overlay, null);
  menu.back();
  menu.advance(DEFAULT_TIMING.settings);
  assert.equal(menu.getState().screen, 'grid');
});

test('HOME remains locked for the separate source entrance and exit durations', () => {
  const menu = createMenuState({ channels });
  menu.openHome();
  assert.equal(menu.getState().transition.duration, (21 * 1000) / 60);
  menu.advance((20 * 1000) / 60);
  assert.equal(menu.closeHome(), false);
  menu.advance(DEFAULT_TIMING.homeEnter - (20 * 1000) / 60);
  assert.equal(menu.closeHome(), true);
  assert.equal(menu.getState().transition.duration, (39 * 1000) / 60);
  assert.equal(menu.getState().transition.from.overlay, 'home');
  menu.advance((19 * 1000) / 60);
  assert.equal(menu.openHome(), false);
  menu.advance((19 * 1000) / 60);
  assert.equal(menu.getState().locked, true);
  assert.equal(menu.getState().transition.from.overlay, 'home');
  menu.advance(DEFAULT_TIMING.homeExit - (38 * 1000) / 60);
  assert.equal(menu.getState().locked, false);
  assert.equal(menu.getState().overlay, null);
});

test('Wii Menu returns from a preview to the initial page through HOME exit', () => {
  const menu = createMenuState({ channels });
  assert.equal(menu.returnToMenu(), false);
  menu.changePage(1);
  menu.advance(DEFAULT_TIMING.page);
  menu.selectChannel(12);
  menu.advance(DEFAULT_TIMING.select);
  menu.openHome();
  assert.equal(menu.returnToMenu(), false);
  menu.advance(DEFAULT_TIMING.homeEnter);
  assert.equal(menu.returnToMenu(), true);
  const leaving = menu.getState();
  assert.equal(leaving.screen, 'grid');
  assert.equal(leaving.page, 0);
  assert.equal(leaving.selectedIndex, null);
  assert.equal(leaving.overlay, null);
  assert.equal(leaving.transition.kind, 'home');
  assert.equal(leaving.transition.from.screen, 'preview');
  assert.equal(leaving.transition.from.selectedIndex, 12);
  assert.equal(leaving.transition.from.page, 1);
  assert.equal(leaving.transition.from.overlay, 'home');
  assert.equal(menu.openHome(), false);
  menu.advance(DEFAULT_TIMING.homeExit);
  assert.equal(menu.getState().locked, false);
  assert.equal(menu.getState().transition, null);
  assert.equal(menu.selectChannel(1), true);
});

test('snapshots are stable and subscriptions can be removed', () => {
  const menu = createMenuState({ channels });
  let notifications = 0;
  const remove = menu.subscribe(() => notifications++);
  const initial = menu.getState();
  menu.changePage(1);
  assert.equal(initial.page, 0);
  assert.equal(notifications, 2);
  assert.throws(() => {
    menu.getState().channels[0].id = 'modified';
  }, TypeError);
  remove();
  menu.advance(10000);
  assert.equal(notifications, 2);
  assert.equal(menu.getState().transition, null);
  assert.throws(() => menu.advance(NaN), RangeError);
  assert.throws(() => createMenuState({ timing: { page: -1 } }), RangeError);
});

test('completed HOME controller commits without replaying a second exit', () => {
  const menu = createMenuState({ channels, timing: { select: 0 } });
  menu.selectChannel(1);
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter);
  assert.equal(menu.finishHome(), true);
  assert.equal(menu.getState().transition, null);
  assert.equal(menu.getState().screen, 'preview');
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter);
  assert.equal(menu.finishHome({ returnToMenu: true }), true);
  assert.equal(menu.getState().screen, 'grid');
  assert.equal(menu.getState().page, 0);
  assert.equal(menu.getState().selectedIndex, null);
  assert.equal(menu.getState().transition, null);
  assert.equal(menu.finishHome(), false);
});
