import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const command = fileURLToPath(new URL('../../tools/trace-channels.mjs', import.meta.url));

test('channel trace refuses catalog IDs and layout paths outside its output and assets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wii-trace-security-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assets = join(directory, 'assets');
  const output = join(directory, 'traces');
  await mkdir(assets);
  await writeFile(join(assets, 'manifest.json'), '{"fonts":{}}');
  await writeFile(join(directory, 'secret.json'), '{}');

  const trace = () => {
    const result = spawnSync(process.execPath, [
      command, '--assets', assets, '--output', output, '--frames', '1',
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    return result.stderr;
  };

  await writeFile(join(assets, 'channels.json'), JSON.stringify({
    channels: [{ id: '../escape', iconLayout: 'layout.json' }],
  }));
  assert.match(trace(), /Invalid native channel ID/);

  await writeFile(join(assets, 'channels.json'), JSON.stringify({
    channels: [{ id: '0001000154455354', iconLayout: '../secret.json' }],
  }));
  assert.match(trace(), /escapes the assets directory/);
});
