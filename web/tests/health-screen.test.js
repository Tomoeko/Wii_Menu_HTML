import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHealthScreen } from '../src/health-screen.js';
import { indexLayout } from '../src/animation.js';

const sourcePath = new URL('../public/assets/layouts/health/it_Has_a.json', import.meta.url);
const source = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath)) : null;
const sourceTest = {
  skip: !source && 'Prepare a local menu WAD to test its original resources.',
};
test('health screen uses original locale panes, one-second hold, prompt and exit animation', sourceTest, () => {
  const health = createHealthScreen(source);
  assert.equal(health.accept(), false);
  let panes = indexLayout(health.pose()).panes;
  assert.equal(panes.get('Has_US_ENG').flags & 1, 1);
  assert.equal(panes.get('Has_JPN').flags & 1, 0);
  assert.equal(panes.get('Push_US_ENG').flags & 1, 0);
  health.advance(source.animations.it_Has_a_SeenIn.frames + 60);
  assert.equal(health.ready, true);
  panes = indexLayout(health.pose()).panes;
  assert.equal(panes.get('Push_US_ENG').flags & 1, 1);
  assert.equal(health.accept(), true);
  health.advance(source.animations.it_Has_a_SeenOut.frames - 1);
  assert.equal(health.active, true);
  health.advance(1);
  assert.equal(health.active, false);
  assert.equal(indexLayout(health.pose()).panes.get('N_All').alpha, 0);
  health.advance(10);
  assert.equal(indexLayout(health.pose()).panes.get('N_All').alpha, 0);
});
test('health startup can be skipped completely through configuration', sourceTest, () => {
  assert.equal(createHealthScreen(source, { enabled: false }).active, false);
});
