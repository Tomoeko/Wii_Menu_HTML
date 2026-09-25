import test from 'node:test';
import assert from 'node:assert/strict';
import { planChannelUpdateSelection } from '../src/channel-updates.js';
import {
  candidateAssetBase,
  candidateAssetUrl,
  rebaseCandidateLayout,
} from '../src/channel-update-preview.js';

const sessionId = 'b3a11d0f-6547-41fa-87c2-0432298e7b42';

test('candidate previews stay within their staged local asset root', () => {
  assert.equal(
    candidateAssetBase(sessionId),
    `/assets/channel-updates/${sessionId}/`,
  );
  assert.equal(
    candidateAssetUrl(sessionId, 'channel-layouts/0001000148415941/icon/icon.json'),
    `/assets/channel-updates/${sessionId}/channel-layouts/0001000148415941/icon/icon.json`,
  );
  for (const path of ['../outside.json', '/assets/other.json', 'one//two', 'one/%2e%2e']) {
    assert.throws(() => candidateAssetUrl(sessionId, path), /invalid asset path/);
  }
  assert.throws(() => candidateAssetBase('../escape'), /session is invalid/);
});

test('candidate icon and banner textures use the scanned version', () => {
  const original = {
    textures: [{ name: 'background', url: 'channel-layouts/a/icon/textures/+.png' }],
    resourceTextures: {
      highlight: { name: 'highlight', url: 'channel-layouts/a/icon/textures/shine.png' },
    },
  };
  const prepared = rebaseCandidateLayout(original, sessionId);
  assert.equal(
    prepared.textures[0].url,
    `channel-updates/${sessionId}/channel-layouts/a/icon/textures/+.png`,
  );
  assert.equal(
    prepared.resourceTextures.highlight.url,
    `channel-updates/${sessionId}/channel-layouts/a/icon/textures/shine.png`,
  );
  assert.equal(original.textures[0].url, 'channel-layouts/a/icon/textures/+.png');
});

test('update choices keep installed and removed channels unless selected', () => {
  const rows = [
    { id: '0001000148415941', installed: true, change: 'changed' },
    { id: '0001000148415942', installed: false, change: 'new' },
    { id: '0001000148415943', installed: false, change: 'removed' },
  ];
  const decisions = new Map([
    [rows[0].id, false],
    [rows[1].id, true],
    [rows[2].id, false],
  ]);
  assert.deepEqual(planChannelUpdateSelection(rows, decisions), {
    replaceIds: [],
    installNewIds: [rows[1].id],
  });
  decisions.set(rows[0].id, true);
  decisions.set(rows[2].id, true);
  assert.deepEqual(planChannelUpdateSelection(rows, decisions), {
    replaceIds: [rows[0].id, rows[2].id],
    installNewIds: [rows[1].id],
  });
});
