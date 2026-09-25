import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createChannelUpdateService } from '../../tools/channel-updates.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);
const installedId = '0001000148414241';
const newId = '0001000148414242';
const removedId = '0001000148414243';
const hash = (character) => character.repeat(64);

const rows = [
  { id: installedId, title: 'Existing', installed: true, existingSha256: hash('a'),
    incomingSha256: hash('b'), existingVersion: 1, incomingVersion: 2, change: 'different' },
  { id: newId, title: 'New', installed: false, existingSha256: null,
    incomingSha256: hash('c'), existingVersion: null, incomingVersion: 1, change: 'new' },
  { id: removedId, title: 'Removed', installed: false, existingSha256: null,
    incomingSha256: hash('d'), existingVersion: null, incomingVersion: 2, change: 'removed' },
];

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'channel-update-test-'));
  const paths = { assets: join(root, 'assets'), localDirectory: join(root, 'local') };
  await mkdir(paths.localDirectory);
  try {
    await run(paths);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('NAND update applies only reviewed choices and discards the preview afterward', async () => {
  await fixture(async (paths) => {
    let applied;
    const executePython = async (args) => {
      if (args[0].endsWith('preview_nand_updates.py')) {
        const output = args[args.indexOf('--output') + 1];
        await mkdir(output);
        await writeFile(join(output, 'channels.json'), JSON.stringify({
          channels: rows.map((row) => ({ id: row.id, source: { sha256: row.incomingSha256 } })),
        }));
        return JSON.stringify({ rows });
      }
      applied = args;
      const planFile = args[args.indexOf('--expect-plan') + 1];
      assert.deepEqual(JSON.parse(await readFile(planFile, 'utf8')), { rows });
      return '';
    };
    const updates = createChannelUpdateService(paths, { executePython });
    await updates.initialize();
    const scan = await updates.scan({ nandPath: '/private/new-nand' });
    assert.deepEqual(scan.counts, { existing: 1, new: 1, removed: 1 });
    await assert.rejects(
      updates.apply({ sessionId: scan.sessionId, replaceIds: [newId], installNewIds: [] }),
      /do not match/,
    );
    const result = await updates.apply({
      sessionId: scan.sessionId,
      replaceIds: [installedId, removedId],
      installNewIds: [],
    });
    assert.deepEqual(result.replacedIds, [installedId, removedId]);
    assert.deepEqual(
      applied.filter((argument, index) => applied[index - 1] === '--replace-channel'),
      [installedId, removedId],
    );
    assert.deepEqual(
      applied.filter((argument, index) => applied[index - 1] === '--keep-channel'),
      [newId],
    );
    assert.deepEqual(await readdir(join(paths.assets, 'channel-updates')), []);
    await assert.rejects(
      updates.apply({ sessionId: scan.sessionId, replaceIds: [], installNewIds: [] }),
      /expired/,
    );
  });
});

test('NAND update refuses a preview whose content differs from the plan', async () => {
  await fixture(async (paths) => {
    const executePython = async (args) => {
      const output = args[args.indexOf('--output') + 1];
      await mkdir(output);
      await writeFile(join(output, 'channels.json'), JSON.stringify({
        channels: rows.map((row) => ({
          id: row.id,
          source: { sha256: row.id === installedId ? hash('e') : row.incomingSha256 },
        })),
      }));
      return JSON.stringify({ rows });
    };
    const updates = createChannelUpdateService(paths, { executePython });
    await updates.initialize();
    await assert.rejects(updates.scan({ nandPath: '/private/new-nand' }), /changed/);
    assert.deepEqual(await readdir(join(paths.assets, 'channel-updates')), []);
  });
});

test('scanned replacement publishes the selected NAND version through preparation', async () => {
  await fixture(async (paths) => {
    await mkdir(paths.assets);
    await writeFile(join(paths.assets, 'manifest.json'), '{}\n');
    const oldNand = join(paths.localDirectory, 'synthetic-old');
    const newNand = join(paths.localDirectory, 'synthetic-new');
    const fixtureCode = [
      'import sys',
      'from pathlib import Path',
      'sys.path.insert(0, sys.argv[1])',
      'from test_nand_updates import write_channel',
      'write_channel(Path(sys.argv[2]), sys.argv[3],',
      '              version=int(sys.argv[4]), name=sys.argv[5])',
    ].join('\n');
    for (const [nand, version, name] of [
      [oldNand, '1', 'Older Channel'],
      [newNand, '2', 'Updated Channel'],
    ]) {
      await run('python3', [
        '-c', fixtureCode, join(project, 'tools/assets'), nand, installedId, version, name,
      ]);
    }
    await run('python3', [
      join(project, 'tools/assets/prepare.py'), 'add', '--nand', oldNand,
      '--local-dir', paths.localDirectory, '--output', paths.assets,
    ]);
    const updates = createChannelUpdateService(paths);
    await updates.initialize();
    const scan = await updates.scan({ nandPath: newNand });
    assert.equal(scan.rows[0].change, 'different');
    const before = JSON.parse(await readFile(join(paths.assets, 'channels.json'), 'utf8'));
    assert.equal(before.channels[0].title, 'Older Channel');
    await updates.apply({
      sessionId: scan.sessionId,
      replaceIds: [installedId],
      installNewIds: [],
    });
    const after = JSON.parse(await readFile(join(paths.assets, 'channels.json'), 'utf8'));
    assert.equal(after.channels[0].title, 'Updated Channel');
    assert.equal(after.channels[0].source.sha256, scan.rows[0].incomingSha256);
    assert.deepEqual(await readdir(join(paths.assets, 'channel-updates')), []);
  });
});
