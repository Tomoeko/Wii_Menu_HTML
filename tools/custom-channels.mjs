import { formatJson } from './format-json.mjs';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  relativeResource,
  validateChannelLayout,
  validateChannelManifest,
} from './custom-channel-schema.mjs';
import { createExampleAudio } from './custom-channel-audio.mjs';
import { imageMetadata, encodeRgbaPng } from './channel-image.mjs';
import { mergeChannelCatalog } from '../web/src/channel-catalog.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const defaultAssets = join(project, 'web/public/assets');
const template = join(project, 'templates/custom-channel');
const catalogName = 'custom-channels.json';
const maximumBytes = 32 * 1024 * 1024;
const format = formatJson;

async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, format(value));
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readJson(file) {
  if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error(`JSON file too large: ${file}`);
  return JSON.parse(await readFile(file, 'utf8'));
}

async function containedFile(directory, resource) {
  relativeResource(resource);
  const file = await realpath(join(directory, resource));
  const inside = relative(directory, file);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw new Error(`Resource leaves the channel package: ${resource}`);
  }
  if (!(await stat(file)).isFile()) throw new Error(`Expected file: ${resource}`);
  return file;
}

function wavMetadata(bytes) {
  if (
    bytes.length < 44 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Audio must be a PCM RIFF/WAVE file.');
  }
  let format, dataBytes;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw new Error('Truncated WAV chunk.');
    const type = bytes.toString('ascii', offset, offset + 4);
    if (type === 'fmt ' && size >= 16) {
      format = {
        encoding: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12),
        bits: bytes.readUInt16LE(start + 14),
      };
    }
    if (type === 'data') dataBytes = size;
    offset = start + size + (size & 1);
  }
  if (
    !format ||
    !dataBytes ||
    format.encoding !== 1 ||
    ![1, 2].includes(format.channels) ||
    ![8, 16, 24, 32].includes(format.bits) ||
    format.sampleRate < 8000 ||
    format.sampleRate > 192000 ||
    format.blockAlign !== (format.channels * format.bits) / 8 ||
    format.byteRate !== format.sampleRate * format.blockAlign ||
    dataBytes % format.blockAlign !== 0
  ) {
    throw new Error('Expected mono/stereo PCM WAV, 8–192 kHz, with valid sample alignment.');
  }
  const samples = dataBytes / format.blockAlign;
  return {
    channels: format.channels,
    sampleRate: format.sampleRate,
    samples,
    duration: samples / format.sampleRate,
  };
}

