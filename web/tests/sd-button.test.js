import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSDButton } from '../src/sd-button.js';
import { indexLayout } from '../src/animation.js';

const sourcePath = new URL('../public/assets/layouts/cmnBtn/mn_Sdcard_Btn.json', import.meta.url);
const source = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath)) : null;
const sourceTest = {
  skip: !source && 'Prepare a local menu WAD to test its original resources.',
};
test('enabled SD fixture uses original blue artwork at the widescreen position', sourceTest, () => {
  const layout = createSDButton(source, { enabled: true, x: -245 }).pose();
  const { panes } = indexLayout(layout);
  assert.deepEqual(layout.root.translation, [-245, -172, 0]);
  assert.equal(panes.get('N_Btn_On').flags & 1, 1);
  assert.equal(panes.get('N_Btn_Off').flags & 1, 0);
});
test('SD graphic preserves the native fixed 4:3 position, appearance and authored hit pane', sourceTest, () => {
  const layout = createSDButton(source, { enabled: false }).pose(),
    { panes } = indexLayout(layout);
  assert.deepEqual(layout.root.translation, [-152, -172, 0]);
  assert.equal(panes.get('N_Btn_On').flags & 1, 0);
  assert.equal(panes.get('N_Btn_Off').flags & 1, 1);
  assert.equal(panes.get('N_Btn').alpha, 255);
  assert.deepEqual(panes.get('Ac').size, [40, 50]);
  assert.deepEqual(source.root.translation, [0, 0, 0]);
  assert.equal(indexLayout(source).panes.get('N_Btn').alpha, 0);
});
test('SD rollover and rollout use the original six-frame group without changing entrance scale', sourceTest, () => {
  const button = createSDButton(source, { enabled: false }),
    at = (frame, hovered) => indexLayout(button.pose({ frame, hovered })).panes;
  const rest = at(0, false),
    initialScale = rest.get('N_Btn_Off').scale[0];
  assert.equal(at(10, true).get('N_Btn_Off').scale[0], initialScale);
  const selected = at(16, true);
  assert.ok(selected.get('N_Btn_Off').scale[0] > initialScale);
  assert.deepEqual(selected.get('N_Btn').scale, rest.get('N_Btn').scale);
  at(20, false);
  assert.equal(at(26, false).get('N_Btn_Off').scale[0], initialScale);
});
test('board transitions play the fifteen-frame SD Out clip in both directions', sourceTest, () => {
  const button = createSDButton(source);
  const alpha = (frame, visible) =>
    indexLayout(button.pose({ frame, visible })).panes.get('N_Btn').alpha;
  assert.equal(alpha(100, false), 255);
  assert.ok(alpha(107, false) > 0 && alpha(107, false) < 255);
  assert.equal(alpha(115, false), 0);
  assert.equal(alpha(200, true), 0);
  assert.ok(alpha(207, true) > 0 && alpha(207, true) < 255);
  assert.equal(alpha(215, true), 255);
  assert.equal(button.getState(215).frame, 0);
});
test('leaving during SD reappearance continues from the currently visible authored pose', sourceTest, () => {
  const button = createSDButton(source);
  button.setVisible(false, 0);
  button.setVisible(true, 30);
  const before = button.getState(36).frame;
  button.setVisible(false, 36);
  assert.equal(button.getState(36).frame, before);
  assert.equal(button.getState(42).frame, 15);
});
