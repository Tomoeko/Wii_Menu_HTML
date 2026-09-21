import test from 'node:test';
import assert from 'node:assert/strict';
import { languageMask } from '../src/language.js';

const layout = {
  groups: {
    ENG: ['english', 'sharedWorldMap'],
    GER: ['german', 'sharedWorldMap'],
    FRA: ['french', 'sharedWorldMap'],
    CHT: ['traditionalChinese'],
    Rso0: ['animatedLogo'],
  },
};

test('English retains shared GER/FRA panes and hides other language-only panes including CHT', () => {
  assert.deepEqual(languageMask(layout), new Set(['german', 'french', 'traditionalChinese']));
  assert.deepEqual(layout.groups.ENG, ['english', 'sharedWorldMap']);
});

test('selecting another language preserves its shared panes without masking animation groups', () => {
  assert.deepEqual(
    languageMask(layout, 'GER'),
    new Set(['english', 'french', 'traditionalChinese']),
  );
  assert.deepEqual(languageMask({}), new Set());
});
