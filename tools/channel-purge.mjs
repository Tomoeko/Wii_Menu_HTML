import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  ChannelRecoveryError,
  channelIdentity,
  readChannelTrash,
  readInstalledChannelCatalog,
} from './channel-recovery.mjs';
import { validateChannelArrangement } from '../web/src/channel-storage.js';
import { formatJson } from './format-json.mjs';

const format = formatJson;
const journalName = 'channel-purge.json';
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)
  && !['disc', '0000000100000002', '__proto__', 'prototype', 'constructor'].includes(id);

function failure(code, message, status = 409) {
  return new ChannelRecoveryError(status, code, message);
}

async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function safePath(root, path) {
  const inside = relative(resolve(root), resolve(path));
  if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw failure('UNSAFE_CHANNEL_PATH', 'Channel resources must stay inside managed storage.');
  }
  const components = inside.split(sep);
  let current = root;
  for (const component of ['', ...components]) {
    current = component ? join(current, component) : current;
    if ((await exists(current))?.isSymbolicLink()) {
      throw failure('UNSAFE_CHANNEL_PATH', 'Channel removal refuses symbolic links.');
    }
  }
  return path;
}

async function durableWrite(file, bytes) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function metadataFiles(paths) {
  return {
    native: join(paths.assets, 'channels.json'),
    custom: join(paths.assets, 'custom-channels.json'),
    audio: join(paths.assets, 'channel-audio.json'),
    prepare: join(paths.localDirectory, 'prepare.json'),
    config: paths.configFile,
    arrangement: paths.layoutFile,
    trash: paths.trashFile ?? join(paths.localDirectory, 'channel-trash.json'),
  };
}

function resourceFiles(paths, id, source) {
  if (source === 'custom') {
    return [
      [paths.assets, join(paths.assets, 'custom-channels', id)],
      [paths.localDirectory, join(paths.localDirectory, 'custom-channels', id)],
    ];
  }
  const resources = [
    [paths.assets, join(paths.assets, 'channel-layouts', id)],
    [paths.assets, join(paths.assets, 'channel-audio', `${id}.wav`)],
  ];
  if (/^[a-f0-9]{16}$/.test(id)) {
    resources.push(
      [paths.localDirectory, join(paths.localDirectory, 'titles', id)],
      [paths.localDirectory, join(paths.localDirectory, 'nand-titles', id)],
      [paths.localDirectory, join(paths.localDirectory, 'channel-tree', 'title',
        id.slice(0, 8), id.slice(8))],
    );
  }
  return resources;
}

