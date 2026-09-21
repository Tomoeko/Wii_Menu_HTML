import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_GRAPHICS } from '../src/graphics.js';
import { readConfiguration, updateConfiguration } from '../../tools/configuration.mjs';
import { readGraphicsSettings, writeGraphicsSettings } from '../../tools/graphics-settings.mjs';
import { setChannelEnabled } from '../../tools/channels.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-graphics-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configFile = join(directory, 'config.json');
  const assets = join(directory, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'channels.json'), JSON.stringify({
    channels: [{ id: 'fixture', title: 'Synthetic', iconLayout: 'icon.json', bannerLayout: 'icon.json' }],
    defaultOrder: ['fixture'],
  }));
  await writeFile(join(assets, 'icon.json'), '{}');
  const original = {
    audio: { volume: 0.4 },
    channels: { persistLayout: true, enabled: { fixture: true } },
    customSettings: { preserved: ['synthetic'] },
  };
  await writeFile(configFile, JSON.stringify(original, null, 2) + '\n');
  return { directory, configFile, assets, original, layoutFile: join(directory, 'layout.json') };
}

test('graphics defaults read without rewriting, and saving changes only graphics', async (t) => {
  const state = await fixture(t);
  const before = await readFile(state.configFile, 'utf8');
  assert.deepEqual(await readGraphicsSettings(state.configFile), DEFAULT_GRAPHICS);
  assert.equal(await readFile(state.configFile, 'utf8'), before);
  const graphics = { ...DEFAULT_GRAPHICS, resolutionScale: 2, colorCorrection: 'gamma' };
  assert.deepEqual(await writeGraphicsSettings(state.configFile, graphics), graphics);
  assert.deepEqual(await readConfiguration(state.configFile), { ...state.original, graphics });
  assert.equal((await readdir(state.directory)).some((name) => /\.tmp$|\.lock$/.test(name)), false);
});

test('graphics and channel visibility share configuration ownership and preserve each other on retry',
  async (t) => {
    const state = await fixture(t);
    let release;
    let acquired;
    const entered = new Promise((resolve) => { acquired = resolve; });
    const hold = new Promise((resolve) => { release = resolve; });
    const owner = updateConfiguration(state.configFile, async (configuration) => {
      acquired();
      await hold;
      configuration.customSettings.owner = 'retained';
    });
    await entered;
    await assert.rejects(writeGraphicsSettings(state.configFile, DEFAULT_GRAPHICS), /Another configuration/);
    await assert.rejects(setChannelEnabled('fixture', false, state), /Another configuration/);
    assert.equal((await readConfiguration(state.configFile)).customSettings.owner, undefined);
    release();
    await owner;
    await setChannelEnabled('fixture', false, state);
    const graphics = { ...DEFAULT_GRAPHICS, antiAliasing: 'ssaa-4x' };
    await writeGraphicsSettings(state.configFile, graphics);
    await setChannelEnabled('fixture', true, state);
    assert.deepEqual(await readConfiguration(state.configFile), {
      ...state.original,
      customSettings: { preserved: ['synthetic'], owner: 'retained' },
      graphics,
    });
  });

test('invalid graphics, malformed configuration and failed edits never replace stored data', async (t) => {
  const { configFile } = await fixture(t);
  const before = await readFile(configFile, 'utf8');
  for (const value of [null, [], {}, { ...DEFAULT_GRAPHICS, other: true },
    { ...DEFAULT_GRAPHICS, resolutionScale: 0 }, { ...DEFAULT_GRAPHICS, sourceGamma: 4 }]) {
    await assert.rejects(writeGraphicsSettings(configFile, value));
    assert.equal(await readFile(configFile, 'utf8'), before);
  }
  await assert.rejects(updateConfiguration(configFile, (configuration) => {
    configuration.audio.volume = 0;
    throw new Error('Synthetic edit failure');
  }), /Synthetic edit failure/);
  assert.equal(await readFile(configFile, 'utf8'), before);
  await writeFile(configFile, '{broken');
  await assert.rejects(writeGraphicsSettings(configFile, DEFAULT_GRAPHICS));
  assert.equal(await readFile(configFile, 'utf8'), '{broken');
});
