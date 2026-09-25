import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMenuState, DEFAULT_TIMING } from '../src/menu-state.js';
import { poseLayout, indexLayout } from '../src/animation.js';
import {
  previewPresentation,
  previewChangeClip,
  previewStartButtonClip,
  activatePreviewReturn,
  createPreviewButtonHover,
  previewArrowAvailability,
  posePreviewArrows,
} from '../src/preview-transition.js';
import { commonArrowDefinitions, createArrowInteraction } from '../src/arrow-interaction.js';
import { createDisplay } from '../src/display.js';
import { Renderer } from '../src/renderer.js';
import { createFooterController } from '../src/footer-controller.js';
import { menuFooterState } from '../src/menu-footer-state.js';

const sourcePath = new URL('../public/assets/layouts/chanTtl/my_ChTop_a.json', import.meta.url);
const source = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath)) : null;
const arrowSourcePath = new URL('../public/assets/layouts/cmnBtn/my_IplTop_e.json', import.meta.url);
const arrowSource = fs.existsSync(arrowSourcePath)
  ? JSON.parse(fs.readFileSync(arrowSourcePath)) : null;
const balloonSourcePath = new URL(
  '../public/assets/layouts/balloon/my_IplTopBalloon_a.json', import.meta.url,
);
const balloonSource = fs.existsSync(balloonSourcePath)
  ? JSON.parse(fs.readFileSync(balloonSourcePath)) : null;
const sourceTest = {
  skip: !source && 'Prepare a local menu WAD to test its original resources.',
};
const arrowSourceTest = {
  skip: (!arrowSource || !balloonSource) &&
    'Prepare a local menu WAD to test its original arrows.',
};

test('the preview Wii Menu button owns both its push cue and reverse zoom cue', () => {
  const menu = createMenuState({ channels: [{ id: 'disc' }] });
  const sounds = [];
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  assert.equal(
    activatePreviewReturn(menu, (name) => sounds.push(name)),
    true,
  );
  assert.deepEqual(sounds, ['WIPL_SE_BT_PUSH', 'WIPL_SE_CH_UNSELECT']);
  assert.equal(
    activatePreviewReturn(menu, (name) => sounds.push(name)),
    false,
  );
  assert.equal(sounds.length, 2, 'a rejected repeated press adds no audio');
});

test('preloaded preview swap follows the two original ten-frame controllers', sourceTest, () => {
  assert.equal(source.animations.my_ChTop_a_ChangeIn.frames - 1, 10);
  assert.equal(source.animations.my_ChTop_a_ChangeOut.frames - 1, 10);
  assert.equal(DEFAULT_TIMING.preview, (20 * 1000) / 60);
  const menu = createMenuState({ channels: [{ id: 'mii' }, { id: 'photo' }] });
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  menu.changePreview(1);
  assert.deepEqual(previewPresentation(menu.getState()), { index: 0, phase: 'in', frame: 0 });
  menu.advance(DEFAULT_TIMING.preview / 2 - 1);
  assert.equal(previewPresentation(menu.getState()).index, 0);
  menu.advance(1);
  assert.deepEqual(previewPresentation(menu.getState()), { index: 1, phase: 'out', frame: 0 });
  assert.equal(menu.changePreview(-1), false);
  menu.advance(DEFAULT_TIMING.preview / 2);
  assert.deepEqual(previewPresentation(menu.getState()), { index: 1, phase: 'normal', frame: 0 });
  assert.equal(menu.getState().locked, false);
});

test('Change binds only its original pane/material, preserving unrelated authored buttons', sourceTest, () => {
  for (const phase of ['in', 'out']) {
    const clip = previewChangeClip(source, { phase, frame: 5 });
    assert.ok(clip.animation.targets.length > 0);
    assert.ok(clip.animation.targets.every((target) => target.name === 'Change'));
    const posed = poseLayout(source, [clip]),
      before = indexLayout(source),
      after = indexLayout(posed);
    for (const [name, pane] of before.panes) assert.deepEqual(after.panes.get(name), pane);
    for (const [name, material] of before.materials)
      if (name !== 'Change') assert.deepEqual(after.materials.get(name), material);
    // The supplied native Change alpha is zero. Do not invent a fade envelope.
    assert.equal(after.materials.get('Change').colors[1][3], 0);
  }
});

