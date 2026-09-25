/**
 * Initialize local runtime state from tracked defaults.
 *
 * Creates `.local/` and copies any missing state files from `defaults/`.
 * Existing user files are never overwritten. Run before the server from
 * `tools/start.mjs`, or manually with `node tools/init-state.mjs`.
 */

import { cp, copyFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const project = fileURLToPath(new URL('..', import.meta.url));
const localDir = join(project, '.local');
const defaultsDir = join(project, 'defaults');
const examplesChannelsDir = join(project, 'examples/custom-channels');
const localChannelsDir = join(localDir, 'custom-channels');

/**
 * State files to initialize. Each entry maps a filename that exists in
 * `defaults/` to the corresponding location inside `.local/`. Only files
 * that are missing from `.local/` are copied; existing user data is
 * always preserved.
 */
const STATE_FILES = [
  'channel-layout.json',
  'message-board.json',
];

async function initState() {
  await mkdir(localDir, { recursive: true });

  let created = 0;
  for (const name of STATE_FILES) {
    const target = join(localDir, name);
    const source = join(defaultsDir, name);

    if (existsSync(target)) {
      continue;
    }

    if (!existsSync(source)) {
      console.warn(`  warning: default missing for ${name}`);
      continue;
    }

    await copyFile(source, target);
    console.log(`  created .local/${name} from defaults/${name}`);
    created++;
  }

  if (existsSync(examplesChannelsDir)) {
    await mkdir(localChannelsDir, { recursive: true });
    const entries = await readdir(examplesChannelsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const target = join(localChannelsDir, entry.name);
      const source = join(examplesChannelsDir, entry.name);
      if (existsSync(target)) continue;
      await cp(source, target, { recursive: true });
      console.log(`  created .local/custom-channels/${entry.name} from examples`);
      created++;
    }
  }

  if (created === 0) {
    console.log('  state files already present');
  }
}

console.log('init-state:');
await initState();