export async function readCustomPackage(directory) {
  const root = await realpath(directory);
  const manifest = validateChannelManifest(
    await readJson(await containedFile(root, 'channel.json')),
  );
  const files = new Map();
  const originalFiles = new Map();
  const originalLayouts = {};
  let totalBytes = 0;
  let decodedImageBytes = 0;
  async function resource(path) {
    if (path.split('/')[0].toLowerCase() === '.generated') {
      throw new Error('The .generated resource directory is reserved for decoded GIF frames.');
    }
    if (files.has(path)) return files.get(path);
    const file = await containedFile(root, path);
    totalBytes += (await stat(file)).size;
    if (totalBytes > maximumBytes) throw new Error('Channel resources exceed 32 MiB.');
    const bytes = await readFile(file);
    files.set(path, bytes);
    originalFiles.set(path, bytes);
    return bytes;
  }
  const layouts = {};
  for (const kind of ['icon', 'banner']) {
    const file = await containedFile(root, manifest[`${kind}Layout`]);
    layouts[kind] = validateChannelLayout(await readJson(file), kind);
    const layout = layouts[kind];
    originalLayouts[kind] = structuredClone(layout);
    const originals = [...layout.textures];
    for (const [textureIndex, texture] of originals.entries()) {
      const metadata = imageMetadata(await resource(texture.url));
      decodedImageBytes +=
        metadata.width * metadata.height * 4 * (metadata.decoded?.frames.length ?? 1);
      if (decodedImageBytes > 128 * 1024 * 1024) {
        throw new Error('Channel artwork exceeds 128 MiB of decoded pixels.');
      }
      if (texture.width !== metadata.width || texture.height !== metadata.height) {
        throw new Error(`Texture dimensions do not match image: ${texture.url}`);
      }
      if (metadata.format !== 'gif') continue;
      const animation = {
        texture: textureIndex,
        frames: [],
        repetitions: metadata.decoded.repetitions,
      };
      for (const [frameIndex, frame] of metadata.decoded.frames.entries()) {
        const path = `.generated/${kind}-${textureIndex}-${frameIndex}.png`;
        if (files.has(path)) throw new Error('Generated animation path conflicts with a resource.');
        const png = encodeRgbaPng(metadata.width, metadata.height, frame.rgba);
        totalBytes += png.length;
        if (totalBytes > maximumBytes)
          throw new Error('Channel resources exceed 32 MiB after GIF conversion.');
        files.set(path, png);
        const descriptor = { ...texture, name: `${texture.name}-frame-${frameIndex}`, url: path };
        const index = frameIndex === 0 ? textureIndex : layout.textures.length;
        if (frameIndex === 0) layout.textures[index] = descriptor;
        else layout.textures.push(descriptor);
        animation.frames.push({ texture: index, durationMs: frame.durationMs });
      }
      (layout.imageAnimations ??= []).push(animation);
    }
    validateChannelLayout(layout, kind);
  }
  let audio;
  if (manifest.audio) {
    audio = { ...manifest.audio, ...wavMetadata(await resource(manifest.audio.src)) };
    if ((audio.loopStart ?? 0) >= audio.duration || (audio.loopEnd ?? 0) > audio.duration) {
      throw new Error('Audio loop points are outside the WAV duration.');
    }
  }
  function fingerprint(layoutValues, resources) {
    const hash = createHash('sha256');
    hash.update(format({ manifest, layouts: layoutValues }));
    for (const [path, bytes] of [...resources].sort(([a], [b]) => a.localeCompare(b))) {
      hash.update(path);
      hash.update(bytes);
    }
    return hash.digest('hex');
  }
  return {
    manifest,
    layouts,
    files,
    audio,
    // Recovery identity follows authored bytes; generated PNG compression may
    // change between Node versions without representing an author's change.
    sha256: fingerprint(originalLayouts, originalFiles),
    compiledSha256: fingerprint(layouts, files),
  };
}

export async function readCustomCatalog(assets = defaultAssets) {
  try {
    const catalog = await readJson(join(assets, catalogName));
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.channels)) {
      throw new Error('Unsupported custom channel catalog.');
    }
    mergeChannelCatalog({ channels: [], defaultOrder: [] }, catalog);
    return catalog;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, channels: [] };
    throw error;
  }
}

function publicationDirectory(assets, localDirectory) {
  if (localDirectory) return resolve(localDirectory);
  return resolve(assets) === resolve(defaultAssets)
    ? join(project, '.local')
    : join(dirname(resolve(assets)), '.local');
}

