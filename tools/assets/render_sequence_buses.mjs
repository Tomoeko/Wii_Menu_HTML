/** Stage optional main/Aux A resources; never change the prepared WAV catalog. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SequenceEngine } from '../../web/src/sequence-engine.js';
import { WsdEngine } from '../../web/src/wsd-engine.js';
import { readLocalSequenceResources } from './sequence_resources.mjs';

export const SEQUENCE_BUS_SCHEMA_VERSION = 1;
export const SEQUENCE_BUS_CATALOG_SCHEMA_VERSION = 2;
const channelNames = ['mainLeft', 'mainRight', 'auxALeft', 'auxARight'];

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function loopMetadata(definition, frames) {
  const { loopStart, loopEnd } = definition.offline;
  if (loopStart === undefined && loopEnd === undefined) return {};
  const start = Math.round(loopStart * 32000);
  const end = Math.round(loopEnd * 32000);
  if (!Number.isFinite(loopStart) || !Number.isFinite(loopEnd) ||
      Math.abs(start - loopStart * 32000) > 1e-6 ||
      Math.abs(end - loopEnd * 32000) > 1e-6 || start < 0 || end <= start || end > frames) {
    throw new Error('Sequence bus loop must have bounded integer frame markers.');
  }
  return { loopStartFrame: start, loopEndFrame: end };
}

export async function writeSequenceBuses(definition, waves, outputPath) {
  const directWave = definition.sourceKind === 'wsd';
  const engine = directWave ? new WsdEngine(definition, waves)
    : new SequenceEngine(definition, waves, { auxiliary: 'external' });
  const frames = directWave ? engine.frames : definition.offline?.frames;
  if (!Number.isInteger(frames) || frames < 1 || frames > 32000 * 600) {
    throw new Error('Invalid offline sequence bus duration.');
  }
  if (!Number.isInteger(definition.rendererVersion) || definition.rendererVersion < 1 ||
      ![definition.sourceArchiveSha256, definition.sourceDriverSha256]
        .every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Sequence bus resources require renderer and source provenance.');
  }
  const loop = directWave ? {} : loopMetadata(definition, frames);
  const output = await open(outputPath, 'w');
  let lastNonzeroFrame = -1;
  let peak = 0;
  let outputFrames = frames;
  try {
    for (let position = 0; position < frames; position += 8192) {
      const count = Math.min(8192, frames - position);
      const channels = channelNames.map(() => new Float32Array(count));
      engine.renderBuses(...channels);
      const bytes = Buffer.alloc(count * 16);
      for (let frame = 0; frame < count; frame += 1) {
        for (let channel = 0; channel < channels.length; channel += 1) {
          const sample = channels[channel][frame] * 32768;
          if (!Number.isInteger(sample) || sample < -2147483648 || sample > 2147483647) {
            throw new Error('Sequence bus value is not a signed 32-bit PCM count.');
          }
          if (sample) lastNonzeroFrame = position + frame;
          peak = Math.max(peak, Math.abs(sample));
          bytes.writeInt32LE(sample, (frame * 4 + channel) * 4);
        }
      }
      await output.write(bytes);
    }
    // A loop's final silence belongs to its period. Only finite effects may
    // trim trailing zeros; no filter tail is present in these source buses.
    if (!directWave && definition.offline.trimSilence && loop.loopEndFrame === undefined) {
      outputFrames = Math.max(1, lastNonzeroFrame + 1);
      await output.truncate(outputFrames * 16);
    }
  } finally {
    await output.close();
  }
  return {
    schemaVersion: directWave ? 2 : SEQUENCE_BUS_SCHEMA_VERSION,
    encoding: 's32le',
    pcmScale: 32768,
    channels: [...channelNames],
    sampleRate: 32000,
    blockFrames: 96,
    frames: outputFrames,
    sha256: await hashFile(outputPath),
    peakPcm: peak,
    ...loop,
    rendererVersion: definition.rendererVersion,
    sourceArchiveSha256: definition.sourceArchiveSha256,
    sourceDriverSha256: definition.sourceDriverSha256,
    rendering: directWave ? 'original-wsd-main-auxA-buses-approximate'
      : 'original-sequence-main-auxA-buses-approximate',
    ...(directWave ? {
      sourceKind: 'wsd', gainOwner: 'buses', archiveVolume: definition.archiveVolume,
      outputMode: 'stereo',
    } : {}),
    unrenderedSends: directWave ? [] : ['auxB', 'auxC'].filter((kind) =>
      definition.events.some((event) => event.kind === kind && event.value !== 0)),
  };
}

async function resolveDestination(path) {
  let ancestor = resolve(path);
  const missing = [];
  // Resolve existing parent symlinks before creating anything. Otherwise an
  // apparently separate staging path could create a directory inside input.
  for (;;) {
    try {
      return resolve(await realpath(ancestor), ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

export async function stageEffectBuses(assetsPath, outputPath, { wsdResources } = {}) {
  const assets = await realpath(assetsPath);
  const output = await resolveDestination(outputPath);
  if (output === assets || output.startsWith(assets + sep)) {
    throw new Error('Bus export requires a staging directory outside the input assets.');
  }
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) {
    throw new Error('Bus export requires an empty staging directory.');
  }
  const catalogBytes = await readFile(resolve(assets, 'audio.json'));
  const catalog = JSON.parse(catalogBytes);
  const sounds = {};
  const unsupported = {};
  const effectProfiles = {};
  await mkdir(resolve(output, 'audio'), { recursive: true });
  for (const [name, asset] of Object.entries(catalog)) {
    if (name === 'background') continue;
    const directWave = asset.rendering === 'decoded-original-wave' && wsdResources;
    if (!asset.rendering?.startsWith('original-sequence-built-in-') && !directWave) {
      unsupported[name] = 'Direct-wave or raw-loop routing requires a separate source audit.';
      continue;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid sequence bus asset name.');
    const resourceRoot = directWave ? await realpath(wsdResources) : assets;
    const definitionPath = resolve(resourceRoot, 'audio',
      `${name}-${directWave ? 'wsd' : 'sequence'}.json`);
    const { definition, waves } = await readLocalSequenceResources(definitionPath, resourceRoot);
    if (directWave && (definition.sourceSymbol !== asset.sourceSymbol ||
        definition.sourceKind !== 'wsd' || asset.gain !== definition.archiveVolume / 127)) {
      throw new Error('WSD voice source or archive gain differs from its audio catalog.');
    }
    if (definition.reverb) {
      const profile = { type: 'ReverbHi', callback: 'menu-chain', ...definition.reverb,
        // System::initOnMemory allocates only Aux A (0x8136B2D0–D8).
        // The generic B chorus cannot register without an allocated heap.
        routing: { context: 'system-menu-usa-4.3', inactiveAuxiliaryBuses: ['auxB', 'auxC'] },
        sourceDriverSha256: definition.sourceDriverSha256 };
      if (effectProfiles.menu && JSON.stringify(effectProfiles.menu) !== JSON.stringify(profile)) {
        throw new Error('Prepared sequence effects do not share the verified menu reverb profile.');
      }
      effectProfiles.menu = profile;
    }
    const descriptor = await writeSequenceBuses(
      definition, waves, resolve(output, 'audio', `${name}-buses.pcm`),
    );
    sounds[name] = {
      src: `/assets/audio/${name}-buses.pcm`,
      sourceSymbol: asset.sourceSymbol,
      [directWave ? 'sourceDefinitionSha256' : 'sourceSequenceSha256']: await hashFile(definitionPath),
      ...descriptor,
    };
  }
  const result = {
    schemaVersion: SEQUENCE_BUS_CATALOG_SCHEMA_VERSION,
    sourceAudioSha256: createHash('sha256').update(catalogBytes).digest('hex'),
    effectProfiles,
    sounds,
    unsupported,
  };
  await writeFile(resolve(output, 'audio-buses.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    assets: { type: 'string' },
    output: { type: 'string' },
    'wsd-resources': { type: 'string' },
  } });
  if (!values.assets || !values.output) {
    throw new Error('Expected --assets INPUT_ASSETS --output SEPARATE_STAGING_DIRECTORY.');
  }
  const result = await stageEffectBuses(values.assets, values.output,
    { wsdResources: values['wsd-resources'] });
  process.stdout.write(JSON.stringify({ effects: Object.keys(result.sounds).length,
    unsupported: Object.keys(result.unsupported).length,
    schemaVersion: result.schemaVersion }) + '\n');
}
