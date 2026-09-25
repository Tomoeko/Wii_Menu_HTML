import { formatJson } from './format-json.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageMetadata } from './channel-image.mjs';
import { placeChannelArtwork } from './channel-artwork.mjs';
import {
  createChannelRecovery,
  ChannelRecoveryError,
  readInstalledChannelCatalog,
} from './channel-recovery.mjs';
import { readChannelInventory, setChannelEnabled } from './channels.mjs';
import {
  initializeCustomChannel,
  installCustomChannel,
} from './custom-channels.mjs';
import { relativeResource, validateChannelManifest } from './custom-channel-schema.mjs';
import { purgeChannel, recoverPendingChannelPurge } from './channel-purge.mjs';
import { createChannelUpdateService } from './channel-updates.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const format = formatJson;
const maximumMediaBytes = 32 * 1024 * 1024;
const maximumJsonBytes = 2 * 1024 * 1024;
export const CHANNEL_MANAGER_BODY_LIMIT = 56 * 1024 * 1024;

export class ChannelManagerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message) {
  throw new ChannelManagerError(400, 'INVALID_CHANNEL', message);
}

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`Expected an object for ${label}.`);
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    invalid(`Unexpected field in ${label}.`);
  }
  return value;
}

function decodeBase64(value, maximum = maximumMediaBytes) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    invalid('Expected a nonempty base64 file within the upload limit.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximum || bytes.toString('base64') !== value) {
    invalid('Invalid base64 file or file exceeds the upload limit.');
  }
  return bytes;
}

function color(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    invalid('Colors must use #RRGGBB notation.');
  }
  return [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
}

function updateArtwork(layout, kind, colors, image) {
  const background = color(colors.background, [240, 249, 253]);
  const accent = color(colors.accent, [0, 169, 220]);
  const visit = (pane) => {
    if (pane.name === 'Background')
      pane.vertexColors = Array.from({ length: 4 }, () => [...background, 255]);
    if (pane.name.startsWith('Tile'))
      pane.vertexColors = Array.from({ length: 4 }, () => [...accent, 255]);
    if (pane.name === 'Title' || pane.name === 'Subtitle') {
      const luminance = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722;
      const textColor = luminance < 128 ? [255, 255, 255, 255] : [32, 71, 92, 255];
      pane.textColors = [textColor, [...textColor]];
    }
    pane.children.forEach(visit);
  };
  visit(layout.root);
  if (!image) return;
  const { width, height, extension } = image;
  const texture = layout.textures.length;
  const material = layout.materials.length;
  layout.textures.push({ name: `${kind}-artwork`, url: `${kind}.${extension}`, width, height });
  layout.materials.push({
    name: `${kind}-artwork`,
    colors: [
      [0, 0, 0, 0],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ],
    textureMaps: [{ texture, wrapS: 0, wrapT: 0 }],
  });
  placeChannelArtwork(layout, { kind, width, height, material, accent });
}

function normalizeCreation(value) {
  object(value, ['title', 'id', 'colors', 'icon', 'banner', 'audio'], 'channel');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 80) {
    invalid('Enter a channel title of 1–80 characters.');
  }
  const title = value.title.trim();
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 36) || 'channel';
  const id = value.id ?? `custom-${slug}-${randomUUID().slice(0, 8)}`;
  validateChannelManifest({
    schemaVersion: 1,
    id,
    title,
    iconLayout: 'icon.json',
    bannerLayout: 'banner.json',
  });
  const colors = object(value.colors ?? {}, ['background', 'accent'], 'colors');
  color(colors.background);
  color(colors.accent);
  const images = {};
  let total = 0;
  for (const kind of ['icon', 'banner']) {
    if (value[kind] === undefined) continue;
    object(value[kind], ['base64'], `${kind} artwork`);
    const bytes = decodeBase64(value[kind].base64);
    total += bytes.length;
    images[kind] = { bytes, ...imageMetadata(bytes, { decode: false }) };
  }
  const audio = object(value.audio ?? { kind: 'example' }, ['kind', 'base64'], 'audio');
  if (!['example', 'none', 'upload'].includes(audio.kind))
    invalid('Choose example, none, or upload audio.');
  if (audio.kind !== 'upload' && audio.base64 !== undefined)
    invalid('Only uploaded audio accepts a file.');
  const audioBytes = audio.kind === 'upload' ? decodeBase64(audio.base64) : null;
  total += audioBytes?.length ?? 0;
  if (total > maximumMediaBytes) invalid('Combined channel media exceeds 32 MiB.');
  return { id, title, colors, images, audio: audio.kind, audioBytes };
}

