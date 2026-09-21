import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { reconcileSlots } from '../src/channel-storage.js';
import { validateArrangement } from '../../tools/local-state.mjs';
import { createMenuState } from '../src/menu-state.js';

test('public defaults are widescreen, original startup and enabled SD artwork', () => {
  const config = normalizeConfig();
  assert.equal(config.display.aspectRatio, '16:9');
  assert.equal(config.startup.healthSafety, true);
  assert.equal(config.sdCard.enabled, true);
  assert.deepEqual(config.input.grabButtons, [1, 2]);
  assert.equal(normalizeConfig({ startup: { healthSafety: false } }).startup.healthSafety, false);
  assert.throws(() => normalizeConfig({ display: { aspectRatio: 'stretch' } }));
  assert.throws(() => normalizeConfig({ audio: { volume: 4 } }));
});

test('saved positions survive catalog additions/removals without duplication or moving Disc', () => {
  const channels = ['disc', 'mii', 'new'].map((id) => ({ id }));
  const saved = Array(48).fill(null);
  saved[0] = 'mii';
  saved[15] = 'mii';
  saved[7] = 'removed';
  saved[22] = 'disc';
  const slots = reconcileSlots(channels, saved);
  assert.equal(slots[0].id, 'disc');
  assert.equal(slots[15].id, 'mii');
  assert.equal(slots[1].id, 'new');
  assert.equal(slots[7], null);
  assert.equal(slots[22], null);
  assert.equal(slots.filter(Boolean).length, 3);
});

test('native relocation only permits empty targets and keeps published snapshots immutable', () => {
  const menu = createMenuState({ channels: [{ id: 'disc' }, { id: 'mii' }, { id: 'photo' }] });
  const before = menu.getState();
  assert.equal(menu.moveChannel(0, 3), false);
  assert.equal(menu.moveChannel(1, 2), false);
  assert.equal(menu.moveChannel(1, 0), false);
  assert.equal(menu.moveChannel(1, 15), true);
  assert.equal(menu.getState().channels[15].id, 'mii');
  assert.equal(menu.getState().channels[1], null);
  assert.equal(before.channels[1].id, 'mii');
  const payload = {
    version: 1,
    slots: menu.getState().channels.map((channel) => channel?.id ?? null),
  };
  assert.deepEqual(validateArrangement(payload), payload);
  payload.slots[16] = 'mii';
  assert.throws(() => validateArrangement(payload), /unique/);
});
