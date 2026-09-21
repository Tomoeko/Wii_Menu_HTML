const identifier = /^[A-Za-z0-9_-]{1,64}$/;

export function validateChannelEnabled(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('channels.enabled must map channel IDs to true or false.');
  }
  if (Object.keys(value).length > 2048) throw new Error('Too many channel overrides.');
  for (const [id, enabled] of Object.entries(value)) {
    if (!identifier.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) {
      throw new Error(`Invalid channel identifier: ${id}`);
    }
    if (typeof enabled !== 'boolean') throw new Error(`channels.enabled.${id} must be boolean.`);
    if (id === 'disc' && !enabled) throw new Error('The Disc Channel cannot be disabled.');
  }
  return { ...value };
}

/** Omitted overrides retain the prepared catalog's native default selection. */
export function selectChannelCatalog(catalog, enabled = {}, { deletedIds = [] } = {}) {
  const overrides = validateChannelEnabled(enabled);
  if (
    !Array.isArray(deletedIds) ||
    deletedIds.length > 2048 ||
    deletedIds.some(
      (id) =>
        typeof id !== 'string' ||
        !identifier.test(id) ||
        ['disc', '__proto__', 'constructor', 'prototype'].includes(id),
    )
  ) {
    throw new Error('Invalid deleted channel IDs.');
  }
  const deleted = new Set(deletedIds);
  if (!Array.isArray(catalog?.channels) || !Array.isArray(catalog.defaultOrder)) {
    throw new Error('Invalid prepared channel catalog.');
  }
  const byId = new Map();
  if (catalog.channels.length > 2048) throw new Error('Channel catalog exceeds 2048 entries.');
  for (const channel of catalog.channels) {
    if (!channel || !identifier.test(channel.id) || byId.has(channel.id) || channel.id === 'disc') {
      throw new Error(`Invalid or duplicate channel identifier: ${channel?.id}`);
    }
    byId.set(channel.id, channel);
  }
  const defaults = new Set();
  for (const id of catalog.defaultOrder) {
    if (!byId.has(id) || defaults.has(id)) throw new Error(`Invalid default channel order: ${id}`);
    defaults.add(id);
  }
  const order = [
    ...catalog.defaultOrder,
    ...catalog.channels.filter((channel) => !defaults.has(channel.id)).map((channel) => channel.id),
  ];
  const selected = order.filter((id) => !deleted.has(id) && (overrides[id] ?? defaults.has(id)));
  return {
    channels: selected.map((id) => byId.get(id)),
    defaultOrder: selected,
    unknownIds: Object.keys(overrides).filter((id) => id !== 'disc' && !byId.has(id)),
  };
}
