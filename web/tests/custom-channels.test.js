import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initializeCustomChannel,
  readCustomPackage,
  addCustomChannel,
  readCustomCatalog,
  removeCustomChannel,
} from '../../tools/custom-channels.mjs';
import { validateChannelLayout } from '../../tools/custom-channel-schema.mjs';
import { mergeChannelCatalog } from '../src/channel-catalog.js';
import { reconcileSlots } from '../src/channel-storage.js';
import { poseChannel } from '../src/channel-animation.js';
import { indexLayout } from '../src/animation.js';
import { Renderer } from '../src/renderer.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-custom-channel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'my-channel');
  const assets = join(directory, 'assets');
  await initializeCustomChannel(source, { title: 'Test Channel' });
  return { directory, source, assets };
}

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');

test('authored template uses the production channel animation controller', async (t) => {
  const { source } = await fixture(t);
  const prepared = await readCustomPackage(source);
  const channel = { shortId: 'CUSTOM', ...prepared.layouts };
  const pane = (kind, frame, name) =>
    indexLayout(poseChannel(channel, kind, frame)).panes.get(name);
  assert.equal(pane('banner', 0, 'Content').alpha, 0);
  assert.equal(pane('banner', 15, 'Content').alpha, 127.5);
  assert.equal(pane('banner', 30, 'Content').alpha, 255);
  assert.equal(pane('banner', 120, 'Content').translation[1], 0);
  assert.equal(pane('banner', 30, 'Mark').rotation[2], -6);
  assert.equal(pane('banner', 120, 'Mark').rotation[2], 6);
  assert.equal(pane('icon', 90, 'Mark').rotation[2], 6);
  assert.equal(pane('icon', 180, 'Mark').rotation[2], -6);
  assert.equal(pane('icon', 0, 'Title').text, 'Test Channel');
  assert.equal(prepared.layouts.banner.root.children[1].alpha, 255);
  const drawnAlpha = new Map();
  Renderer.prototype.draw.call(
    { bounds: new Map(), quad() {} },
    poseChannel(channel, 'banner', 15),
    {
      onPane(current, matrix, alpha) {
        drawnAlpha.set(current.name, alpha);
      },
    },
  );
  assert.equal(drawnAlpha.get('Title'), 0.5);
  assert.equal(drawnAlpha.get('Tile1'), 0.5);
  assert.equal(drawnAlpha.get('Background'), 1);
});

test('add, update and remove preserve native catalog, package and saved slots', async (t) => {
  const { source, assets } = await fixture(t);
  await mkdir(assets);
  const native = {
    schemaVersion: 1,
    channels: [{ id: 'native', title: 'Native' }],
    defaultOrder: ['native'],
    savedLayout: { slots: [{ id: 'disc' }, { id: 'native' }] },
  };
  await writeJson(join(assets, 'channels.json'), native);
  const first = await addCustomChannel(source, assets);
  assert.equal(first.id, 'custom-my-channel');
  const manifest = await json(join(source, 'channel.json'));
  manifest.title = 'Updated title';
  await writeJson(join(source, 'channel.json'), manifest);
  const second = await addCustomChannel(source, assets);
  const custom = await readCustomCatalog(assets);
  assert.equal(custom.channels.length, 1);
  assert.equal(custom.channels[0].title, 'Updated title');
  assert.notEqual(first.iconLayout, second.iconLayout);
  const merged = mergeChannelCatalog(native, custom);
  assert.equal(merged.savedLayout, native.savedLayout);
  const slots = reconcileSlots(
    [{ id: 'disc' }, ...merged.channels],
    ['disc', null, first.id, 'native'],
  );
  assert.equal(slots[2].title, 'Updated title');
  assert.equal(slots[3].id, 'native');
  await removeCustomChannel(first.id, assets);
  assert.deepEqual(await json(join(assets, 'channels.json')), native);
  assert.deepEqual((await readCustomCatalog(assets)).channels, []);
  assert.equal((await json(join(source, 'channel.json'))).title, 'Updated title');
  assert.ok(await readFile(join(assets, first.iconLayout)));
});

test('only referenced PNG and PCM WAV resources are installed', async (t) => {
  const { source, assets } = await fixture(t);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  await writeFile(join(source, 'art.png'), image);
  await writeFile(join(source, 'unused.js'), 'throw new Error("Never copied");');
  const icon = await json(join(source, 'icon.json'));
  icon.textures.push({ name: 'Art', url: 'art.png', width: 1, height: 1 });
  icon.materials[0].textureMaps = [{ texture: 0, wrapS: 0, wrapT: 0 }];
  await writeJson(join(source, 'icon.json'), icon);
  const wave = Buffer.alloc(44 + 160);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(160, 40);
  await writeFile(join(source, 'sound.wav'), wave);
  const manifest = await json(join(source, 'channel.json'));
  manifest.audio = { src: 'sound.wav', loop: true, loopStart: 0.002, loopEnd: 0.008 };
  await writeJson(join(source, 'channel.json'), manifest);
  const entry = await addCustomChannel(source, assets);
  assert.equal(entry.audio.samples, 80);
  assert.equal(entry.audio.duration, 0.01);
  assert.equal(entry.audio.loopStart, 0.002);
  const installed = await json(join(assets, entry.iconLayout));
  assert.deepEqual(await readFile(join(assets, installed.textures[0].url)), image);
  const prefix = entry.iconLayout.slice(0, -'icon.json'.length);
  await assert.rejects(readFile(join(assets, prefix, 'resources/unused.js')), {
    code: 'ENOENT',
  });
});

