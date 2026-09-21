import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannelBalloon } from '../src/channel-balloon.js';
import { createDisplay } from '../src/display.js';

const pane = (name) => ({ name, flags: 1, size: [488, 48], translation: [0, 0, 0], children: [] });
const source = {
  root: { ...pane('RootPane'), children: ['W_Base', 'W_Shade', 'T_Balloon'].map(pane) },
  materials: [],
  animations: { my_IplTopBalloon_a_BalloonInOut: { frames: 7, loop: true, targets: [] } },
};
test('balloon waits twenty frames and exits after the source seven-frame clip', () => {
  const balloon = createChannelBalloon(source, (text) => text.length * 12);
  const channels = [{ title: 'Disc Channel' }];
  balloon.target(0);
  balloon.advance(19);
  assert.equal(balloon.poses(channels).length, 0);
  balloon.advance(1);
  const [{ layout, title }] = balloon.poses(channels);
  assert.equal(title, 'Disc Channel');
  assert.equal(layout.root.children[0].size[0], 184);
  assert.deepEqual(layout.root.translation, [-152, 75, 0]);
  balloon.advance(7);
  balloon.target(null);
  balloon.advance(1);
  balloon.advance(7);
  assert.equal(balloon.poses(channels).length, 0);
});
test('moving away before the delay never shows a tooltip', () => {
  const balloon = createChannelBalloon(source, () => 100);
  balloon.target(0);
  balloon.advance(10);
  balloon.target(null);
  balloon.advance(30);
  assert.equal(balloon.poses([{ title: 'Disc Channel' }]).length, 0);
});
test('tooltip sound fires once at appearance and never for a cancelled delayed tooltip', () => {
  const appeared = [],
    balloon = createChannelBalloon(source, () => 100, {
      onAppear: (index) => appeared.push(index),
    });
  balloon.target(0);
  balloon.advance(19);
  assert.deepEqual(appeared, []);
  balloon.advance(1);
  assert.deepEqual(appeared, [0]);
  balloon.advance(100);
  assert.deepEqual(appeared, [0]);
  balloon.target(1);
  balloon.advance(10);
  balloon.target(null);
  balloon.advance(30);
  assert.deepEqual(appeared, [0]);
  balloon.clear();
  balloon.target(0);
  balloon.advance(20);
  assert.deepEqual(appeared, [0, 0]);
});

test('wide tooltips use the source scaled minimum and sixty-unit screen margins', () => {
  const display = createDisplay(),
    balloon = createChannelBalloon(source, () => 100, { display });
  const channels = Array.from({ length: 12 }, () => ({ title: 'Mii' }));
  balloon.target(0);
  balloon.advance(27);
  let [{ layout }] = balloon.poses(channels);
  const width = 160 * display.rootScaleX;
  assert.equal(layout.root.children[0].size[0], width);
  assert.equal(layout.root.translation[0], -display.halfWidth + 60 + width / 2);
  assert.equal(layout.root.translation[1], 75);
  balloon.clear();
  balloon.target(1);
  balloon.advance(27);
  [{ layout }] = balloon.poses(channels);
  assert.equal(layout.root.translation[0], -64 * display.rootScaleX);
  balloon.clear();
  balloon.target(3);
  balloon.advance(27);
  [{ layout }] = balloon.poses(channels);
  assert.equal(layout.root.translation[0], display.halfWidth - 60 - width / 2);
});