async function readMetadata(file, fallback, maximumBytes = 8 * 1024 * 1024) {
  await safePath(dirname(file), file);
  const status = await exists(file);
  if (!status) return { before: null, value: structuredClone(fallback) };
  if (!status.isFile() || status.size > maximumBytes) {
    throw failure('INVALID_CHANNEL_STATE', 'Channel state must be a readable, bounded JSON file.');
  }
  const before = await readFile(file, 'utf8');
  return { before, value: JSON.parse(before) };
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function withLocks(paths, operation) {
  const files = metadataFiles(paths);
  const locks = [
    join(paths.localDirectory, '.channel-purge.lock'),
    join(paths.localDirectory, '.prepare-lock'),
    join(paths.assets, '.custom-channels.lock'),
    `${files.trash}.lock`,
    `${paths.configFile}.channels.lock`,
    `${paths.layoutFile}.lock`,
  ];
  const held = [];
  try {
    for (const lock of locks) {
      await safePath(dirname(lock), lock);
      await mkdir(dirname(lock), { recursive: true });
      if (await exists(lock)) {
        let owner;
        try {
          owner = JSON.parse(await readFile(join(lock, 'purge-owner.json'), 'utf8'));
        } catch {
          throw failure('CHANNEL_BUSY', 'Another channel command is running.');
        }
        if (processAlive(owner.pid)) {
          throw failure('CHANNEL_BUSY', 'Another channel command is running.');
        }
        await rm(lock, { recursive: true });
      }
      await mkdir(lock);
      held.push(lock);
      await durableWrite(join(lock, 'purge-owner.json'), format({ pid: process.pid }));
    }
    return await operation();
  } finally {
    for (const lock of held.reverse()) await rm(lock, { recursive: true, force: true });
  }
}

function stringReferences(value, output = []) {
  if (typeof value === 'string') output.push(value.replace(/^\/assets\//, ''));
  else if (Array.isArray(value)) value.forEach((item) => stringReferences(item, output));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => stringReferences(item, output));
  }
  return output;
}

async function buildPlan(paths, id) {
  if (id === 'disc' || id === '0000000100000002') {
    throw failure('DISC_FIXED', 'The built-in System Menu cannot be permanently deleted.', 400);
  }
  if (!validId(id)) throw failure('INVALID_CHANNEL', 'Invalid channel ID.', 400);
  const trash = await readChannelTrash(paths);
  const record = trash.deleted.find((entry) => entry.id === id);
  if (!record) throw failure('CHANNEL_NOT_FOUND', 'This channel is not in Trash.', 404);
  const catalog = await readInstalledChannelCatalog(paths.assets);
  const channel = catalog.channels.find((entry) => entry.id === id);
  if (channel && (channelIdentity(channel) !== record.identity
      || Boolean(channel.custom) !== (record.source === 'custom'))) {
    throw failure('CHANNEL_CONFLICT', 'A different channel now uses this ID. Its files were preserved.');
  }
  const files = metadataFiles(paths);
  const updates = {};
  async function update(role, fallback, change) {
    const item = await readMetadata(files[role], fallback);
    change(item.value);
    const after = format(item.value);
    if (after !== item.before) updates[role] = { before: item.before, after };
  }
  await update(record.source === 'custom' ? 'custom' : 'native',
    { schemaVersion: 1, channels: [], defaultOrder: [] }, (value) => {
      if (!Array.isArray(value.channels)) throw new Error('Invalid channel catalog.');
      value.channels = value.channels.filter((entry) => entry.id !== id);
      if (Array.isArray(value.defaultOrder)) {
        value.defaultOrder = value.defaultOrder.filter((entry) => entry !== id);
      }
      if (Array.isArray(value.savedLayout?.slots)) {
        value.savedLayout.slots = value.savedLayout.slots.map((slot) =>
          slot?.id === id ? { ...slot, id: null } : slot);
      }
    });
  if (record.source === 'imported') {
    await update('audio', {}, (value) => { delete value[id]; });
    await update('prepare', {
      schemaVersion: 1, menu: null, channels: {}, removedChannels: [], language: 'ENG',
    }, (value) => {
      if (!value.channels || !Array.isArray(value.removedChannels)) {
        throw new Error('Invalid channel preparation state.');
      }
      delete value.channels[id];
      if (!value.removedChannels.includes(id)) value.removedChannels.push(id);
    });
  }
  if (await exists(files.config)) {
    await update('config', {}, (value) => {
      if (value.channels?.enabled) delete value.channels.enabled[id];
    });
  }
  if (await exists(files.arrangement)) {
    await update('arrangement', null, (value) => {
      validateChannelArrangement(value);
      value.slots = value.slots.map((entry) => entry === id ? null : entry);
      if (value.positions) delete value.positions[id];
    });
  }
  await update('trash', null, (value) => {
    value.deleted = value.deleted.filter((entry) => entry.id !== id);
  });
  const references = [];
  for (const other of catalog.channels.filter((entry) => entry.id !== id)) {
    stringReferences(other, references);
    for (const kind of ['iconLayout', 'bannerLayout']) {
      if (!other[kind]) continue;
      const file = join(paths.assets, other[kind]);
      await safePath(paths.assets, file);
      if (await exists(file)) stringReferences((await readMetadata(file, null)).value, references);
    }
  }
  const moves = [];
  const privateReferences = [];
  if (await exists(files.prepare)) {
    const preparation = (await readMetadata(files.prepare, null)).value;
    for (const [title, descriptor] of Object.entries(preparation.channels ?? {})) {
      if (title !== id && typeof descriptor.contentDirectory === 'string') {
        privateReferences.push(resolve(descriptor.contentDirectory));
      }
    }
  }
  const candidates = resourceFiles(paths, id, record.source);
  for (const [index, [root, path]] of candidates.entries()) {
    await safePath(root, path);
    if (!(await exists(path))) continue;
    const resource = relative(paths.assets, path).split(sep).join('/');
    if (root === paths.assets && references.some((value) =>
      value === resource || value.startsWith(resource + '/'))) continue;
    if (root === paths.localDirectory && privateReferences.some((value) =>
      value === resolve(path) || value.startsWith(resolve(path) + sep))) continue;
    moves.push(index);
  }
  return { version: 1, token: randomUUID(), phase: 'prepared', id, source: record.source,
    title: record.title, updates, moves };
}

async function applyJournal(paths, plan, restore) {
  if (plan?.version !== 1 || !validId(plan.id) || !['custom', 'imported'].includes(plan.source)
      || !/^[a-f0-9-]{36}$/.test(plan.token) || !['prepared', 'committed'].includes(plan.phase)) {
    throw failure('INVALID_PURGE_JOURNAL', 'The channel removal recovery journal is invalid.');
  }
  const files = metadataFiles(paths);
  const resources = resourceFiles(paths, plan.id, plan.source);
  if (!Array.isArray(plan.moves) || plan.moves.some((index) => !resources[index])
      || !plan.updates || Object.keys(plan.updates).some((role) => !files[role])) {
    throw failure('INVALID_PURGE_JOURNAL', 'The channel removal recovery journal is invalid.');
  }
  for (const index of plan.moves) {
    const [root, source] = resources[index];
    const quarantined = join(dirname(source), `.purge-${plan.token}-${basename(source)}`);
    await safePath(root, source);
    await safePath(root, quarantined);
    if (restore) {
      if (await exists(quarantined)) {
        if (await exists(source)) throw new Error('Channel recovery destination is occupied.');
        await rename(quarantined, source);
      }
    } else {
      await rm(quarantined, { recursive: true, force: true });
    }
  }
  if (restore) {
    for (const [role, update] of Object.entries(plan.updates)) {
      const file = files[role];
      await safePath(dirname(file), file);
      if (update.before === null) await rm(file, { force: true });
      else if (typeof update.before === 'string') await durableWrite(file, update.before);
      else throw new Error('Invalid channel recovery data.');
    }
  }
  await rm(join(paths.localDirectory, journalName), { force: true });
}

async function recoverUnlocked(paths) {
  const journal = join(paths.localDirectory, journalName);
  if (!(await exists(journal))) return;
  const plan = (await readMetadata(journal, null, 64 * 1024 * 1024)).value;
  await applyJournal(paths, plan, plan.phase !== 'committed');
}

export async function recoverPendingChannelPurge(paths) {
  if (!(await exists(join(paths.localDirectory, journalName)))) return;
  await withLocks(paths, () => recoverUnlocked(paths));
}

export async function purgeChannel(paths, id, { checkpoint = async () => {} } = {}) {
  return withLocks(paths, async () => {
    await recoverUnlocked(paths);
    const plan = await buildPlan(paths, id);
    const journal = join(paths.localDirectory, journalName);
    if (Buffer.byteLength(format(plan)) > 64 * 1024 * 1024) {
      throw failure('INVALID_CHANNEL_STATE', 'Channel removal recovery data exceeds 64 MiB.');
    }
    await durableWrite(journal, format(plan));
    try {
      const resources = resourceFiles(paths, id, plan.source);
      for (const index of plan.moves) {
        const [root, source] = resources[index];
        await safePath(root, source);
        const quarantined = join(dirname(source), `.purge-${plan.token}-${basename(source)}`);
        await rename(source, quarantined);
      }
      await checkpoint('resources-quarantined');
      const files = metadataFiles(paths);
      // Trash is the last metadata update. Until commit, the journal retains
      // every original byte needed to restore a failed or interrupted purge.
      for (const [role, update] of Object.entries(plan.updates)) {
        await durableWrite(files[role], update.after);
        await checkpoint(`metadata-${role}`);
      }
      plan.phase = 'committed';
      await durableWrite(journal, format(plan));
    } catch (error) {
      await applyJournal(paths, plan, true);
      throw error;
    }
    await checkpoint('committed');
    await applyJournal(paths, plan, false);
    return { purged: true, title: plan.title, source: plan.source };
  });
}