function normalizeImport(value) {
  object(value, ['files'], 'channel folder');
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 260) {
    invalid('A channel folder must contain 1–260 files.');
  }
  const names = new Set();
  let mediaBytes = 0;
  let totalBytes = 0;
  const files = value.files.map((file) => {
    object(file, ['path', 'base64'], 'file');
    relativeResource(file.path, 'file path');
    const extension = extname(file.path).toLowerCase();
    if (
      !['.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.wav', '.md'].includes(extension)
    ) {
      invalid(
        'Channel folders may contain only JSON, PNG, JPEG, GIF, SVG, WAV, and Markdown files.',
      );
    }
    const name = file.path.toLowerCase();
    if (names.has(name)) invalid('Duplicate or case-colliding file paths are not allowed.');
    names.add(name);
    const bytes =
      extension === '.md' && file.base64 === ''
        ? Buffer.alloc(0)
        : decodeBase64(
            file.base64,
            ['.json', '.md'].includes(extension) ? maximumJsonBytes : maximumMediaBytes,
          );
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.wav'].includes(extension))
      mediaBytes += bytes.length;
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(extension))
      imageMetadata(bytes, { decode: false });
    totalBytes += bytes.length;
    return { path: file.path, bytes };
  });
  if (!files.some((file) => file.path === 'channel.json'))
    invalid('Choose a folder with channel.json at its root.');
  if (mediaBytes > maximumMediaBytes || totalBytes > CHANNEL_MANAGER_BODY_LIMIT) {
    invalid('Channel folder exceeds the upload limit (32 MiB of media).');
  }
  return files;
}

function publicError(error) {
  if (error instanceof ChannelManagerError || error instanceof ChannelRecoveryError) return error;
  if (['CHANNEL_BUSY', 'CHANNEL_CONFLICT'].includes(error.code)) {
    return new ChannelManagerError(409, error.code, error.message);
  }
  // Filesystem diagnostics can contain private paths. Keep those local, while
  // still returning useful declarative-schema messages for malformed packages.
  const message =
    error.code || /(?:\/|\\)[^\s]+(?:\/|\\)/.test(error.message)
      ? 'The local channel files could not be read or written. Check the package and local folder permissions.'
      : error.message;
  return new ChannelManagerError(400, 'INVALID_CHANNEL', message);
}

