/** Decode generated original PCM without browser resampling the instrument waves. */
export function decodeSequenceWave(buffer, descriptor) {
  const { channels, frames, rate } = descriptor;
  if (
    ![1, 2].includes(channels) || !Number.isInteger(frames) ||
    frames < 1 || frames > 20000000 || buffer.byteLength !== frames * channels * 2 ||
    !Number.isInteger(rate) || rate < 1000 || rate > 192000
  ) throw new Error('Invalid original sequence PCM resource.');
  const view = new DataView(buffer);
  const decoded = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      decoded[channel][frame] = view.getInt16((frame * channels + channel) * 2, true) / 32768;
    }
  }
  return { rate, channels: decoded };
}

export async function loadSequenceResources(asset, baseUrl, fetchResource = globalThis.fetch) {
  const base = new URL(baseUrl ?? globalThis.location.href);
  const resolve = (source) => {
    const url = new URL(source, base);
    if (url.origin !== base.origin) throw new Error('Sequence resources must remain on the local host.');
    return url.href;
  };
  const response = await fetchResource(resolve(asset.src));
  if (!response.ok) throw new Error(`Background sequence: HTTP ${response.status}`);
  const definition = await response.json();
  if (!Array.isArray(definition.waves) || definition.waves.length > 256) {
    throw new Error('Invalid background instrument resource list.');
  }
  const waves = await Promise.all(definition.waves.map(async (descriptor) => {
    const waveResponse = await fetchResource(resolve(descriptor.src));
    if (!waveResponse.ok) throw new Error(`Background instrument: HTTP ${waveResponse.status}`);
    return decodeSequenceWave(await waveResponse.arrayBuffer(), descriptor);
  }));
  return { definition, waves };
}
