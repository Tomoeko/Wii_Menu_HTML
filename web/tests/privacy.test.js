import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPrivacy } from '../../tools/audit-privacy.mjs';

test('privacy audit detects personal paths without echoing their contents', () => {
  const username = 'example' + '-person';
  const home = ['','Users', username].join('/');
  const results = inspectPrivacy(`source: ${home}/input.wad\nowner: ${username}`, { home, username });
  assert.deepEqual(results.map((result) => result.line), [1, 2]);
  assert.ok(!JSON.stringify(results).includes(username));
});

test('portable resource paths, hashes and generic usernames are not personal paths', () => {
  assert.deepEqual(inspectPrivacy('sound/IplSound.brsar\nrootScaleX\n/assets/fonts/font.ttf', {
    home: '/not-the-current-home', username: 'root',
  }), []);
});
