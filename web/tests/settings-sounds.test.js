import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsSoundSymbol, createSettingsSoundQueue } from '../src/settings-sounds.js';

test('Settings original HTML hover, arrow, decision and Back values retain distinct native cues', () => {
  assert.equal(settingsSoundSymbol(1), 'WIPL_SE_BT_PUSH');
  assert.equal(settingsSoundSymbol(2), 'WIPL_SE_BT_TARGETTING');
  assert.equal(settingsSoundSymbol(3), 'WIPL_SE_DECIDE');
  assert.equal(settingsSoundSymbol(4), 'WIPL_SE_CANCEL');
  assert.equal(settingsSoundSymbol(5), 'WIPL_SE_CHOICE_CHG');
  assert.equal(settingsSoundSymbol(6), 'WIPL_SE_CHAR_DELETE_ERROR');
});

test('a decision replaces same-update hover without replaying the discarded request', () => {
  const queue = createSettingsSoundQueue();
  queue.request(2);
  queue.request(3);
  queue.request(2);
  assert.equal(queue.advance(1), 3);
  assert.equal(queue.advance(9), null);
  queue.request(2);
  assert.equal(queue.advance(1), 2);
});

test('exceptional cues replace hover but not decisions and survive fractional display frames', () => {
  const queue = createSettingsSoundQueue();
  queue.request(2);
  queue.request(5, { channel: 'excse' });
  assert.equal(queue.advance(0.5), null);
  assert.equal(queue.advance(0.5), 5);
  queue.request(3);
  queue.request(4, { channel: 'excse' });
  assert.equal(queue.advance(1), 3);
  queue.request(2);
  assert.equal(queue.advance(1), 2);
  queue.request(4, { pageId: 30 });
  assert.equal(queue.advance(1), 4);
  queue.request(2);
  assert.equal(queue.advance(1), 2);
  queue.request(3);
  queue.clear();
  assert.equal(queue.advance(1), null);
});

test('output-mode preview/cancel cues map without treating missing numeric IDs as button clicks', () => {
  for (const value of [10, 11, 12]) {
    assert.equal(settingsSoundSymbol(value), 'WIPL_SE_OUTPUT_MODE_SELECT');
  }
  for (const value of [30, 31, 32]) assert.equal(settingsSoundSymbol(value), 'WIPL_SE_CANCEL');
  for (const value of [0, 7, 9, 13, 29, 33, -1, NaN, '2']) {
    assert.equal(settingsSoundSymbol(value), null);
  }
});
