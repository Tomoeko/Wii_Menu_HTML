import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createFooterController } from '../src/footer-controller.js';
import { createMenuState, DEFAULT_TIMING } from '../src/menu-state.js';
import { routeFooterHover, shouldPlayHoverSound } from '../src/hover-routing.js';

const read = (name) => {
  const path = new URL(name, import.meta.url);
  return existsSync(path) ? JSON.parse(readFileSync(path)) : null;
};
const source = read('../public/assets/layouts/cmnBtn/my_IplTop_e.json');
const balloon = read('../public/assets/layouts/balloon/my_IplTopBalloon_a.json');
const sourceTest = {
  skip: (!source || !balloon) && 'Prepare a local menu WAD to test its original resources.',
};

function fixture() {
  const sounds = [];
  const footer = createFooterController(source, balloon, (value) => value.length * 10, {
    onSound: (sound) => sounds.push(sound),
  });
  const menu = createMenuState({ channels: [{ id: 'disc' }, { id: 'mii' }, { id: 'photo' }] });
  return { sounds, footer, menu };
}

test('Health and Safety retains its hit area without playing a hover cue', () => {
  assert.equal(shouldPlayHoverSound('health-continue', { startupComplete: false }), false);
  assert.equal(shouldPlayHoverSound('health-continue', { startupComplete: true }), true);
});

test('preview page transitions never reacquire the hidden footer during repeated frame routing', sourceTest, () => {
  const { sounds, footer, menu } = fixture();
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  assert.equal(routeFooterHover(footer, 'next', menu.getState()), false);
  assert.equal(menu.changePreview(1), true);
  for (let frame = 0; frame < 120; frame++) {
    const state = menu.getState();
    // The host retires footer focus during locked transitions, then performs
    // the retained arrow hit test again after drawing the current frame.
    if (state.locked && state.transition?.kind !== 'page') footer.clear();
    routeFooterHover(footer, 'next', state);
    menu.advance(1000 / 60);
    footer.advance(1);
  }
  assert.equal(menu.getState().screen, 'preview');
  assert.equal(menu.getState().locked, false);
  assert.equal(footer.hovered, null);
  assert.deepEqual(sounds, []);
});

test('grid page focus stays owned and sounds once across repeated frames and a click', sourceTest, () => {
  const { sounds, footer, menu } = fixture();
  routeFooterHover(footer, 'next', menu.getState());
  menu.changePage(1);
  for (let frame = 0; frame < 120; frame++) {
    routeFooterHover(footer, 'next', menu.getState());
    menu.advance(1000 / 60);
    footer.advance(1);
  }
  assert.equal(footer.hovered, 'next');
  assert.deepEqual(sounds, ['buttonHover']);
  routeFooterHover(footer, null, menu.getState());
  routeFooterHover(footer, 'next', menu.getState());
  assert.deepEqual(sounds, ['buttonHover', 'buttonHover']);
});

test('locked scene handoffs cannot reenter footer focus after the host clears it', sourceTest, () => {
  const { sounds, footer, menu } = fixture();
  routeFooterHover(footer, 'board', menu.getState());
  menu.openBoard();
  for (let frame = 0; frame < 30; frame++) {
    footer.clear();
    routeFooterHover(footer, 'board', menu.getState(), {}, true);
    routeFooterHover(footer, 'scene-back', menu.getState(), { transition: 'enter' });
  }
  assert.deepEqual(sounds, ['buttonHover']);
  assert.equal(footer.hovered, null);
});

test('top-level Board footer receives its mapped controls, while children keep ownership', sourceTest, () => {
  const { sounds, footer } = fixture();
  const state = { screen: 'board', locked: false, overlay: null };
  for (let frame = 0; frame < 60; frame++) {
    assert.equal(routeFooterHover(footer, 'scene-back', state), true);
  }
  assert.equal(footer.hovered, 'board-back');
  assert.deepEqual(sounds, ['buttonHover']);
  for (const scene of [{ boardChild: 'create' }, { readingMemo: true }, { draggingMemo: true }]) {
    assert.equal(routeFooterHover(footer, 'scene-back', state, scene), false);
    assert.equal(footer.hovered, null);
  }
  for (const screen of ['preview', 'settings', 'sd']) {
    routeFooterHover(footer, 'next', { screen, locked: false });
  }
  assert.deepEqual(sounds, ['buttonHover']);
});
