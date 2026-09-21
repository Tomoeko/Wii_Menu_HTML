export const SD_PAGE_COUNT = 20;
export const SD_SLOT_COUNT = SD_PAGE_COUNT * 12;
export const MEDIA_STATUSES = ['ready', 'absent', 'read-error', 'unsupported'];

const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
  && !['disc', '__proto__', 'constructor', 'prototype'].includes(value);

export function defaultStorageState() {
  return {
    version: 1,
    sd: { page: 0, helpSeen: null },
    tabs: { wii: 'wii', channels: 'wii', gamecube: 'wii' },
  };
}

export function validateStorageState(value) {
  if (value?.version !== 1 || !Number.isInteger(value.sd?.page)
      || value.sd.page < 0 || value.sd.page >= SD_PAGE_COUNT
      || ![null, true, false].includes(value.sd.helpSeen)) {
    throw new Error('Expected storage state version 1 with an SD page from 0 to 19.');
  }
  const tabs = {};
  for (const kind of ['wii', 'channels', 'gamecube']) {
    const tab = value.tabs?.[kind];
    if (!['wii', 'sd'].includes(tab)) throw new Error('Invalid remembered storage tab.');
    tabs[kind] = tab;
  }
  return { version: 1, sd: { page: value.sd.page, helpSeen: value.sd.helpSeen }, tabs };
}

export function defaultStorageFixture() {
  return {
    version: 1,
    sd: { status: 'ready', channels: [] },
    wiiSaves: { status: 'ready', records: [{ id: 'dummy-save', title: 'Dummy Save', blocks: 1 }] },
    sdSaves: { status: 'ready', records: [] },
    gamecube: {
      a: { status: 'ready', records: [] },
      b: { status: 'absent', records: [] },
    },
  };
}

export function validateStorageFixture(value) {
  if (value?.version !== 1) throw new Error('Expected storage fixture version 1.');
  let freeBlocks;
  if (value.freeBlocks !== undefined) {
    if (!value.freeBlocks || typeof value.freeBlocks !== 'object'
        || Array.isArray(value.freeBlocks)) {
      throw new Error('Storage freeBlocks must name optional Wii and SD block counts.');
    }
    const limits = { wii: 9999, sd: 999999 };
    freeBlocks = {};
    for (const [medium, count] of Object.entries(value.freeBlocks)) {
      if (!Object.hasOwn(limits, medium) || !Number.isInteger(count)
          || count < 0 || count > limits[medium]) {
        throw new Error('Invalid declared free-block count for the local storage medium.');
      }
      freeBlocks[medium] = count;
    }
  }
  const status = (medium) => {
    if (!MEDIA_STATUSES.includes(medium?.status)) throw new Error('Invalid local media status.');
    return medium.status;
  };
  const saves = (medium) => {
    const mediaStatus = status(medium);
    if (!Array.isArray(medium.records) || medium.records.length > SD_SLOT_COUNT) {
      throw new Error('A local medium accepts at most 240 synthetic save records.');
    }
    const seen = new Set();
    const records = medium.records.map((record) => {
      if (!validId(record?.id) || seen.has(record.id) || typeof record.title !== 'string'
          || !record.title.trim() || record.title.length > 100
          || !Number.isInteger(record.blocks) || record.blocks < 1 || record.blocks > 99999) {
        throw new Error('Invalid or duplicate synthetic save record.');
      }
      seen.add(record.id);
      return { id: record.id, title: record.title, blocks: record.blocks };
    });
    return { status: mediaStatus, records };
  };
  const sdStatus = status(value.sd);
  if (!Array.isArray(value.sd.channels) || value.sd.channels.length > SD_SLOT_COUNT) {
    throw new Error('An SD fixture accepts at most 240 channel mappings.');
  }
  const ids = new Set();
  const slots = new Set();
  const channels = value.sd.channels.map((mapping) => {
    if (!validId(mapping?.id) || ids.has(mapping.id) || !Number.isInteger(mapping.slot)
        || mapping.slot < 0 || mapping.slot >= SD_SLOT_COUNT || slots.has(mapping.slot)) {
      throw new Error('SD channel mappings require unique IDs and slots from 0 to 239.');
    }
    ids.add(mapping.id);
    slots.add(mapping.slot);
    return { id: mapping.id, slot: mapping.slot };
  });
  return {
    version: 1,
    ...(freeBlocks === undefined ? {} : { freeBlocks }),
    sd: { status: sdStatus, channels },
    wiiSaves: saves(value.wiiSaves),
    sdSaves: saves(value.sdSaves),
    gamecube: { a: saves(value.gamecube?.a), b: saves(value.gamecube?.b) },
  };
}

/** Explicit references reuse loaded local artwork; NAND imports never imply SD membership. */
export function resolveStorageFixture(value, channels) {
  const fixture = validateStorageFixture(value);
  const available = new Map(channels.filter((channel) => validId(channel?.id) && channel.icon)
    .map((channel) => [channel.id, channel]));
  const sdSlots = Array(SD_SLOT_COUNT).fill(null);
  const missingChannelIds = [];
  for (const mapping of fixture.sd.channels) {
    const channel = available.get(mapping.id);
    if (channel) sdSlots[mapping.slot] = channel;
    else missingChannelIds.push(mapping.id);
  }
  return { ...fixture, sdSlots, sdChannels: sdSlots.filter(Boolean), missingChannelIds };
}

export function mediaErrorMessage(status, { kind = 'sd', tab = 'sd', messages = {} } = {}) {
  if (status === 'ready') return '';
  if (!MEDIA_STATUSES.includes(status)) throw new Error('Invalid local media status.');
  if (kind === 'wii' && tab === 'wii') return 'The local Wii storage fixture is unavailable.';
  const strings = messages.messages || messages;
  const gamecube = kind === 'gamecube';
  const ids = gamecube
    ? { absent: tab === 'wii' ? 230 : 231, 'read-error': tab === 'wii' ? 232 : 233,
      unsupported: tab === 'wii' ? 234 : 235 }
    : { absent: 169, 'read-error': 195, unsupported: 171 };
  const fallback = {
    absent: gamecube ? `Nothing is inserted in Slot ${tab === 'wii' ? 'A' : 'B'}.`
      : 'Nothing is inserted in the SD Card Slot.',
    'read-error': gamecube ? 'The Memory Card could not be read.' : 'An SD Card process failed.',
    unsupported: 'The inserted device cannot be used.',
  };
  return strings[ids[status]] ?? fallback[status];
}

export async function readStorageState() {
  const response = await fetch('/api/storage-state');
  if (!response.ok) throw new Error('Could not read .local/storage-state.json.');
  return validateStorageState(await response.json());
}

export async function saveStorageState(value) {
  const state = validateStorageState(value);
  const response = await fetch('/api/storage-state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error('Could not save .local/storage-state.json.');
  return validateStorageState(await response.json());
}

export async function readStorageFixture() {
  const response = await fetch('/api/storage-fixture');
  if (!response.ok) throw new Error('Could not read .local/storage-fixture.json.');
  return validateStorageFixture(await response.json());
}
