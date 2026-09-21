import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createChannelDrag } from '../src/channel-drag.js';

const load = (name) => {
  const path = new URL(`../public/assets/layouts/chanSel/${name}.json`, import.meta.url);
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : null;
};
const resources = {
  mask: load('my_TVMask_a'),
  shade: load('my_TVShade_a'),
  drop: load('my_TVApear_a'),
};
const sourceTest = {
  skip: !Object.values(resources).every(Boolean) && 'Prepare a local menu WAD to test its original resources.',
};
const slots = Array.from({ length: 48 }, (_, i) =>
  i === 0 ? { id: 'disc' } : i === 1 ? { id: 'mii' } : null,
);

test('grab waits for authored entrance, drops into empty slot, then completes both drop phases', sourceTest, () => {
  const drag = createChannelDrag(resources);
  assert.equal(drag.start(0, slots, { x: 0, y: 0 }), false);
  assert.equal(drag.start(1, slots, { x: 0, y: 0 }), true);
  drag.point({ x: 100, y: 20 }, 3);
  assert.equal(drag.release(slots), null);
  assert.equal(drag.advance(11, slots).sound, 'drop');
  assert.equal(drag.getState().phase, 'drop-in');
  assert.deepEqual(drag.advance(16, slots).move, [1, 3]);
  assert.ok(drag.dropPose());
  drag.advance(11, slots);
  assert.equal(drag.getState(), null);
});

test('edge hover waits15frames, scrolling does not accumulate; invalid release never moves a title', sourceTest, () => {
  const drag = createChannelDrag(resources);
  drag.start(1, slots, { x: 0, y: 0 });
  drag.advance(11, slots);
  drag.point({ x: 800, y: 100 }, null, 1);
  assert.equal(drag.advance(14, slots).page, undefined);
  assert.equal(drag.advance(100, slots, { scrolling: true }).page, undefined);
  assert.equal(drag.advance(1, slots).page, 1);
  assert.equal(drag.release(slots), 'invalidDrop');
  assert.equal(drag.advance(30, slots).move, undefined);
  assert.ok(drag.getState());
  drag.advance(1, slots);
  assert.equal(drag.getState(), null);
});

test('releasing during a page scroll waits before beginning the destination drop', sourceTest, () => {
  const drag = createChannelDrag(resources);
  drag.start(1, slots, { x: 0, y: 0 });
  drag.advance(10, slots);
  drag.point({ x: 20, y: 20 }, 15);
  assert.equal(drag.release(slots, { scrolling: true }), null);
  assert.deepEqual(drag.advance(20, slots, { scrolling: true }), {});
  assert.equal(drag.getState().phase, 'drag');
  assert.equal(drag.advance(1, slots).sound, 'drop');
  assert.deepEqual(drag.advance(15, slots).move, [1, 15]);
});

test('released shade remains at its Lost endpoint when the placed channel starts drop-out', sourceTest, () => {
  const drag = createChannelDrag(resources);
  drag.start(1, slots, { x: 100, y: 100 });
  drag.advance(10, slots);
  drag.point({ x: 150, y: 100 }, 3);
  drag.release(slots);
  drag.advance(14, slots);
  const endedShade = drag.shadePose();
  drag.advance(1, slots);
  assert.equal(drag.getState().phase, 'drop-out');
  assert.deepEqual(drag.shadePose(), endedShade);
  drag.advance(9, slots);
  assert.deepEqual(drag.shadePose(), endedShade);
});

test('grab appearance never restarts when ownership changes to dragging or page scrolling', sourceTest, () => {
  const drag = createChannelDrag(resources);
  drag.start(1, slots, { x: 100, y: 100 });
  drag.advance(9, slots);
  const before = drag.getState().appearanceFrame;
  drag.advance(1, slots);
  assert.equal(drag.getState().phase, 'drag');
  assert.ok(drag.getState().appearanceFrame > before);
  const mask = drag.maskPose();
  const shade = drag.shadePose();
  for (const frames of [0.25, 1, 9, 20, 100]) {
    drag.advance(frames, slots, { scrolling: true });
    assert.deepEqual(drag.maskPose(), mask);
    assert.deepEqual(drag.shadePose(), shade);
  }
});
