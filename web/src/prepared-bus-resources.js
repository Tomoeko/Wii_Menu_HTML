import { SequenceReverb } from './sequence-reverb.js';

const channelNames = ['mainLeft', 'mainRight', 'auxALeft', 'auxARight'];
const maximumFrames = 32000 * 60;
const hashPattern = /^[a-f0-9]{64}$/;

export function preparedInactiveAuxiliaryBuses(profile) {
  if (profile?.routing === undefined) return [];
  if (!profile.routing || typeof profile.routing !== 'object') {
    throw new Error('Unsupported prepared effect routing context.');
  }
  const { context, inactiveAuxiliaryBuses } = profile.routing;
  if (profile.callback !== 'menu-chain' || context !== 'system-menu-usa-4.3' ||
      JSON.stringify(inactiveAuxiliaryBuses) !== JSON.stringify(['auxB', 'auxC'])) {
    throw new Error('Unsupported prepared effect routing context.');
  }
  return [...inactiveAuxiliaryBuses];
}

export function validatePreparedBusDescriptor(descriptor) {
  const directWave = descriptor?.schemaVersion === 2 && descriptor.sourceKind === 'wsd';
  const sequence = descriptor?.schemaVersion === 1 &&
    (descriptor.sourceKind === undefined || descriptor.sourceKind === 'sequence');
  if ((!sequence && !directWave) || descriptor.encoding !== 's32le' ||
      descriptor.pcmScale !== 32768 || descriptor.sampleRate !== 32000 ||
      descriptor.blockFrames !== 96 ||
      JSON.stringify(descriptor.channels) !== JSON.stringify(channelNames) ||
      !Number.isInteger(descriptor.frames) || descriptor.frames < 1 ||
      descriptor.frames > maximumFrames || !Number.isInteger(descriptor.rendererVersion) ||
      descriptor.rendererVersion < 1 ||
      ![descriptor.sha256, directWave ? descriptor.sourceDefinitionSha256 : descriptor.sourceSequenceSha256,
        descriptor.sourceArchiveSha256, descriptor.sourceDriverSha256]
        .every((hash) => typeof hash === 'string' && hashPattern.test(hash)) ||
      !Array.isArray(descriptor.unrenderedSends) ||
      descriptor.unrenderedSends.some((send) => !['auxB', 'auxC'].includes(send))) {
    throw new Error('Unsupported prepared effect bus descriptor.');
  }
  if (directWave && (descriptor.gainOwner !== 'buses' || descriptor.outputMode !== 'stereo' ||
      !Number.isInteger(descriptor.archiveVolume) || descriptor.archiveVolume < 0 ||
      descriptor.archiveVolume > 127 || descriptor.sourceSequenceSha256 !== undefined ||
      descriptor.unrenderedSends.length || descriptor.loopStartFrame !== undefined ||
      descriptor.loopEndFrame !== undefined)) {
    throw new Error('Unsupported prepared WSD voice ownership.');
  }
  const { loopStartFrame: start, loopEndFrame: end } = descriptor;
  if ((start !== undefined || end !== undefined) &&
      (!Number.isInteger(start) || !Number.isInteger(end) ||
       start < 0 || end <= start || end > descriptor.frames)) {
    throw new Error('Invalid prepared effect bus loop.');
  }
}

export function decodePreparedBuses(buffer, descriptor) {
  validatePreparedBusDescriptor(descriptor);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== descriptor.frames * 16) {
    throw new Error('Prepared effect bus byte length does not match its descriptor.');
  }
  const view = new DataView(buffer);
  const channels = channelNames.map(() => new Int32Array(descriptor.frames));
  for (let frame = 0; frame < descriptor.frames; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      channels[channel][frame] = view.getInt32((frame * 4 + channel) * 4, true);
    }
  }
  return channels;
}

function localUrl(source, base) {
  if (typeof source !== 'string') throw new Error('Missing local effect resource URL.');
  const url = new URL(source, base);
  if (url.origin !== base.origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Prepared effect resources must remain on the local host.');
  }
  return url;
}

async function readBytes(url, fetchResource) {
  const response = await fetchResource(url.href);
  if (!response.ok) throw new Error(`Prepared effects: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Prepared effects require SHA-256 support.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadPreparedBusCatalog({ src, catalogSrc }, baseUrl,
  fetchResource = globalThis.fetch) {
  const base = new URL(baseUrl ?? globalThis.location.href);
  const [sidecarBytes, catalogBytes] = await Promise.all([
    readBytes(localUrl(src, base), fetchResource),
    readBytes(localUrl(catalogSrc, base), fetchResource),
  ]);
  const decoder = new TextDecoder();
  const sidecar = JSON.parse(decoder.decode(sidecarBytes));
  const catalog = JSON.parse(decoder.decode(catalogBytes));
  if (sidecar?.schemaVersion !== 2 || !sidecar.sounds || Array.isArray(sidecar.sounds) ||
      Object.keys(sidecar.sounds).length > 128 ||
      sidecar.sourceAudioSha256 !== await sha256(catalogBytes)) {
    throw new Error('Prepared effect sidecar does not match its audio catalog.');
  }
  const profile = sidecar.effectProfiles?.menu;
  if (profile?.type !== 'ReverbHi' || profile.callback !== 'menu-chain' ||
      !hashPattern.test(profile.sourceDriverSha256)) {
    throw new Error('Prepared effects require the verified menu effect profile.');
  }
  // Reject unsupported parameters before transferring them to the worklet.
  preparedInactiveAuxiliaryBuses(profile);
  new SequenceReverb(profile);
  for (const [name, descriptor] of Object.entries(sidecar.sounds)) {
    validatePreparedBusDescriptor(descriptor);
    localUrl(descriptor.src, base);
    const directWave = descriptor.sourceKind === 'wsd';
    const renderingMatches = directWave
      ? catalog[name]?.rendering === 'decoded-original-wave' &&
        catalog[name].gain === descriptor.archiveVolume / 127
      : catalog[name]?.rendering?.startsWith('original-sequence-built-in-') &&
        (catalog[name].gain === undefined || catalog[name].gain === 1);
    if (!renderingMatches ||
        catalog[name].sourceSymbol !== descriptor.sourceSymbol ||
        descriptor.sourceDriverSha256 !== profile.sourceDriverSha256) {
      throw new Error('Prepared effect provenance differs from its catalog or profile.');
    }
  }
  return { sounds: sidecar.sounds, effectProfiles: { menu: profile } };
}

export async function loadPreparedBusAsset(descriptor, baseUrl,
  fetchResource = globalThis.fetch) {
  validatePreparedBusDescriptor(descriptor);
  const base = new URL(baseUrl ?? globalThis.location.href);
  const bytes = await readBytes(localUrl(descriptor.src, base), fetchResource);
  if (bytes.byteLength !== descriptor.frames * 16 || await sha256(bytes) !== descriptor.sha256) {
    throw new Error('Prepared effect bus content does not match its descriptor.');
  }
  return decodePreparedBuses(bytes, descriptor);
}
