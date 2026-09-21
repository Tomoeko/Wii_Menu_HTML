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
} from '../src/preview-transition.js';
import { commonArrowDefinitions, createArrowInteraction } from '../src/arrow-interaction.js';

const sourcePath = new URL('../public/assets/layouts/chanTtl/my_ChTop_a.json', import.meta.url);
const source = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath)) : null;
const sourceTest = {
  skip: !source && 'Prepare a local menu WAD to test its original resources.',
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
