import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKeyboardPreferences } from '../src/keyboard-preferences.js';
import { symbolPages } from '../src/keyboard-data.js';

const defaults = {
  schemaVersion: 2,
  predictionEnabled: false,
  dictionaryLanguage: 'en',
  layoutMode: 'qwerty',
  phoneMode: 0,
  symbolPage: 0,
};

test('version-one preferences migrate without losing the dictionary toggle or language', () => {
  const legacy = { schemaVersion: 1, predictionEnabled: true, dictionaryLanguage: 'es' };
  assert.deepEqual(normalizeKeyboardPreferences(legacy), {
    ...defaults, predictionEnabled: true, dictionaryLanguage: 'es',
  });
  assert.deepEqual(legacy, { schemaVersion: 1, predictionEnabled: true, dictionaryLanguage: 'es' });
});

test('supported keyboard choices survive readable JSON round trips', () => {
  for (const phoneMode of [0, 1, 2, 3]) {
    const value = {
      ...defaults, predictionEnabled: true, dictionaryLanguage: 'fr',
      layoutMode: 'phone', phoneMode, symbolPage: symbolPages.length - 1,
    };
    const reloaded = JSON.parse(JSON.stringify(value, null, 2));
    assert.deepEqual(normalizeKeyboardPreferences(reloaded), value);
  }
});

test('invalid or unsupported modes cannot escape the supported preference schema', () => {
  for (const schemaVersion of [undefined, 0, 3, '2'])
    assert.deepEqual(normalizeKeyboardPreferences({ ...defaults, schemaVersion }), defaults);
  for (const phoneMode of [-1, 4, 0.5, '2', null, Infinity])
    assert.equal(normalizeKeyboardPreferences({ ...defaults, phoneMode }).phoneMode, 0);
  for (const symbolPage of [-1, symbolPages.length, 0.5, '1', null])
    assert.equal(normalizeKeyboardPreferences({ ...defaults, symbolPage }).symbolPage, 0);
  assert.deepEqual(normalizeKeyboardPreferences({
    schemaVersion: 2, predictionEnabled: 1, dictionaryLanguage: 'ja', layoutMode: 'numeric',
    phoneMode: 17, symbolPage: 99, hardwareShift: true, hardwareCapsLock: true,
  }), defaults);
  assert.deepEqual(normalizeKeyboardPreferences(null), defaults);
});
