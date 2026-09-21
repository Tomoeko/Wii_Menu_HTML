#!/usr/bin/env node
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  incomingPhotoAssets, validateIncomingLetter, validateIncomingLetterFixture,
} from '../web/src/incoming-letter-fixture.js';
import { pngDimensions } from './channel-image.mjs';
import { updateMessageBoard, validateMessageBoard } from './local-state.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const maximumFixtureBytes = 2 * 1024 * 1024;
const maximumPhotoBytes = 4 * 1024 * 1024;
const maximumBatchPhotoBytes = 32 * 1024 * 1024;
const format = (value) => JSON.stringify(value, null, 2) + '\n';

async function regularDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Incoming Letter assets require a regular directory.');
  }
}

async function boundedFile(file, maximum) {
  const stream = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await stream.stat();
    if (!info.isFile() || info.size < 1 || info.size > maximum) {
      throw new Error('Incoming Letter input is not a bounded regular file.');
    }
    // Read through the verified descriptor, not a path that can be replaced.
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await stream.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== info.size) throw new Error('Incoming Letter input changed while reading.');
    return bytes.subarray(0, length);
  } finally {
    await stream.close();
  }
}

function verifyPhoto(bytes, photo) {
  const [width, height] = pngDimensions(bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (width !== photo.width || height !== photo.height || hash !== photo.sha256) {
    throw new Error(`Incoming photo ${photo.id} does not match its dimensions or SHA-256.`);
  }
}

/** Add immutable incoming records; retries never reset read status or position. */
export function mergeIncomingLetters(board, fixture) {
  const current = validateMessageBoard(board);
  const incoming = validateIncomingLetterFixture(fixture);
  const records = new Map(current.memos.map((memo) => [memo.id, memo]));
  const added = [];
  for (const letter of incoming.letters) {
    const previous = records.get(letter.id);
    if (previous) {
      if (previous.kind !== 'letter' ||
          JSON.stringify(validateIncomingLetter(previous)) !== JSON.stringify(letter)) {
        throw new Error(`Conflicting Message Board content for incoming identifier ${letter.id}.`);
      }
      continue;
    }
    added.push({ ...letter, readAt: null });
  }
  return validateMessageBoard({ version: 1, memos: [...current.memos, ...added] });
}

async function preparePhotos(fixture, photoDirectory) {
  const photos = new Map();
  for (const { photo } of fixture.letters) {
    for (const asset of incomingPhotoAssets(photo)) {
      const existing = photos.get(asset.localSrc);
      if (existing && JSON.stringify(existing.photo) !== JSON.stringify(asset)) {
        throw new Error(`Conflicting incoming photo identifier ${asset.id}.`);
      }
      photos.set(asset.localSrc, {
        photo: asset, relative: asset.localSrc.slice('/assets/local-letters/'.length),
      });
    }
  }
  if (!photos.size) return [];
  if (!photoDirectory) throw new Error('Photo-bearing imports require --photos DIRECTORY.');
  const input = await realpath(photoDirectory);
  await regularDirectory(input);
  let totalBytes = 0;
  for (const entry of photos.values()) {
    const source = join(input, entry.relative);
    await regularDirectory(dirname(source));
    entry.bytes = await boundedFile(source, maximumPhotoBytes);
    totalBytes += entry.bytes.length;
    if (totalBytes > maximumBatchPhotoBytes) {
      throw new Error('Incoming photo batches must contain at most 32 MiB of PNG data.');
    }
    verifyPhoto(entry.bytes, entry.photo);
  }
  return [...photos.values()];
}

async function withPublicationLock(localDirectory, operation) {
  await mkdir(localDirectory, { recursive: true });
  await regularDirectory(localDirectory);
  const lock = join(localDirectory, '.prepare-lock');
  try {
    // Preparation owns this same path as an OS-locked file; a directory is an
    // explicit local publisher. Never remove a foreign or interrupted lock.
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Another asset preparation or local publication is running.');
    }
    throw error;
  }
  try {
    await writeFile(join(lock, 'incoming-owner.json'), format({ version: 1, pid: process.pid }),
      { flag: 'wx', mode: 0o600 });
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function publishPhotos(assets, entries) {
  if (!entries.length) return;
  await mkdir(assets, { recursive: true });
  await regularDirectory(assets);
  const directory = join(assets, 'local-letters');
  await mkdir(directory, { recursive: true });
  await regularDirectory(directory);
  const missing = [];
  // Validate every existing destination before publishing any new asset.
  for (const entry of entries) {
    const destination = join(directory, entry.relative);
    await mkdir(dirname(destination), { recursive: true });
    await regularDirectory(dirname(destination));
    try {
      verifyPhoto(await boundedFile(destination, maximumPhotoBytes), entry.photo);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push({ ...entry, destination });
    }
  }
  for (const { bytes, destination } of missing) {
    const temporary = join(dirname(destination), `.incoming-${randomUUID()}.tmp`);
    try {
      const stream = await open(temporary, 'wx', 0o600);
      try {
        await stream.writeFile(bytes);
        await stream.sync();
      } finally {
        await stream.close();
      }
      // Atomic no-replacement publication; matching retries reuse the file.
      await link(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

/** Publish checked PNGs first, then atomically commit the merged Message Board.
 * A failed Board write may leave reusable, unreferenced validated photos. It
 * never exposes a Board record before its asset has been published.
 */
export async function importIncomingLetters(fixtureFile, {
  boardFile = join(project, '.local/message-board.json'),
  assets = join(project, 'web/public/assets'),
  localDirectory = dirname(boardFile),
  photoDirectory,
} = {}) {
  const fixture = validateIncomingLetterFixture(JSON.parse(
    (await boundedFile(fixtureFile, maximumFixtureBytes)).toString('utf8'),
  ));
  const photos = await preparePhotos(fixture, photoDirectory);
  return withPublicationLock(resolve(localDirectory), () => updateMessageBoard(boardFile,
    async (current) => {
      const merged = mergeIncomingLetters(current, fixture);
      const photoIds = new Map();
      for (const memo of merged.memos) {
        if (memo.kind !== 'letter' || !memo.photo) continue;
        for (const asset of incomingPhotoAssets(memo.photo)) {
          const identity = JSON.stringify(asset);
          if (photoIds.has(asset.localSrc) && photoIds.get(asset.localSrc) !== identity) {
            throw new Error(`Conflicting incoming photo identifier ${asset.id}.`);
          }
          photoIds.set(asset.localSrc, identity);
        }
      }
      await publishPhotos(resolve(assets), photos);
      return merged;
    }));
}

async function main(args) {
  const [command, fixtureFile, ...flags] = args;
  if (command !== 'import' || !fixtureFile || fixtureFile.startsWith('--')) {
    throw new Error('Usage: node tools/incoming-letters.mjs import FIXTURE.json '
      + '[--photos DIRECTORY] [--board FILE] [--assets DIRECTORY] [--local-dir DIRECTORY]');
  }
  const fields = { '--photos': 'photoDirectory', '--board': 'boardFile',
    '--assets': 'assets', '--local-dir': 'localDirectory' };
  const options = {};
  for (let index = 0; index < flags.length; index += 2) {
    const field = fields[flags[index]];
    const value = flags[index + 1];
    if (!field || !value || value.startsWith('--') || Object.hasOwn(options, field)) {
      throw new Error('Invalid or repeated incoming Letter import option.');
    }
    options[field] = resolve(value);
  }
  const state = await importIncomingLetters(resolve(fixtureFile), options);
  const count = state.memos.filter((memo) => memo.kind === 'letter').length;
  console.log(`Incoming Letters imported locally (${count} total). Reload the menu to display them.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
