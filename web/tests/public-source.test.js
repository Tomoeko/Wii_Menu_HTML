import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createExampleAudio } from '../../tools/custom-channel-audio.mjs';
import {
  planPublicSource, publicDefaultBytes, readPublicSourceFile,
} from '../../tools/public-source.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'public-source-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const write = async (name, bytes = 'authored source\n') => {
    const file = join(directory, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };
  for (const name of [
    '.gitignore', 'AGENTS.md', 'README.md', 'LICENSE', 'package.json', 'config.json',
    'defaults/channel-layout.json', 'defaults/message-board.json',
    'web/index.html', 'web/src/main.js', 'tools/serve.mjs', 'tools/init-state.mjs',
    'tools/assets/prepare.py', 'tools/audit-privacy.mjs',
  ]) {
    await write(name, publicDefaultBytes(name) ?? 'authored source\n');
  }
  return { directory, write };
}

test('public inventory excludes private resources and uploaded examples without reading them', async (t) => {
  const { directory, write } = await fixture(t);
  for (const name of [
    '.local/messages.json', 'web/public/assets/menu.json', 'artifacts/capture.png',
    '.git/config', 'private/keys.bin', 'menu.wad', 'notes.txt',
    'examples/custom-channels/custom-uploaded/image.png',
    'tools/__pycache__/cached.pyc',
  ]) {
    await write(name, Buffer.from([0, 255, 127]));
  }
  const result = await planPublicSource(directory);
  assert.deepEqual(result.findings, []);
  assert.equal(result.files.length, 14);
  assert.equal(result.excluded.length, 9);
  const clean = await planPublicSource(directory, { requireClean: true });
  assert.equal(clean.findings.length, 8);
  assert.ok(!clean.findings.some((finding) => finding.file === '.git'),
    'Git metadata is excluded from source export and requires a separate history review');
});

test('local roadmap stays excluded without making a clean public export fail', async (t) => {
  const { directory, write } = await fixture(t);
  await write('ROADMAP.md', 'Local planning notes\n');
  const result = await planPublicSource(directory, { requireClean: true });
  assert.deepEqual(result.findings, []);
  assert.ok(result.excluded.includes('ROADMAP.md'));
  assert.ok(!result.files.some((file) => file.path === 'ROADMAP.md'));
});

test('public configuration and initial state regenerate clean defaults without changing inputs', async (t) => {
  const { directory, write } = await fixture(t);
  const source = '{"channels":{"enabled":{"private-channel":false}},"private":"local data"}\n';
  await write('config.json', source);
  await write('defaults/message-board.json', '{"version":1,"memos":[{"text":"private"}]}');
  const result = await planPublicSource(directory);
  assert.deepEqual(result.findings, []);
  for (const name of ['config.json', 'defaults/message-board.json']) {
    const entry = result.files.find((file) => file.path === name);
    assert.equal(entry.source, 'public-default');
    assert.deepEqual(await readPublicSourceFile(directory, entry), publicDefaultBytes(name));
  }
  assert.equal(await readFile(join(directory, 'config.json'), 'utf8'), source);
  assert.equal((await planPublicSource(directory, { requireClean: true })).findings.length, 2);
});

test('only exact reproducible authored sample audio can enter the public inventory', async (t) => {
  const { directory, write } = await fixture(t);
  const example = 'examples/custom-channels/custom-example/sound.wav';
  await write(example, createExampleAudio());
  await write('templates/custom-channel/sound.wav', Buffer.from('unreviewed recording'));
  await write('docs/capture.png', Buffer.from('unreviewed capture'));
  const result = await planPublicSource(directory);
  assert.ok(result.files.some((file) => file.path === example));
  assert.deepEqual(result.findings.map((finding) => finding.category).sort(), [
    'file type needs explicit public-source review',
    'sample audio differs from authored generator',
  ]);
});

test('public inventory rejects symlinks, invalid UTF-8 and binary data disguised as source', async (t) => {
  const { directory, write } = await fixture(t);
  await write('web/src/binary.js', Buffer.from([0]));
  await write('web/src/invalid.js', Buffer.from([255]));
  await symlink(join(directory, 'README.md'), join(directory, 'web/src/link.js'));
  const result = await planPublicSource(directory);
  assert.equal(result.findings.length, 3);
  assert.ok(result.findings.some((finding) => finding.category === 'symlink is not public source'));
});

test('export reads reject changed bytes and symlink replacement after the inventory', async (t) => {
  const { directory, write } = await fixture(t);
  const { files } = await planPublicSource(directory);
  const entry = files.find((file) => file.path === 'web/src/main.js');
  await write('web/src/main.js', 'changed source\n');
  await assert.rejects(readPublicSourceFile(directory, entry), /changed after review/);
  await rm(join(directory, 'web/src/main.js'));
  await symlink(join(directory, 'README.md'), join(directory, 'web/src/main.js'));
  await assert.rejects(readPublicSourceFile(directory, entry), /symlink/);
  await assert.rejects(readPublicSourceFile(directory, { path: '../outside.txt' }), /Invalid/);
});

test('public inventory reuses privacy checks and reports absent standalone entry points', async (t) => {
  const { directory, write } = await fixture(t);
  const username = 'synthetic' + '-person';
  const home = ['', 'Users', username].join('/');
  await write('docs/unsafe.md', `${home}/input.wad\n`);
  await rm(join(directory, 'web/index.html'));
  const result = await planPublicSource(directory, { identity: { home, username } });
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.some((finding) => finding.file === 'web/index.html'));
  assert.ok(!JSON.stringify(result.findings).includes(username));
});