export function createChannelManager(options = {}) {
  const paths = {
    assets: join(project, 'web/public/assets'),
    configFile: join(project, 'config.json'),
    layoutFile: join(project, '.local/channel-layout.json'),
    localDirectory: join(project, '.local'),
    ...options,
  };
  let pending = Promise.resolve();
  let startup;
  const updates = createChannelUpdateService(paths);
  function ready() {
    startup ??= recoverPendingChannelPurge(paths).then(() => updates.initialize()).catch((error) => {
      startup = undefined;
      throw error;
    });
    return startup;
  }
  const inventory = async () => {
    await ready();
    return { schemaVersion: 1, ...(await readChannelInventory(paths)) };
  };
  const recovery = createChannelRecovery({ ...paths, readInventory: inventory });
  function mutate(operation) {
    // Serialize this server's writes. The installer's filesystem lock also
    // protects the shared catalog against a simultaneous CLI installation.
    const next = pending.then(ready).then(operation).catch((error) => {
      throw publicError(error);
    });
    pending = next.catch(() => {});
    return next;
  }
  async function install(populate, { idempotent = false } = {}) {
    await inventory();
    const parent = join(paths.localDirectory, 'custom-channels');
    await mkdir(parent, { recursive: true });
    const staging = await mkdtemp(join(parent, '.staging-'));
    const source = join(staging, 'package');
    try {
      await populate(source);
      const manifest = validateChannelManifest(
        JSON.parse(await readFile(join(source, 'channel.json'), 'utf8')),
      );
      const result = await installCustomChannel(source, paths.assets, {
        replace: false,
        idempotent,
        sourceDestination: join(parent, manifest.id),
        localDirectory: paths.localDirectory,
      });
      const current = await inventory();
      return {
        installed: result.installed,
        ...(result.repaired ? { repaired: true } : {}),
        channel:
          current.channels.find((channel) => channel.id === manifest.id) ??
          current.deleted.find((channel) => channel.id === manifest.id),
        inventory: current,
        authoringDirectory: `.local/custom-channels/${manifest.id}`,
        reloadRequired: true,
      };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return {
    inventory: () => pending.then(inventory),
    delete(id, value = {}) {
      return mutate(async () => {
        object(value, [], 'channel recovery');
        const result = await recovery.delete(id);
        const current = await inventory();
        return {
          ...result,
          channel: current.deleted.find((channel) => channel.id === id),
          inventory: current,
          reloadRequired: true,
        };
      });
    },
    restore(id, value = {}) {
      return mutate(async () => {
        object(value, [], 'channel recovery');
        const result = await recovery.restore(id);
        const current = await inventory();
        return {
          ...result,
          channel: current.channels.find((channel) => channel.id === id),
          inventory: current,
          reloadRequired: true,
        };
      });
    },
    purge(id, value = {}) {
      return mutate(async () => {
        object(value, [], 'channel purge');
        const result = await purgeChannel(paths, id);
        return {
          ...result,
          inventory: await inventory(),
          reloadRequired: true,
        };
      });
    },
    setEnabled(id, value) {
      return mutate(async () => {
        object(value, ['enabled'], 'visibility');
        if (![true, false, null].includes(value.enabled))
          invalid('Enabled must be true, false, or null.');
        const channel = await setChannelEnabled(id, value.enabled, paths);
        return { channel, inventory: await inventory(), reloadRequired: true };
      });
    },
    create(value) {
      return mutate(async () => {
        const creation = normalizeCreation(value);
        return install(async (source) => {
          const manifest = await initializeCustomChannel(source, creation);
          if (creation.audio === 'none') {
            delete manifest.audio;
            await rm(join(source, 'sound.wav'));
          } else if (creation.audioBytes)
            await writeFile(join(source, 'sound.wav'), creation.audioBytes);
          await writeFile(join(source, 'channel.json'), format(manifest));
          for (const kind of ['icon', 'banner']) {
            const file = join(source, `${kind}.json`);
            const layout = JSON.parse(await readFile(file, 'utf8'));
            updateArtwork(layout, kind, creation.colors, creation.images[kind]);
            await writeFile(file, format(layout));
            if (creation.images[kind])
              await writeFile(
                join(source, `${kind}.${creation.images[kind].extension}`),
                creation.images[kind].bytes,
              );
          }
        });
      });
    },
    installExample(value = {}) {
      return mutate(async () => {
        object(value, [], 'example request');
        return install(
          (source) =>
            initializeCustomChannel(source, {
              id: 'custom-example',
              title: 'Example Channel',
            }),
          { idempotent: true },
        );
      });
    },
    importFolder(value) {
      return mutate(async () => {
        const files = normalizeImport(value);
        return install(async (source) => {
          await mkdir(source);
          for (const file of files) {
            const destination = join(source, file.path);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, file.bytes, { flag: 'wx' });
          }
        });
      });
    },
    scanUpdates(value) {
      return mutate(async () => {
        object(value, ['nandPath', 'nandKeysPath'], 'NAND comparison');
        try {
          return await updates.scan(value);
        } catch (error) {
          if (/^Enter a valid local/.test(error.message)) throw error;
          throw new ChannelManagerError(
            400,
            'NAND_SCAN_FAILED',
            'Could not scan this NAND. Check the path, keys and source files, then try again.',
          );
        }
      });
    },
    applyUpdates(value) {
      return mutate(async () => {
        object(value, ['sessionId', 'replaceIds', 'installNewIds'], 'NAND selection');
        const result = await updates.apply(value);
        return { ...result, inventory: await inventory() };
      });
    },
  };
}

async function readRequest(req, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    invalid('Send an application/json request.');
  }
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw new ChannelManagerError(
      413,
      'REQUEST_TOO_LARGE',
      'Channel upload exceeds the request limit.',
    );
  }
  let size = 0;
  const chunks = [];
  // Drain excess data without retaining it, so an oversized chunked request can
  // receive a JSON error instead of an abruptly destroyed socket.
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit)
    throw new ChannelManagerError(
      413,
      'REQUEST_TOO_LARGE',
      'Channel upload exceeds the request limit.',
    );
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(body);
  } catch {
    invalid('Request body is not valid JSON.');
  }
}