test('invalid packages do not replace a working installation', async (t) => {
  const { source, assets } = await fixture(t);
  await addCustomChannel(source, assets);
  const before = await readFile(join(assets, 'custom-channels.json'), 'utf8');
  const icon = await json(join(source, 'icon.json'));
  icon.root.children[0].material = 400;
  await writeJson(join(source, 'icon.json'), icon);
  await assert.rejects(addCustomChannel(source, assets), /pane.material/);
  assert.equal(await readFile(join(assets, 'custom-channels.json'), 'utf8'), before);
  await assert.rejects(initializeCustomChannel(source), { code: 'EEXIST' });
});

test('package references cannot escape through parent paths or symlinks', async (t) => {
  const { source, directory } = await fixture(t);
  const manifest = await json(join(source, 'channel.json'));
  manifest.iconLayout = '../outside.json';
  await writeJson(join(source, 'channel.json'), manifest);
  await assert.rejects(readCustomPackage(source), /parent traversal/);
  await writeFile(join(directory, 'outside.json'), '{}');
  await symlink(join(directory, 'outside.json'), join(source, 'outside.json'));
  manifest.iconLayout = 'outside.json';
  await writeJson(join(source, 'channel.json'), manifest);
  await assert.rejects(readCustomPackage(source), /leaves the channel package/);
});

test('schema rejects executable extensions, invalid curves and malformed numeric values', async (t) => {
  const { source } = await fixture(t);
  const original = await json(join(source, 'icon.json'));
  const script = structuredClone(original);
  script.script = 'anything.js';
  assert.throws(() => validateChannelLayout(script, 'icon'), /unsupported field script/);
  const external = structuredClone(original);
  external.textures.push({
    name: 'External',
    url: 'https://example.org/a.png',
    width: 1,
    height: 1,
  });
  assert.throws(() => validateChannelLayout(external, 'icon'), /relative package path/);
  const malformed = structuredClone(original);
  malformed.root.translation[0] = '1;bad()';
  assert.throws(() => validateChannelLayout(malformed, 'icon'), /pane.translation/);
  const backwards = structuredClone(original);
  backwards.animations.icon.targets[0].tracks[0].keys[1].frame = 0;
  assert.throws(() => validateChannelLayout(backwards, 'icon'), /must increase/);
});

test('custom catalog merge is immutable and rejects duplicate/native identifiers', () => {
  const native = { channels: [], defaultOrder: [] };
  assert.equal(mergeChannelCatalog(native), native);
  const custom = {
    schemaVersion: 1,
    channels: [
      {
        id: 'custom-demo',
        title: 'Demo',
        iconLayout: 'custom-channels/custom-demo/v1/icon.json',
        bannerLayout: 'custom-channels/custom-demo/v1/banner.json',
      },
    ],
  };
  const merged = mergeChannelCatalog(native, custom);
  assert.deepEqual(native.defaultOrder, []);
  assert.deepEqual(merged.defaultOrder, ['custom-demo']);
  assert.throws(() => mergeChannelCatalog(merged, custom), /duplicate/);
  assert.throws(
    () => mergeChannelCatalog(native, { schemaVersion: 1, channels: [{ id: 'disc' }] }),
    /Invalid/,
  );
});

test('initialized example contains deterministic original stereo audio with a clean tail', async (t) => {
  const { source, directory, assets } = await fixture(t);
  const next = join(directory, 'second');
  await initializeCustomChannel(next);
  const first = await readCustomPackage(source);
  assert.equal(first.audio.sampleRate, 32000);
  assert.equal(first.audio.channels, 2);
  assert.equal(first.audio.duration, 2.4);
  assert.equal(first.audio.loop, false);
  const wave = await readFile(join(source, 'sound.wav'));
  assert.deepEqual(wave, await readFile(join(next, 'sound.wav')));
  let peak = 0;
  let stereoDifference = 0;
  for (let frame = 0; frame < first.audio.samples; frame++) {
    const left = wave.readInt16LE(44 + frame * 4);
    const right = wave.readInt16LE(46 + frame * 4);
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    stereoDifference += Math.abs(left - right);
  }
  assert.ok(peak > 3000 && peak < 20000, 'example is audible and has ample headroom');
  assert.ok(stereoDifference > 0, 'authored panning reaches both channels');
  assert.ok(
    wave.subarray(-3200).every((byte) => byte === 0),
    'no discontinuity at the end',
  );
  const installed = await addCustomChannel(source, assets);
  assert.equal(installed.audio.samples, first.audio.samples);
  assert.deepEqual(
    await readFile(join(assets, installed.audio.src.slice('/assets/'.length))),
    wave,
  );
});

test('invalid installed catalogs are rejected before any add or remove mutation', async (t) => {
  const { source, assets } = await fixture(t);
  const entry = await addCustomChannel(source, assets);
  const invalid = { schemaVersion: 1, channels: [entry, entry] };
  await writeJson(join(assets, 'custom-channels.json'), invalid);
  const before = await readFile(join(assets, 'custom-channels.json'), 'utf8');
  await assert.rejects(addCustomChannel(source, assets), /duplicate/);
  await assert.rejects(removeCustomChannel(entry.id, assets), /duplicate/);
  assert.equal(await readFile(join(assets, 'custom-channels.json'), 'utf8'), before);
  const unsafe = { ...entry, audio: { src: 'https://example.invalid/sound.wav' } };
  assert.throws(
    () =>
      mergeChannelCatalog(
        { channels: [], defaultOrder: [] },
        { schemaVersion: 1, channels: [unsafe] },
      ),
    /audio/,
  );
});
