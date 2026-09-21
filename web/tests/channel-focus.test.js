import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createChannelFocus } from '../src/channel-focus.js';
import { indexLayout } from '../src/animation.js';

const path = new URL('../public/assets/layouts/chanSel/my_IplTop_d.json', import.meta.url);
const source = existsSync(path) ? JSON.parse(readFileSync(path)) : null;
test(
  'original focus stays visible beyond its fifth frame instead of looping to hidden frame zero',
  { skip: !source },
  () => {
    const focus = createChannelFocus(source);
    focus.target(1);
    for (let frame = 1; frame <= 300; frame++) {
      focus.advance(1);
      const layout = focus.poses()[0].layout;
      assert.equal(indexLayout(layout).panes.get('Cursur_a').flags & 1, 1, `frame ${frame}`);
      if (frame >= 3) assert.equal(layout.materials[0].colors[1][3], 150);
    }
  },
);
test('leaving a channel completes the original 30-frame focus-off clip', { skip: !source }, () => {
  const focus = createChannelFocus(source);
  focus.target(0);
  focus.advance(5);
  focus.target(null);
  focus.advance(1);
  assert.equal(focus.poses().length, 1);
  focus.advance(29);
  assert.equal(focus.poses().length, 1);
  focus.advance(1);
  assert.equal(focus.poses().length, 0);
});
test(
  'the source selection controller survives cleared hover state and preserves authored visibility',
  { skip: !source },
  () => {
    const focus = createChannelFocus(source);
    focus.target(0);
    focus.clear();
    assert.equal(focus.poses().length, 0);
    assert.equal(focus.selectPose(0, 1).index, 0);
    const layout = focus.selectPose(0, 5).layout,
      posed = indexLayout(layout).panes.get('Cursur_a');
    // The supplied Select BRLAN keeps its pane invisible despite its alpha curve.
    // Preserve the resource rather than inventing a visible confirmation flash.
    assert.equal(posed.flags & 1, 0);
    assert.equal(layout.materials[0].colors[1][3], 150);
    assert.ok(focus.selectPose(0, 15));
    assert.equal(focus.selectPose(0, 16), null);
  },
);
