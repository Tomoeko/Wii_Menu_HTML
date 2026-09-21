import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { indexLayout } from '../src/animation.js';
import { poseEmptyDiscBanner } from '../src/disc-animation.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const entry = manifest?.layouts.my_DiskCh_a;
const layout = entry ? JSON.parse(readFileSync(new URL(entry.url, manifestUrl))) : null;

test('empty Disc banner advances both native layout calls and holds its authored endpoint', {
  skip: !layout,
}, () => {
  const original = JSON.stringify(layout);
  const angles = (updates) => {
    const panes = indexLayout(poseEmptyDiscBanner(layout, updates)).panes;
    return ['WiiDisk', 'GCDisk'].map((name) => panes.get(name).rotation[2]);
  };
  assert.deepEqual(angles(0), [100, 100]);
  assert.deepEqual(angles(10), [165, 165]);
  assert.ok(angles(30).every((angle) => Math.abs(angle - 285.65469) < 0.00001));
  assert.ok(angles(70).every((angle) => Math.abs(angle - 360) < 0.0001));
  assert.deepEqual(angles(500), angles(70));
  assert.equal(JSON.stringify(layout), original);
});
