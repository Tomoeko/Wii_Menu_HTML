import { formatJson } from './format-json.mjs';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

/** Small local preferences: validate existing data and publish one complete file. */
export function createValidatedJsonState({ validate, fallback, maxBytes, label }) {
  let pending = Promise.resolve();

  async function read(file) {
    try {
      const directory = await lstat(dirname(file));
      if (!directory.isDirectory() || directory.isSymbolicLink()) {
        throw new Error(`${label} must use a regular directory.`);
      }
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
        throw new Error(`Invalid ${label.toLowerCase()} file.`);
      }
      return validate(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback(file);
      throw error;
    }
  }

  function update(file, transform) {
    const operation = pending.catch(() => {}).then(async () => {
      const directory = dirname(file);
      await mkdir(directory, { recursive: true });
      const directoryInfo = await lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
        throw new Error(`${label} must use a regular directory.`);
      }
      const lock = `${file}.lock`;
      const temporary = `${file}.${randomUUID()}.tmp`;
      // Only a successfully acquired lock is ours to remove. A foreign or
      // interrupted writer's lock remains visible for explicit local repair.
      await mkdir(lock);
      try {
        // A failed browser read must never cause a subsequent default-state
        // save to overwrite malformed existing user data.
        const previous = await read(file);
        const state = validate(await transform(previous));
        const stream = await open(temporary, 'wx', 0o600);
        try {
          await stream.writeFile(formatJson(state));
          await stream.sync();
        } finally {
          await stream.close();
        }
        await rename(temporary, file);
        return state;
      } finally {
        await rm(temporary, { force: true });
        await rm(lock, { recursive: true, force: true });
      }
    });
    pending = operation;
    return operation;
  }

  function write(file, value) {
    const state = validate(value);
    return update(file, () => state);
  }

  return { read, write, update };
}
