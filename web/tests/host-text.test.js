import assert from 'node:assert/strict';
import test from 'node:test';
import { selectHostTextFont } from '../src/host-text.js';

const face = (characters) => ({
  font: {
    characters: Object.fromEntries(
      [...characters].map((character) => [character.codePointAt(0), 1]),
    ),
  },
});

test('placeholder text uses a complete shared font instead of a sparse menu subset', () => {
  const subset = face('Eample hannel previe ack');
  const shared = face('Example Channel previewBack');
  const fonts = new Map([
    ['subset', subset],
    ['wbf1.brfna', shared],
  ]);
  for (const text of ['Example Channel', 'Channel preview', 'Back']) {
    assert.equal(selectHostTextFont(fonts, text), shared);
  }
  assert.equal(selectHostTextFont(new Map([['subset', subset]]), 'Back'), undefined);
});

test('unmapped custom-title characters request local browser text without altering font data', () => {
  const shared = face('Example Channel');
  const fonts = new Map([['wbf1.brfna', shared]]);
  assert.equal(selectHostTextFont(fonts, 'A 🌟 channel'), undefined);
  assert.equal(selectHostTextFont(fonts, 'Example Channel'), shared);
});