test('Start changes enabled appearance at the banner swap only when entering/leaving Disc', sourceTest, () => {
  const channels = [{ id: 'disc' }, { id: 'mii' }, { id: 'photo' }];
  const state = { channels, selectedIndex: 1, transition: { from: { selectedIndex: 0 } } };
  assert.equal(previewStartButtonClip(source, state, { index: 0, phase: 'in', frame: 7 }).frame, 0);
  const enabled = previewStartButtonClip(source, state, { index: 1, phase: 'out', frame: 3 });
  assert.equal(enabled.animation, source.animations.my_ChTop_a_OnBtn);
  assert.equal(enabled.frame, 3);
  const disabled = previewStartButtonClip(
    source,
    { channels, selectedIndex: 0, transition: { from: { selectedIndex: 1 } } },
    { index: 0, phase: 'out', frame: 3 },
  );
  assert.equal(disabled.animation, source.animations.my_ChTop_a_OffBtn);
  assert.equal(disabled.frame, 3);
  assert.equal(
    previewStartButtonClip(
      source,
      { channels, selectedIndex: 2, transition: { from: { selectedIndex: 1 } } },
      { index: 2, phase: 'out', frame: 3 },
    ).frame,
    10,
  );
});

test('preview button focus completes a source-timed departure and reverses smoothly', () => {
  const focus = createPreviewButtonHover();
  assert.deepEqual(focus.clip('back'), {
    animation: 'my_ChTop_a_FocusBtnA_off',
    frame: 10,
  });
  focus.hover('back');
  focus.advance(3);
  assert.deepEqual(focus.clip('back'), {
    animation: 'my_ChTop_a_FocusBtn_on',
    frame: 3,
  });
  focus.hover(null);
  const leaving = focus.clip('back');
  assert.equal(leaving.animation, 'my_ChTop_a_FocusBtnA_off');
  assert.ok(leaving.frame > 0 && leaving.frame < 8);
  focus.advance(10);
  assert.deepEqual(focus.clip('back'), {
    animation: 'my_ChTop_a_FocusBtnA_off',
    frame: 10,
  });
  focus.hover('start');
  focus.advance(10);
  focus.hover(null);
  assert.equal(focus.clip('start').frame, 0);
  focus.advance(3);
  focus.hover('start');
  assert.equal(focus.clip('start').animation, 'my_ChTop_a_FocusBtn_on');
  assert.ok(focus.clip('start').frame < 5, 're-entry reverses the active rollout');
});

test('the clicked arrow uses the independent native thirty-frame select flash', () => {
  const source = { animations: { my_IplTop_e: {} } };
  const arrows = createArrowInteraction(commonArrowDefinitions(source));
  arrows.press('prev');
  arrows.advance(10);
  assert.deepEqual(
    arrows.clips().find((clip) => clip.group === 'G_ArwL_Ac'),
    {
      animation: source.animations.my_IplTop_e,
      frame: 10710,
      group: 'G_ArwL_Ac',
      loop: false,
    },
  );
  arrows.advance(20);
  assert.equal(arrows.clips().find((clip) => clip.group === 'G_ArwL_Ac').frame, 10730);
  arrows.advance(1);
  assert.equal(
    arrows.clips().some((clip) => clip.group === 'G_ArwL_Ac'),
    false,
  );
});

test('shared preview arrows retain pointer focus through banner swaps and animate physical-key presses', () => {
  const source = { animations: { my_IplTop_e: {} } };
  const arrows = createArrowInteraction(commonArrowDefinitions(source));
  const menu = createMenuState({ channels: [{ id: 'mii' }, { id: 'photo' }] });
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  menu.subscribe((state) => {
    if (state.transition?.kind === 'preview' && state.transition.elapsed === 0)
      arrows.press(state.transition.direction < 0 ? 'prev' : 'next');
  });
  arrows.hover('next');
  arrows.advance(15);
  assert.equal(menu.changePreview(1), true);
  for (let frame = 0; frame < 60; frame++) {
    arrows.hover('next');
    arrows.advance(1);
    menu.advance(1000 / 60);
    assert.equal(arrows.clips().find((clip) => clip.group === 'G_ArwR_Focus').frame, 10615);
  }
  assert.equal(menu.getState().locked, false);
  arrows.hover(null);
  arrows.advance(7);
  assert.equal(arrows.clips().find((clip) => clip.group === 'G_ArwR_Focus').frame, 10807);
  arrows.advance(8);
  assert.equal(arrows.clips().find((clip) => clip.group === 'G_ArwR_Focus').frame, 10815);
  // Keyboard navigation selects a direction without inventing pointer focus.
  assert.equal(menu.changePreview(-1), true);
  arrows.advance(3);
  assert.equal(arrows.clips().find((clip) => clip.group === 'G_ArwL_Ac').frame, 10703);
  assert.equal(arrows.hovered, null);
});

