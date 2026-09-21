import test from 'node:test';
import assert from 'node:assert/strict';
import { indexLayout } from '../src/animation.js';
import { poseStorageThumbnail } from '../src/storage-thumbnail.js';

function pane(name, flags = 1) {
  return {
    name,
    flags,
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1],
    size: [10, 10],
    children: [],
  };
}

function fixture() {
  const root = pane('root');
  root.children = [
    pane('N_base_00'), pane('P_BG_00', 0), pane('english', 0), pane('french'),
    pane('shared'), pane('other'), pane('unmapped'),
  ];
  return {
    shortId: 'HADE',
    icon: {
      root,
      materials: [{ name: 'material', colors: [[0, 0, 0, 0]] }],
      groups: { Rso0: ['N_base_00'], ENG: ['english', 'shared'], FRA: ['french', 'shared'] },
      animations: {},
    },
  };
}

function motion(end, loop = false) {
  return {
    frames: 10,
    loop,
    targets: [{
      name: 'N_base_00',
      type: 0,
      tracks: [{
        kind: 'RLPA',
        target: 0,
        keys: [{ frame: 0, value: 0 }, { frame: 10, value: end }],
      }],
    }],
  };
}

const visible = (layout, name) => Boolean(indexLayout(layout).panes.get(name).flags & 1);
const x = (layout) => indexLayout(layout).panes.get('N_base_00').translation[0];

test('Data Management leaves script-driven icons static and retains their authored visibility', () => {
  const channel = fixture();
  channel.icon.animations = { icon_Start: motion(100), icon_Rso0: motion(200, true) };
  const first = poseStorageThumbnail(channel, 0);
  const later = poseStorageThumbnail(channel, 500);
  assert.deepEqual(later, first);
  assert.equal(x(later), 0);
  assert.equal(visible(later, 'N_base_00'), true);
  assert.equal(visible(later, 'P_BG_00'), false);
});

test('native thumbnail binding prefers icon, falls back to icon_Whole, and uses source loop timing', () => {
  const channel = fixture();
  channel.icon.animations = {
    icon: motion(10, true), icon_Whole: motion(100), icon_Start: motion(1000),
  };
  assert.equal(x(poseStorageThumbnail(channel, 5)), 5);
  assert.equal(x(poseStorageThumbnail(channel, 15)), 5);
  const wholeOnly = { icon: { ...channel.icon, animations: { icon_Whole: motion(100) } } };
  assert.equal(x(poseStorageThumbnail(wholeOnly, 5)), 50);
  assert.equal(x(poseStorageThumbnail(wholeOnly, 20)), x(poseStorageThumbnail(wholeOnly, 9)));
});

test('selected language restores shared group panes after other groups are hidden', () => {
  const channel = fixture();
  channel.icon.groups.Other = ['other'];
  const english = poseStorageThumbnail(channel, 0);
  assert.equal(visible(english, 'english'), true);
  assert.equal(visible(english, 'french'), false);
  assert.equal(visible(english, 'shared'), true);
  assert.equal(visible(english, 'other'), false);
  assert.equal(visible(english, 'unmapped'), true);
  const french = poseStorageThumbnail(channel, 0, { language: 'FRA' });
  assert.equal(visible(french, 'english'), false);
  assert.equal(visible(french, 'french'), true);
  assert.equal(visible(french, 'shared'), true);
});

test('missing language uses the first USA fallback and CHT uses the native ENG mapping', () => {
  const channel = fixture();
  assert.equal(visible(poseStorageThumbnail(channel, 0, { language: 'CHT' }), 'english'), true);
  assert.equal(visible(poseStorageThumbnail(channel, 0, { language: 'GER' }), 'english'), true);
  const frenchOnly = { icon: { ...channel.icon, groups: { FRA: ['french'], SPA: ['other'] } } };
  const fallback = poseStorageThumbnail(frenchOnly, 0, { language: 'JPN' });
  assert.equal(visible(fallback, 'french'), true);
  assert.equal(visible(fallback, 'other'), false);
});

test('language selection precedes native animation visibility and does not mutate source or cached poses', () => {
  const channel = fixture();
  channel.icon.animations.icon = {
    frames: 1,
    loop: false,
    targets: [{
      name: 'english', type: 0,
      tracks: [{ kind: 'RLVI', target: 0, keys: [{ frame: 0, value: 0 }] }],
    }],
  };
  const original = structuredClone(channel);
  const first = poseStorageThumbnail(channel, 0);
  assert.equal(visible(first, 'english'), false);
  first.root.flags = 0;
  first.materials[0].colors[0][0] = 255;
  const second = poseStorageThumbnail(channel, 0);
  assert.equal(second.root.flags, 1);
  assert.equal(second.materials[0].colors[0][0], 0);
  assert.deepEqual(channel, original);
  assert.equal(poseStorageThumbnail({}, 0), null);
});
