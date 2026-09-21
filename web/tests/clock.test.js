import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/clock.js';
import { indexLayout } from '../src/animation.js';

function fixture() {
  const names = [
    ...Array.from({ length: 10 }, (_, i) => `Num${i}`),
    'AM',
    'PM',
    'Clock0',
    'Clock1',
    'Clock2',
    'Clock3',
    'ClockTen',
    'AM_PM',
    'AM_PM_R',
    'T_WiiMenu',
  ];
  const pane = (name) => ({ name, flags: 1, alpha: 255, children: [] });
  const controls = names.slice(12).map((name, i) => ({ ...pane(name), material: i + 12 }));
  const clock = { ...pane('N_Clock'), children: controls };
  const menu = { ...pane('N_WiiMenu'), children: [clock] };
  const source = {
    root: {
      ...pane('RootPane'),
      children: [...names.slice(0, 12).map((name, i) => ({ ...pane(name), material: i })), menu],
    },
    materials: names.map((name, i) => ({ name, textureMaps: [{ texture: i }] })),
    animations: {},
  };
  source.animations.my_Clock_a_Change = {
    frames: 26,
    targets: [
      {
        name: 'N_Clock',
        type: 0,
        tracks: [
          {
            kind: 'RLVC',
            target: 16,
            curveType: 2,
            keys: [
              { frame: 9, value: 0, slope: 0 },
              { frame: 25, value: 255, slope: 0 },
            ],
          },
        ],
      },
    ],
  };
  return source;
}
function texture(layout, name) {
  return layout.materials[indexLayout(layout).panes.get(name).material].textureMaps[0].texture;
}

test('USA midnight uses 12, minute textures, and right AM without modifying the resource', () => {
  const source = fixture(),
    snapshot = structuredClone(source);
  const clock = createClock(source, { showIntro: false });
  const layout = clock.pose(new Date(2026, 0, 1, 0, 5));
  assert.equal(texture(layout, 'Clock3'), 1);
  assert.equal(texture(layout, 'Clock2'), 2);
  assert.equal(texture(layout, 'Clock1'), 0);
  assert.equal(texture(layout, 'Clock0'), 5);
  assert.equal(texture(layout, 'AM_PM_R'), 10);
  const panes = indexLayout(layout).panes;
  assert.equal(panes.get('AM_PM').flags & 1, 0);
  assert.equal(panes.get('AM_PM_R').flags & 1, 1);
  assert.equal(panes.get('N_Clock').alpha, 255);
  assert.equal(layout.root.name, 'N_WiiMenu');
  assert.deepEqual(source, snapshot);
});

test('single hour hides leading digit and noon selects PM', () => {
  const clock = createClock(fixture(), { showIntro: false });
  let layout = clock.pose(new Date(2026, 0, 1, 9, 0));
  assert.equal(indexLayout(layout).panes.get('Clock3').flags & 1, 0);
  layout = clock.pose(new Date(2026, 0, 1, 12, 0));
  assert.equal(texture(layout, 'AM_PM_R'), 11);
});

test('intro waits three seconds and the next odd second before its source fade', () => {
  const clock = createClock(fixture());
  assert.equal(
    indexLayout(clock.pose(new Date(2026, 0, 1, 10, 0, 0), 180)).panes.get('N_Clock').alpha,
    0,
  );
  clock.pose(new Date(2026, 0, 1, 10, 0, 1), 240);
  assert.equal(
    indexLayout(clock.pose(new Date(2026, 0, 1, 10, 0, 1), 266)).panes.get('N_Clock').alpha,
    255,
  );
});