test('preview return arrows keep Home size and leave beyond the channel frame in both aspects',
  arrowSourceTest, () => {
    for (const aspect of ['4:3', '16:9']) {
      const display = createDisplay(aspect);
      const renderRects = (layout, exclude = new Set()) => {
        const renderer = Object.create(Renderer.prototype);
        renderer.display = display;
        renderer.bounds = new Map();
        renderer.quad = () => {};
        renderer.window = () => {};
        renderer.draw(layout, { exclude });
        return {
          left: renderer.rect('B_ArwL'),
          right: renderer.rect('B_ArwR'),
          leftIcon: renderer.rect('ArwL'),
          rightIcon: renderer.rect('ArwR'),
        };
      };
      const rectangles = (phase, frame) => {
        const { layout, exclude } = posePreviewArrows(arrowSource, {
          phase, frame, loopFrame: 0,
        });
        return renderRects(layout, exclude);
      };
      const footer = createFooterController(arrowSource, balloonSource, () => 0);
      footer.setArrows({ prev: true, next: true });
      footer.advance(20);
      const homeSize = renderRects(footer.pose());
      const entered = rectangles('enter', 10);
      const start = rectangles('exit', 0);
      const middle = rectangles('exit', 5);
      const end = rectangles('exit', 10);
      for (const pose of [start, middle, end]) {
        for (const side of ['left', 'right', 'leftIcon', 'rightIcon']) {
          assert.ok(Math.abs(pose[side].w - homeSize[side].w) < 0.001,
            `${aspect} ${side} width`);
          assert.ok(Math.abs(pose[side].h - homeSize[side].h) < 0.001,
            `${aspect} ${side} height`);
        }
      }
      assert.ok(Math.abs(start.left.x - entered.left.x) < 0.001);
      assert.ok(Math.abs(start.right.x - entered.right.x) < 0.001);
      assert.ok(middle.left.x + middle.left.w < 0, `${aspect} left passes the black frame`);
      assert.ok(middle.right.x > display.width, `${aspect} right passes the black frame`);
      assert.ok(end.left.x < middle.left.x && end.right.x > middle.right.x,
        `${aspect} both arrows continue to their source exit endpoints`);
    }
  });

test('preview return retains cross-page arrow availability after screen changes to grid',
  arrowSourceTest, () => {
    const channels = Array(48).fill(null);
    channels[0] = { id: 'first' };
    channels[25] = { id: 'other-page' };
    const menu = createMenuState({ channels });
    for (let page = 0; page < 2; page++) {
      assert.equal(menu.changePage(1), true);
      menu.advance(DEFAULT_TIMING.page);
    }
    assert.equal(menu.selectChannel(25), true);
    menu.advance(DEFAULT_TIMING.select);
    assert.equal(menu.back(), true);
    const state = menu.getState();
    assert.equal(state.screen, 'grid');
    assert.equal(menu.previewNeighbor(1), null);
    assert.deepEqual(menuFooterState(state).arrows, { prev: false, next: false },
      'zoomed grid arrows remain hidden beneath the preview exit overlay');
    const available = previewArrowAvailability(state.channels, state.transition.from.selectedIndex);
    assert.deepEqual(available, { prev: true, next: true });
    const visible = posePreviewArrows(arrowSource, { phase: 'exit', frame: 0, available });
    assert.equal(visible.exclude.has('N_ArwL'), false);
    assert.equal(visible.exclude.has('N_ArwR'), false);

    const only = previewArrowAvailability([{ id: 'single' }], 0);
    assert.deepEqual(only, { prev: false, next: false });
    const hidden = posePreviewArrows(arrowSource, { phase: 'exit', frame: 0, available: only });
    assert.equal(hidden.exclude.has('N_ArwL'), true);
    assert.equal(hidden.exclude.has('N_ArwR'), true);
  });
