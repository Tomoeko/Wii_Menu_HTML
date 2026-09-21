import assert from 'node:assert/strict';
import test from 'node:test';
import { readDeletedChannelIds } from '../src/channel-recovery.js';

test('menu loading observes local Trash without treating a failed server as an empty Trash', async () => {
  const deleted = ['custom-example', '0001000148434c45'];
  assert.deepEqual(
    await readDeletedChannelIds(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deletedIds: deleted }),
    })),
    deleted,
  );
  await assert.rejects(
    readDeletedChannelIds(async () => ({ status: 500 })),
    /recovery state/,
  );
  await assert.rejects(
    readDeletedChannelIds(async () => ({
      ok: true,
      json: async () => ({}),
    })),
    /Restart/,
  );
});

test('static previews without the local API have no Trash records', async () => {
  assert.deepEqual(await readDeletedChannelIds(async () => ({ status: 404 })), []);
});
