import { formatJson } from './format-json.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { mergeChannelCatalog } from '../web/src/channel-catalog.js';
import { readCustomCatalog } from './custom-channels.mjs';

const validId = (id) =>
  typeof id === 'string' &&
  /^[A-Za-z0-9_-]{1,64}$/.test(id) &&
  !['disc', '__proto__', 'prototype', 'constructor'].includes(id);
const maximumRecords = 2048;
const format = formatJson;

export class ChannelRecoveryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ChannelRecoveryError(status, code, message);
}

function recoveryFile(paths) {
  return paths.trashFile ?? join(paths.localDirectory, 'channel-trash.json');
}

export function validateChannelTrash(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.deleted) ||
    value.deleted.length > maximumRecords
  ) {
    throw new Error(
      'Invalid local channel Trash file. Expected version 1 and at most 2048 records.',
    );
  }
  const ids = new Set();
  const deleted = value.deleted.map((record) => {
    if (
      !record ||
      !validId(record.id) ||
      ids.has(record.id) ||
      typeof record.title !== 'string' ||
      !record.title.length ||
      record.title.length > 80 ||
      !['custom', 'imported'].includes(record.source) ||
      typeof record.enabled !== 'boolean' ||
      !(
        record.previousSlot === null ||
        (Number.isInteger(record.previousSlot) &&
          record.previousSlot >= 1 &&
          record.previousSlot < 48)
      ) ||
      typeof record.deletedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.deletedAt)) ||
      !/^[a-f0-9]{64}$/.test(record.identity)
    ) {
      throw new Error('Invalid local channel Trash record.');
    }
    ids.add(record.id);
    return {
      id: record.id,
      title: record.title,
      source: record.source,
      enabled: record.enabled,
      previousSlot: record.previousSlot,
      deletedAt: new Date(record.deletedAt).toISOString(),
      identity: record.identity,
    };
  });
  return { version: 1, deleted };
}

export async function readChannelTrash(paths) {
  const file = recoveryFile(paths);
  try {
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw new Error('Local channel Trash file exceeds 2 MiB.');
    return validateChannelTrash(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, deleted: [] };
    throw error;
  }
}