/** Returns false for paths owned by another server route. */
export async function handleChannelManagerRequest(
  req,
  res,
  { pathname, port, manager, bodyLimit = CHANNEL_MANAGER_BODY_LIMIT },
) {
  if (pathname !== '/api/channels' && !pathname.startsWith('/api/channels/')) return false;
  const send = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
      throw new ChannelManagerError(403, 'LOCAL_HOST_REQUIRED', 'Local host required.');
    }
    if (req.method === 'GET' && pathname === '/api/channels') {
      send(200, await manager.inventory());
      return true;
    }
    const enabled = /^\/api\/channels\/([a-zA-Z0-9_-]{1,64})\/enabled$/.exec(pathname);
    const recovery = /^\/api\/channels\/([a-zA-Z0-9_-]{1,64})\/(delete|restore|purge)$/.exec(pathname);
    const create = ['custom', 'example', 'import'].find(
      (route) => pathname === `/api/channels/${route}`,
    );
    const update = ['scan', 'apply'].find(
      (route) => pathname === `/api/channels/updates/${route}`,
    );
    if (!(enabled && req.method === 'PUT') &&
        !((create || recovery || update) && req.method === 'POST')) {
      throw new ChannelManagerError(
        405,
        'METHOD_NOT_ALLOWED',
        'This channel route or method is not supported.',
      );
    }
    if (req.headers.origin !== `http://${req.headers.host}`) {
      throw new ChannelManagerError(
        403,
        'INVALID_ORIGIN',
        'Channel changes require the local page origin.',
      );
    }
    const body = await readRequest(
      req,
      enabled || recovery || create === 'example' || update
        ? Math.min(update ? 16 * 1024 : 4096, bodyLimit)
        : bodyLimit,
    );
    let result;
    if (enabled) result = await manager.setEnabled(enabled[1], body);
    else if (recovery) result = await manager[recovery[2]](recovery[1], body);
    else if (update === 'scan') result = await manager.scanUpdates(body);
    else if (update === 'apply') result = await manager.applyUpdates(body);
    else if (create === 'custom') result = await manager.create(body);
    else if (create === 'example') result = await manager.installExample(body);
    else result = await manager.importFolder(body);
    send(enabled || recovery || update || result.installed === false ? 200 : 201, result);
  } catch (error) {
    const failure = publicError(error);
    send(failure.status, { error: { code: failure.code, message: failure.message } });
  }
  return true;
}
