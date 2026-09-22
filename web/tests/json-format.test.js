import assert from 'node:assert/strict';
import test from 'node:test';
import { formatJson } from '../../tools/format-json.mjs';

test('JSON formatter keeps scalar arrays on one line and preserves values', () => {
  const value = {
    translation: [24, -24, 0],
    rotation: [0, 0, 0],
    scale: [1, 1],
    size: [38, 38],
    colors: [
      [0, 0, 0, 0],
      [255, 255, 255, 255],
    ],
  };
  const formatted = formatJson(value);
  assert.match(formatted, /"translation": \[24, -24, 0\]/);
  assert.match(formatted, /"rotation": \[0, 0, 0\]/);
  assert.match(formatted, /"scale": \[1, 1\]/);
  assert.match(formatted, /"size": \[38, 38\]/);
  assert.match(formatted, /"colors": \[\n\s+\[0, 0, 0, 0\]/);
  assert.deepEqual(JSON.parse(formatted), value);
});