async function withPreparationLock(assets, localDirectory, operation) {
  const lock = join(publicationDirectory(assets, localDirectory), '.prepare-lock');
  await mkdir(dirname(lock), { recursive: true });
  try {
    // Python preparation holds this path as an advisory-lock file; channel
    // publication owns a directory. Neither writer removes another's lock.
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw Object.assign(new Error('Another asset preparation or channel command is running.'), {
        code: 'CHANNEL_BUSY',
      });
    }
    throw error;
  }
  try {
    await writeFile(join(lock, 'custom-owner.json'), format({ version: 1, pid: process.pid }));
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function updateCatalog(assets, update, rollback = async () => {}) {
  await mkdir(assets, { recursive: true });
  const lock = join(assets, '.custom-channels.lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw Object.assign(new Error('Another custom-channel command is running.'), {
        code: 'CHANNEL_BUSY',
      });
    }
    throw error;
  }
  try {
    const catalog = await readCustomCatalog(assets);
    const previous = format(catalog);
    const result = await update(catalog);
    if (format(catalog) !== previous) await atomicJson(join(assets, catalogName), catalog);
    return result;
  } catch (error) {
    await rollback();
    throw error;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function addCustomChannel(directory, assets = defaultAssets, options = {}) {
  return (await installCustomChannel(directory, assets, options)).channel;
}

/**
 * The CLI may replace an installed version. The browser manager instead uses
 * create-only installation and retains its validated authoring directory as part
 * of the same catalog transaction.
 */
export async function installCustomChannel(
  directory,
  assets = defaultAssets,
  { replace = true, idempotent = false, sourceDestination, localDirectory } = {},
) {
  const prepared = await readCustomPackage(directory);
  const { manifest, layouts, files, audio, sha256, compiledSha256 } = prepared;
  const destination = `custom-channels/${manifest.id}/${compiledSha256.slice(0, 16)}`;
  const output = join(assets, destination);
  const staging = join(assets, 'custom-channels', `.install-${randomUUID()}`);
  const compiled = new Map([...files].map(([path, bytes]) => [`resources/${path}`, bytes]));
  for (const [kind, layout] of Object.entries(layouts)) {
    for (const texture of layout.textures) texture.url = `${destination}/resources/${texture.url}`;
    compiled.set(`${kind}.json`, Buffer.from(format(layout)));
  }
  async function generatedFilesMatch() {
    for (const [path, bytes] of compiled) {
      try {
        if (!(await readFile(join(output, path))).equals(bytes)) return false;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    }
    return true;
  }
  let outputCreated = false;
  let sourceMoved = false;
  const conflict = (message) => Object.assign(new Error(message), { code: 'CHANNEL_CONFLICT' });
  async function retainSource(allowExisting = false) {
    if (!sourceDestination) return;
    const existing = await lstat(sourceDestination).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) {
      if (
        allowExisting &&
        !existing.isSymbolicLink() &&
        (await readCustomPackage(sourceDestination)).sha256 === sha256
      )
        return;
      throw conflict('An authoring folder already uses this ID. Choose another ID.');
    }
    await mkdir(dirname(sourceDestination), { recursive: true });
    await rename(directory, sourceDestination);
    sourceMoved = true;
  }
  return withPreparationLock(assets, localDirectory, () => updateCatalog(
    assets,
    async (catalog) => {
      const previous = catalog.channels.findIndex((channel) => channel.id === manifest.id);
      const matchingInstall =
        previous >= 0 &&
        !replace &&
        idempotent &&
        catalog.channels[previous].source?.sha256 === sha256;
      if (previous >= 0 && !replace) {
        const entry = catalog.channels[previous];
        if (matchingInstall) {
          await retainSource(true);
          const currentPaths =
            entry.iconLayout === `${destination}/icon.json` &&
            entry.bannerLayout === `${destination}/banner.json` &&
            entry.audio?.src ===
              (audio ? `/assets/${destination}/resources/${audio.src}` : undefined);
          if (currentPaths && (await generatedFilesMatch()))
            return { channel: entry, installed: false };
        } else {
          throw conflict('A channel already uses this ID. Choose another ID.');
        }
      }
      let nativeCatalog;
      try {
        nativeCatalog = await readJson(join(assets, 'channels.json'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        nativeCatalog = { channels: [] };
      }
      if (nativeCatalog.channels.some((channel) => channel.id === manifest.id)) {
        throw conflict('An imported channel already uses this ID.');
      }
      if (previous < 0 && nativeCatalog.channels.length + catalog.channels.length >= 2048) {
        throw conflict('The channel catalog has reached its supported limit.');
      }
      if (!matchingInstall) await retainSource();
      await mkdir(staging, { recursive: true });
      // Only validated resource bytes are copied. Authored scripts, HTML and
      // unrelated files in a package never become executable web content.
      for (const [path, bytes] of compiled) {
        const file = join(staging, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
      }
      await mkdir(dirname(output), { recursive: true });
      if (
        !(await lstat(output).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }))
      ) {
        await rename(staging, output);
        outputCreated = true;
      } else {
        // A same-hash folder may be incomplete after manual cleanup. Each
        // replacement is an atomic rename of validated, identical source data.
        // Existing unrelated files are preserved; no live file is truncated.
        for (const path of compiled.keys()) {
          await mkdir(dirname(join(output, path)), { recursive: true });
          await rename(join(staging, path), join(output, path));
        }
      }
      await rm(staging, { recursive: true, force: true });
      const entry = {
        id: manifest.id,
        shortId: 'CUSTOM',
        title: manifest.title,
        custom: true,
        iconLayout: `${destination}/icon.json`,
        bannerLayout: `${destination}/banner.json`,
        source: { kind: 'declarative-custom-channel', sha256 },
      };
      if (audio) entry.audio = { ...audio, src: `/assets/${destination}/resources/${audio.src}` };
      if (previous < 0) catalog.channels.push(entry);
      else catalog.channels[previous] = entry;
      return {
        channel: entry,
        installed: !matchingInstall,
        ...(matchingInstall ? { repaired: true } : {}),
      };
    },
    async () => {
      await rm(staging, { recursive: true, force: true });
      if (outputCreated) await rm(output, { recursive: true, force: true });
      if (sourceMoved) await rename(sourceDestination, directory);
    },
  ));
}

export async function removeCustomChannel(id, assets = defaultAssets, { localDirectory } = {}) {
  return withPreparationLock(assets, localDirectory, () => updateCatalog(assets, (catalog) => {
    const index = catalog.channels.findIndex((channel) => channel.id === id);
    if (index < 0) throw new Error(`Custom channel is not installed: ${id}`);
    return catalog.channels.splice(index, 1)[0];
  }));
}

export async function initializeCustomChannel(directory, { id, title } = {}) {
  const slug = basename(resolve(directory))
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  const manifest = await readJson(join(template, 'channel.json'));
  manifest.id = id ?? `custom-${slug.slice(0, 56)}`;
  manifest.title = title ?? 'My Channel';
  manifest.audio = { src: 'sound.wav', loop: false };
  validateChannelManifest(manifest);
  // A new directory makes this command safe to rerun accidentally: it never
  // replaces an author's existing artwork or layout files.
  await mkdir(directory, { recursive: false });
  await writeFile(join(directory, 'channel.json'), format(manifest));
  await writeFile(join(directory, 'sound.wav'), createExampleAudio());
  for (const name of ['icon.json', 'banner.json']) {
    const layout = await readJson(join(template, name));
    const visit = (pane) => {
      if (pane.name === 'Title') {
        const letters = Array.from(manifest.title);
        pane.text =
          name === 'icon.json' && letters.length > 20
            ? `${letters.slice(0, 19).join('')}…`
            : manifest.title;
      }
      pane.children.forEach(visit);
    };
    visit(layout.root);
    await writeFile(join(directory, name), format(layout));
  }
  await copyFile(join(template, 'README.md'), join(directory, 'README.md'));
  return manifest;
}

const help = `Custom channel authoring (local files only)

  node tools/custom-channels.mjs init <new-directory> [--id custom-slug] [--title "My Channel"]
  node tools/custom-channels.mjs validate <directory>
  node tools/custom-channels.mjs add <directory> [--assets <output-directory>] [--local-dir <private-directory>]
  node tools/custom-channels.mjs list [--assets <output-directory>]
  node tools/custom-channels.mjs remove <custom-id> [--assets <output-directory>] [--local-dir <private-directory>]

Edit channel.json, icon.json and banner.json, then run add again to update.
Reload the browser after catalog changes. See docs/custom-channels.md.
`;

async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') {
    console.log(help);
    return;
  }
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const argument = rest[i];
    if (argument.startsWith('--')) {
      if (
        !['--assets', '--local-dir', '--id', '--title'].includes(argument) ||
        !rest[i + 1] ||
        rest[i + 1].startsWith('--')
      )
        throw new Error(`Invalid option: ${argument}`);
      options[argument.slice(2)] = rest[++i];
    } else positional.push(argument);
  }
  if (!['init', 'validate', 'add', 'list', 'remove'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (positional.length !== (command === 'list' ? 0 : 1)) throw new Error(help);
  const allowed = {
    init: ['id', 'title'],
    validate: [],
    add: ['assets', 'local-dir'],
    list: ['assets'],
    remove: ['assets', 'local-dir'],
  }[command];
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new Error(`--${key} is not supported by ${command}`);
  }
  const assets = options.assets ? resolve(options.assets) : defaultAssets;
  const publication = {
    localDirectory: options['local-dir'] ? resolve(options['local-dir']) : join(project, '.local'),
  };
  let result;
  if (command === 'init') result = await initializeCustomChannel(positional[0], options);
  if (command === 'validate') {
    const prepared = await readCustomPackage(positional[0]);
    result = { id: prepared.manifest.id, valid: true, sha256: prepared.sha256 };
  }
  if (command === 'add') result = await addCustomChannel(positional[0], assets, publication);
  if (command === 'list') result = (await readCustomCatalog(assets)).channels;
  if (command === 'remove') result = await removeCustomChannel(positional[0], assets, publication);
  console.log(format(result).trimEnd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