export async function readInstalledChannelCatalog(assets) {
  let native;
  try {
    native = JSON.parse(await readFile(join(assets, 'channels.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    native = { channels: [], defaultOrder: [] };
  }
  return mergeChannelCatalog(native, await readCustomCatalog(assets));
}

export function channelIdentity(channel) {
  // Original source hashes survive a regeneration of the exported layouts. A
  // different payload installed under the same ID must not inherit its Trash
  // record or silently replace the channel the user intended to restore.
  const sourceHash = channel.source?.sha256;
  const identity = /^[a-f0-9]{64}$/i.test(sourceHash ?? '')
    ? { id: channel.id, custom: Boolean(channel.custom), sourceHash: sourceHash.toLowerCase() }
    : {
        id: channel.id,
        custom: Boolean(channel.custom),
        title: channel.title,
        iconLayout: channel.iconLayout,
        bannerLayout: channel.bannerLayout,
        audio: channel.audio?.src,
      };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function resourcePath(value) {
  const path = typeof value === 'string' && value.startsWith('/assets/') ? value.slice(8) : value;
  if (
    typeof path !== 'string' ||
    !path ||
    !/^[A-Za-z0-9_./-]+$/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return null;
  return path;
}

async function availableFile(assets, resource) {
  const path = resourcePath(resource);
  if (!path) return null;
  try {
    const file = await realpath(join(assets, path));
    const inside = relative(await realpath(assets), file);
    if (
      isAbsolute(inside) ||
      inside === '..' ||
      inside.startsWith(`..${sep}`) ||
      !(await stat(file)).isFile()
    )
      return null;
    return file;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) return null;
    throw error;
  }
}

async function missingResources(channel, assets) {
  const missing = new Set();
  for (const kind of ['icon', 'banner']) {
    const file = await availableFile(assets, channel[`${kind}Layout`]);
    if (!file) {
      missing.add(`${kind}Layout`);
      continue;
    }
    let layout;
    try {
      if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('Layout too large.');
      layout = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(layout.textures)) throw new Error('Missing texture descriptors.');
    } catch {
      missing.add(`${kind}Layout`);
      continue;
    }
    for (const texture of layout.textures) {
      if (!(await availableFile(assets, texture.url))) missing.add('textures');
    }
  }
  if (channel.audio?.src && !(await availableFile(assets, channel.audio.src))) missing.add('audio');
  return [...missing];
}

async function restoreCondition(record, catalog, assets) {
  const channel = catalog.channels.find((entry) => entry.id === record.id);
  if (!channel) return { restoreStatus: 'missing-source', canRestore: false };
  if (channelIdentity(channel) !== record.identity)
    return { restoreStatus: 'id-conflict', canRestore: false };
  const missing = await missingResources(channel, assets);
  return missing.length
    ? { restoreStatus: 'missing-resources', canRestore: false, missing }
    : { restoreStatus: 'ready', canRestore: true };
}

export async function describeDeletedChannels(trash, catalog, assets) {
  return Promise.all(
    trash.deleted.map(async (record) => {
      const { identity, ...summary } = record;
      return {
        ...summary,
        status: 'deleted',
        slot: null,
        ...(await restoreCondition(record, catalog, assets)),
      };
    }),
  );
}

/**
 * Trash is an exclusion record, not a destructive catalog rewrite. Restoring
 * removes that record; the existing visibility and placement rules decide where
 * the preserved channel appears. No WAD extraction or source copying is needed.
 */
export function createChannelRecovery(paths) {
  if (typeof paths.readInventory !== 'function')
    throw new Error('Channel recovery requires an inventory reader.');
  let pending = Promise.resolve();
  async function transaction(operation) {
    const file = recoveryFile(paths);
    await mkdir(dirname(file), { recursive: true });
    const lock = `${file}.lock`;
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code === 'EEXIST')
        fail(409, 'CHANNEL_BUSY', 'Another channel recovery command is running.');
      throw error;
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const trash = await readChannelTrash(paths);
      const before = format(trash);
      const result = await operation(trash);
      validateChannelTrash(trash);
      if (format(trash) !== before) {
        await writeFile(temporary, format(trash), { flag: 'wx' });
        await rename(temporary, file);
      }
      return result;
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
  function mutate(operation) {
    const result = pending.then(() => transaction(operation));
    pending = result.catch(() => {});
    return result;
  }
  return {
    delete(id) {
      return mutate(async (trash) => {
        if (id === 'disc') fail(400, 'DISC_FIXED', 'The Disc Channel cannot be deleted.');
        if (!validId(id)) fail(400, 'INVALID_CHANNEL', 'Invalid channel ID.');
        if (trash.deleted.some((record) => record.id === id))
          return { deleted: true, alreadyDeleted: true };
        const catalog = await readInstalledChannelCatalog(paths.assets);
        const channel = catalog.channels.find((entry) => entry.id === id);
        if (!channel) fail(404, 'CHANNEL_NOT_FOUND', 'This channel is not installed.');
        const inventory = await paths.readInventory();
        const item = inventory.channels.find((entry) => entry.id === id);
        if (!item)
          fail(409, 'CHANNEL_CHANGED', 'The channel inventory changed. Reload and try again.');
        if (trash.deleted.length >= maximumRecords)
          fail(409, 'TRASH_FULL', 'Channel Trash has reached its supported limit.');
        trash.deleted.push({
          id,
          title: channel.title,
          source: channel.custom ? 'custom' : 'imported',
          enabled: item.enabled,
          previousSlot: item.slot ?? null,
          deletedAt: new Date().toISOString(),
          identity: channelIdentity(channel),
        });
        return { deleted: true, alreadyDeleted: false };
      });
    },
    restore(id) {
      return mutate(async (trash) => {
        if (!validId(id)) fail(400, 'INVALID_CHANNEL', 'Invalid channel ID.');
        const inventory = await paths.readInventory();
        const index = trash.deleted.findIndex((record) => record.id === id);
        if (index < 0) {
          if (!inventory.channels.some((channel) => channel.id === id))
            fail(404, 'CHANNEL_NOT_FOUND', 'This channel is not in Trash.');
          return { restored: false };
        }
        const catalog = await readInstalledChannelCatalog(paths.assets);
        const condition = await restoreCondition(trash.deleted[index], catalog, paths.assets);
        if (condition.restoreStatus === 'missing-source')
          fail(
            409,
            'SOURCE_UNAVAILABLE',
            'The original channel is missing from the prepared catalog. Prepare or reinstall its original source before restoring.',
          );
        if (condition.restoreStatus === 'id-conflict')
          fail(
            409,
            'CHANNEL_CONFLICT',
            'A different channel now uses this ID. Restore the original source before restoring this Trash entry.',
          );
        if (condition.restoreStatus === 'missing-resources')
          fail(
            409,
            'MISSING_RESOURCES',
            'Original channel resources are missing or unreadable. Repair or prepare them before restoring.',
          );
        trash.deleted.splice(index, 1);
        return { restored: true };
      });
    },
  };
}
