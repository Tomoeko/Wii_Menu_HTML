import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsInputMarker } from '../src/settings-input-marker.js';

const geometry = { x: 204, y: 192, width: 1, height: 36 };

test('HTML marker remains stationary for its nickname request and disappears on initial completion', () => {
  const marker = createSettingsInputMarker();
  marker.prepare(geometry);
  assert.equal(marker.value, null);
  marker.open({ requestId: 7, profile: 'console-nickname' });
  assert.deepEqual(marker.value, geometry);
  marker.prepare({ ...geometry, x: 220 });
  assert.deepEqual(marker.value, geometry, 'keyboard pointer events cannot move the HTML selection');
  assert.equal(marker.close(6), false);
  assert.deepEqual(marker.value, geometry);
  assert.equal(marker.close(7), true);
  assert.equal(marker.value, null, 'no animation or raster completion is needed to hide it');
  marker.open({ requestId: 8, profile: 'console-nickname' });
  assert.equal(marker.value, null, 'reopening must not reuse the earlier selection');
});

test('other Settings fields never acquire the nickname marker', () => {
  const marker = createSettingsInputMarker();
  marker.prepare(geometry);
  marker.open({ requestId: 1, profile: 'settings-form' });
  assert.equal(marker.value, null);
  marker.close();
  marker.prepare({ ...geometry, x: Number.NaN });
  marker.open({ requestId: 2, profile: 'console-nickname' });
  assert.equal(marker.value, null);
});
