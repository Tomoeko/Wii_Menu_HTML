export const CHANNEL_SLOT_COUNT = 48;
const identifier = /^[A-Za-z0-9_-]{1,64}$/;
const validIdentifier = (id) =>
  typeof id === 'string' &&
  identifier.test(id) &&
  !['__proto__', 'constructor', 'prototype'].includes(id);

export function validateChannelArrangement(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.slots) ||
    value.slots.length !== CHANNEL_SLOT_COUNT ||
    value.slots[0] !== 'disc'
  ) {
    throw new Error('Expected 48 slots with Disc fixed in the first slot.');
  }
  const seen = new Set();
  for (const id of value.slots) {
    if (id === null) continue;
    if (!validIdentifier(id) || seen.has(id)) {
      throw new Error('Channel identifiers must be valid and unique.');
    }
    seen.add(id);
  }
  const result = { version: 1, slots: [...value.slots] };
  if (value.positions !== undefined) {
    if (
      !value.positions ||
      typeof value.positions !== 'object' ||
      Array.isArray(value.positions)
    ) {
      throw new Error('Channel positions must map identifiers to preferred slots.');
    }
    const entries = Object.entries(value.positions);
    if (entries.length > 2048) throw new Error('Too many remembered channel positions.');
    for (const [id, slot] of entries) {
      if (
        !validIdentifier(id) ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= CHANNEL_SLOT_COUNT
      ) {
        throw new Error('Invalid remembered channel position.');
      }
      if ((id === 'disc') !== (slot === 0))
        throw new Error('Only Disc may prefer the first slot.');
    }
    result.positions = Object.fromEntries(entries);
  }
  return result;
}

function rememberedPositions(state) {
  const positions = { ...state?.positions };
  const slots = Array.isArray(state) ? state : state?.slots;
  for (let slot = 1; slot < CHANNEL_SLOT_COUNT; slot++) {
    const id = slots?.[slot];
    if (validIdentifier(id) && id !== 'disc') positions[id] = slot;
  }
  positions.disc = 0;
  return positions;
}

/** Active saved owners win, then free remembered positions, then free slots.
 * Inactive preferences are retained separately and never reserve a visible tile. */
export function planChannelSlots(channels, savedState = null, defaultIds = []) {
  if (!Array.isArray(channels)) throw new Error('Expected a channel catalog.');
  if (savedState && !Array.isArray(savedState) && savedState.slots !== null) {
    validateChannelArrangement(savedState);
  }
  const catalog = new Map();
  for (const channel of channels) {
    if (!validIdentifier(channel?.id) || catalog.has(channel.id)) {
      throw new Error(`Invalid or duplicate channel: ${channel?.id}`);
    }
    catalog.set(channel.id, channel);
  }
  const savedIds = Array.isArray(savedState) ? savedState : savedState?.slots;
  const initialIds = Array.isArray(savedIds) ? savedIds : defaultIds;
  const positions = rememberedPositions(
    Array.isArray(savedIds) ? savedState : { ...savedState, slots: defaultIds },
  );
  const slots = Array(CHANNEL_SLOT_COUNT).fill(null);
  const used = new Set(['disc']);
  slots[0] = catalog.get('disc') ?? { id: 'disc', title: 'Disc Channel' };
  for (let slot = 1; slot < CHANNEL_SLOT_COUNT; slot++) {
    const id = initialIds?.[slot];
    if (catalog.has(id) && !used.has(id)) {
      slots[slot] = catalog.get(id);
      used.add(id);
    }
  }
  for (const channel of channels) {
    const slot = positions[channel.id];
    if (
      !used.has(channel.id) &&
      Number.isInteger(slot) &&
      slot > 0 &&
      slot < CHANNEL_SLOT_COUNT &&
      !slots[slot]
    ) {
      slots[slot] = channel;
      used.add(channel.id);
    }
  }
  const overflow = [];
  for (const channel of channels) {
    if (used.has(channel.id)) continue;
    const empty = slots.indexOf(null);
    if (empty < 0) overflow.push(channel.id);
    else {
      slots[empty] = channel;
      used.add(channel.id);
    }
  }
  return { slots, overflow, positions };
}

/** Compatibility helper for callers that only require the 48 rendered slots. */
export function reconcileSlots(channels, savedIds, defaultIds) {
  return planChannelSlots(channels, savedIds, defaultIds).slots;
}

export function serializeChannelPlacement(channels, previousState = null) {
  if (!Array.isArray(channels) || channels.length !== CHANNEL_SLOT_COUNT) {
    throw new Error('Expected exactly 48 visible channel slots.');
  }
  const slots = channels.map((channel) => channel?.id ?? null);
  const positions = rememberedPositions(previousState);
  slots.forEach((id, slot) => {
    if (id !== null) positions[id] = slot;
  });
  return validateChannelArrangement({ version: 1, slots, positions });
}

export async function readChannelPlacement() {
  const response = await fetch('/api/layout');
  if (!response.ok) throw new Error('Could not read the saved channel arrangement.');
  const data = await response.json();
  if (data?.version === 1 && data.slots === null) return { version: 1, slots: null };
  return validateChannelArrangement(data);
}

export async function readChannelArrangement() {
  return (await readChannelPlacement()).slots;
}

export async function saveChannelArrangement(channels, previousState = null) {
  const state = serializeChannelPlacement(channels, previousState);
  const response = await fetch('/api/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(
      'Channel placement could not be saved. Check .local directory permissions.',
    );
  }
  return state;
}
