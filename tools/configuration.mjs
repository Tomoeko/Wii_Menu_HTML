import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class ConfigurationBusyError extends Error {
  constructor() {
    super('Another configuration change is running. Try saving again.');
  }
}

export async function readConfiguration(file) {
  let configuration;
  try {
    configuration = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    configuration = {};
  }
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new Error('Expected an object in the menu configuration.');
  }
  if (configuration.channels !== undefined &&
      (!configuration.channels || typeof configuration.channels !== 'object' ||
        Array.isArray(configuration.channels))) {
    throw new Error('Expected an object in configuration.channels.');
  }
  return configuration;
}

/** Read inside the shared lock so independent section edits cannot overwrite each other. */
export async function updateConfiguration(file, update) {
  await mkdir(dirname(file), { recursive: true });
  // Retain the established channel CLI lock name so older running writers
  // participate in the same ownership boundary.
  const lock = `${file}.channels.lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') throw new ConfigurationBusyError();
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const configuration = await readConfiguration(file);
    const result = await update(configuration);
    await writeFile(temporary, JSON.stringify(configuration, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, file);
    return result;
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
