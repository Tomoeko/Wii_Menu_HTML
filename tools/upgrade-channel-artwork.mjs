import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { placeChannelArtwork } from './channel-artwork.mjs';
import { installCustomChannel, readCustomPackage } from './custom-channels.mjs';
import { indexLayout } from '../web/src/animation.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const format = (value) => JSON.stringify(value, null, 2) + '\n';
const white = [255, 255, 255, 255];

/** Only the exact earlier creator output qualifies; authored variations are left intact. */
export function upgradeLegacyArtworkLayout(layout, template, kind, title) {
  if (layout.artwork || layout.imageAnimations) return null;
  const actual = indexLayout(layout).panes;
  const original = actual.get('Artwork');
  const background = actual.get('Background')?.vertexColors?.[0];
  if (!original || !background || layout.textures.length !== 1) return null;
  const texture = layout.textures[0];
  const { width, height } = texture;
  if (texture.name !== `${kind}-artwork` || texture.url !== `${kind}.png`) return null;
  const expected = structuredClone(template);
  const panes = indexLayout(expected).panes;
  const letters = Array.from(title);
  panes.get('Title').text =
    kind === 'icon' && letters.length > 20 ? `${letters.slice(0, 19).join('')}…` : title;
  panes.get('Background').vertexColors = Array.from({ length: 4 }, () => [...background]);
  const luminance = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722;
  const textColor = luminance < 128 ? white : [32, 71, 92, 255];
  for (const name of ['Title', 'Subtitle']) {
    if (panes.has(name)) panes.get(name).textColors = [[...textColor], [...textColor]];
  }
  expected.textures = [{ name: `${kind}-artwork`, url: `${kind}.png`, width, height }];
  expected.materials.push({
    name: `${kind}-artwork`,
    colors: [[0, 0, 0, 0], [...white], [...white]],
    textureMaps: [{ texture: 0, wrapS: 0, wrapT: 0 }],
  });
  const factor = Math.min(60 / width, 60 / height);
  panes.get('Mark').children = [
    {
      name: 'Artwork',
      type: 'pic1',
      flags: 1,
      origin: 4,
      alpha: 255,
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1],
      size: [width * factor, height * factor],
      children: [],
      material: 1,
      vertexColors: Array.from({ length: 4 }, () => [...white]),
      texCoords: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
      ],
    },
  ];
  if (!isDeepStrictEqual(layout, expected)) return null;
  const upgraded = structuredClone(layout);
  indexLayout(upgraded).panes.get('Mark').children = [];
  // The earlier creator discarded the accent with its square panes. Reuse its
  // retained background for this new surround instead of inventing a lost color.
  placeChannelArtwork(upgraded, {
    kind,
    width,
    height,
    material: 1,
    accent: background.slice(0, 3),
  });
  return upgraded;
}

async function replaceFile(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function upgradeChannelArtwork(
  directory,
  { assets = join(project, 'web/public/assets') } = {},
) {
  const source = await realpath(directory);
  const lock = join(source, '.artwork-upgrade.lock');
  await mkdir(lock);
  try {
    const before = await readCustomPackage(source);
    const changes = [];
    for (const kind of ['icon', 'banner']) {
      const path = join(source, before.manifest[`${kind}Layout`]);
      if ((await lstat(path)).isSymbolicLink()) continue;
      const bytes = await readFile(path);
      const layout = JSON.parse(bytes);
      const template = JSON.parse(
        await readFile(join(project, `templates/custom-channel/${kind}.json`)),
      );
      const upgraded = upgradeLegacyArtworkLayout(layout, template, kind, before.manifest.title);
      if (upgraded) changes.push({ kind, path, bytes, upgraded });
    }
    if (!changes.length) return { id: before.manifest.id, upgraded: [], backupDirectory: null };
    if ((await readCustomPackage(source)).sha256 !== before.sha256) {
      throw new Error('The channel changed during inspection. Retry after editing is complete.');
    }
    const backup = join(
      dirname(source),
      '.artwork-backups',
      before.manifest.id,
      `${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
    await mkdir(backup, { recursive: true });
    await writeFile(join(backup, 'channel.json'), format(before.manifest));
    for (const change of changes)
      await writeFile(join(backup, `${change.kind}.json`), change.bytes);
    const replaced = [];
    try {
      for (const change of changes) {
        if (!(await readFile(change.path)).equals(change.bytes))
          throw new Error('A source layout changed during the upgrade.');
        await replaceFile(change.path, format(change.upgraded));
        replaced.push(change);
      }
      await installCustomChannel(source, assets);
    } catch (error) {
      for (const change of replaced) await replaceFile(change.path, change.bytes);
      throw error;
    }
    return {
      id: before.manifest.id,
      upgraded: changes.map((change) => change.kind),
      backupDirectory: relative(project, backup),
    };
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log(
      'Usage: node tools/upgrade-channel-artwork.mjs <custom-id-or-directory> [--assets <directory>]',
    );
    return;
  }
  if (args.length !== 1 && (args.length !== 3 || args[1] !== '--assets'))
    throw new Error('Expected a channel ID/directory and optional --assets directory.');
  const source = /^custom-[a-z0-9_-]+$/.test(args[0])
    ? join(project, '.local/custom-channels', args[0])
    : resolve(args[0]);
  const result = await upgradeChannelArtwork(source, args[2] ? { assets: resolve(args[2]) } : {});
  console.log(format(result).trimEnd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
