/** Custom content augments the prepared WAD catalog without rewriting it. */
export function mergeChannelCatalog(catalog, custom = null) {
  if (custom === null) return catalog;
  if (custom.schemaVersion !== 1 || !Array.isArray(custom.channels)) {
    throw new Error('Unsupported custom channel catalog.');
  }
  const channels = [...catalog.channels];
  const defaultOrder = [...catalog.defaultOrder];
  const ids = new Set(channels.map((channel) => channel.id));
  for (const channel of custom.channels) {
    if (
      !channel ||
      !/^custom-[a-z0-9][a-z0-9_-]{0,55}$/.test(channel.id) ||
      ids.has(channel.id)
    ) {
      throw new Error(`Invalid or duplicate custom channel: ${channel?.id}`);
    }
    if (
      typeof channel.title !== 'string' ||
      !channel.title.length ||
      channel.title.length > 80
    ) {
      throw new Error(`Invalid custom channel title: ${channel.id}`);
    }
    const prefix = `custom-channels/${channel.id}/`;
    const validPath = (path) =>
      typeof path === 'string' &&
      path.startsWith(prefix) &&
      /^[A-Za-z0-9_./-]+$/.test(path) &&
      path.split('/').every((part) => part && part !== '.' && part !== '..');
    for (const key of ['iconLayout', 'bannerLayout']) {
      if (!validPath(channel[key]) || !channel[key].endsWith('.json')) {
        throw new Error(`Invalid ${key} for ${channel.id}`);
      }
    }
    if (channel.audio !== undefined) {
      const audio = channel.audio;
      if (
        !audio ||
        typeof audio.src !== 'string' ||
        !audio.src.startsWith('/assets/') ||
        !validPath(audio.src.slice('/assets/'.length)) ||
        !audio.src.endsWith('.wav') ||
        (audio.loop !== undefined && typeof audio.loop !== 'boolean')
      ) {
        throw new Error(`Invalid custom channel audio: ${channel.id}`);
      }
    }
    channels.push(channel);
    defaultOrder.push(channel.id);
    ids.add(channel.id);
  }
  return { ...catalog, channels, defaultOrder };
}

export async function readCustomChannelCatalog(baseUrl = '/assets/') {
  const response = await fetch(`${baseUrl}custom-channels.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not read the custom channel catalog.');
  return response.json();
}
