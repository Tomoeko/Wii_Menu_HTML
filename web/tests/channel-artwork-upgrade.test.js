import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initializeCustomChannel,
  installCustomChannel,
  readCustomPackage,
} from '../../tools/custom-channels.mjs';
import { encodeRgbaPng } from '../../tools/channel-image.mjs';
import {
  upgradeChannelArtwork,
  upgradeLegacyArtworkLayout,
} from '../../tools/upgrade-channel-artwork.mjs';
import { indexLayout } from '../src/animation.js';

const json = async (path) => JSON.parse(await readFile(path));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

async function legacyFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-artwork-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'custom-fixture');
  const assets = join(directory, 'assets');
  await initializeCustomChannel(source, { id: 'custom-fixture', title: 'Local Picture' });
  const templates = {};
  for (const kind of ['icon', 'banner']) {
    const file = join(source, `${kind}.json`);
    const layout = await json(file);
    templates[kind] = structuredClone(layout);
    const panes = indexLayout(layout).panes;
    const white = [255, 255, 255, 255];
    layout.textures.push({ name: `${kind}-artwork`, url: `${kind}.png`, width: 2, height: 1 });
    layout.materials.push({
      name: `${kind}-artwork`,
      colors: [[0, 0, 0, 0], white, white],
      textureMaps: [{ texture: 0, wrapS: 0, wrapT: 0 }],
    });
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
        size: [60, 30],
        children: [],
        material: 1,
        vertexColors: [white, white, white, white],
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
    await writeJson(file, layout);
    await writeFile(
      join(source, `${kind}.png`),
      encodeRgbaPng(2, 1, Buffer.from([255, 0, 0, 255, 0, 255, 0, 255])),
    );
  }
  await installCustomChannel(source, assets);
  return { directory, source, assets, templates };
}

test('legacy creator upgrades retain media/title/audio, back up exact layouts and reinstall once', async (t) => {
  const { directory, source, assets } = await legacyFixture(t);
  const before = await readCustomPackage(source);
  const files = await Promise.all(
    ['channel.json', 'icon.png', 'banner.png', 'sound.wav', 'icon.json', 'banner.json'].map(
      async (name) => [name, await readFile(join(source, name))],
    ),
  );
  const result = await upgradeChannelArtwork(source, { assets });
  assert.deepEqual(result.upgraded, ['icon', 'banner']);
  const backups = join(directory, '.artwork-backups/custom-fixture');
  const backup = join(backups, (await readdir(backups))[0]);
  for (const [name, bytes] of files) {
    if (['icon.json', 'banner.json'].includes(name))
      assert.ok((await readFile(join(backup, name))).equals(bytes));
    else assert.ok((await readFile(join(source, name))).equals(bytes));
  }
  const after = await readCustomPackage(source);
  assert.notEqual(after.sha256, before.sha256);
  for (const kind of result.upgraded) {
    const panes = indexLayout(after.layouts[kind]).panes;
    assert.equal(panes.get('Content').flags & 1, 0);
    assert.equal(panes.get('Mark').children.length, 0);
    assert.deepEqual(after.layouts[kind].artwork, { kind, width: 2, height: 1 });
  }
  assert.equal(
    (await json(join(assets, 'custom-channels.json'))).channels[0].source.sha256,
    after.sha256,
  );
  assert.deepEqual((await upgradeChannelArtwork(source, { assets })).upgraded, []);
  assert.equal((await readdir(backups)).length, 1);
});

test('authored placement and animation edits prevent automatic legacy interpretation', async (t) => {
  const { source, templates } = await legacyFixture(t);
  const original = await json(join(source, 'icon.json'));
  assert.ok(upgradeLegacyArtworkLayout(original, templates.icon, 'icon', 'Local Picture'));
  for (const edit of [
    (layout) => {
      indexLayout(layout).panes.get('Artwork').rotation[2] = 10;
    },
    (layout) => {
      layout.animations.icon.targets[0].tracks[0].keys[0].value = -5;
    },
    (layout) => {
      indexLayout(layout).panes.get('Title').text = 'Authored subtitle';
    },
    (layout) => {
      layout.textures[0].url = 'my-artwork.png';
    },
  ]) {
    const changed = structuredClone(original);
    edit(changed);
    assert.equal(
      upgradeLegacyArtworkLayout(changed, templates.icon, 'icon', 'Local Picture'),
      null,
    );
  }
});

test('failed installation restores original source layouts and keeps recovery backups', async (t) => {
  const { directory, source, assets } = await legacyFixture(t);
  const before = await readCustomPackage(source);
  const catalog = await readFile(join(assets, 'custom-channels.json'));
  await mkdir(join(assets, '.custom-channels.lock'));
  await assert.rejects(upgradeChannelArtwork(source, { assets }), /running/);
  assert.equal((await readCustomPackage(source)).sha256, before.sha256);
  assert.ok((await readFile(join(assets, 'custom-channels.json'))).equals(catalog));
  assert.equal((await readdir(join(directory, '.artwork-backups/custom-fixture'))).length, 1);
});
