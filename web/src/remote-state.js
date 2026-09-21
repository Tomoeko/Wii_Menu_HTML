/** Local controller fixtures; no Bluetooth addresses or physical pairing state. */
export const DEFAULT_RECONNECT_FIXTURE = Object.freeze({
  mode: 'automatic', players: [1], intervalMs: 400, startFailures: 0, stopFailures: 0,
});

export function validateReconnectFixture(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('wiiRemote.reconnect must be a fixture object.');
  const result = { ...structuredClone(DEFAULT_RECONNECT_FIXTURE), ...value };
  if (!['automatic', 'manual', 'timeout'].includes(result.mode))
    throw new Error('wiiRemote.reconnect.mode must be automatic, manual or timeout.');
  if (!Array.isArray(result.players) || !result.players.length || result.players.length > 4
      || new Set(result.players).size !== result.players.length
      || result.players.some(player => !Number.isInteger(player) || player < 1 || player > 4))
    throw new Error('wiiRemote.reconnect.players must contain unique player numbers from 1 to 4.');
  if (!Number.isFinite(result.intervalMs) || result.intervalMs < 0 || result.intervalMs > 60000)
    throw new Error('wiiRemote.reconnect.intervalMs must be between 0 and 60000.');
  for (const key of ['startFailures', 'stopFailures']) {
    if (!Number.isInteger(result[key]) || result[key] < 0 || result[key] > 600)
      throw new Error(`wiiRemote.reconnect.${key} must be an integer between 0 and 600.`);
  }
  return { ...result, players: [...result.players] };
}

export function defaultRemoteState(config = {}) {
  return validateRemoteState({
    version: 1,
    volume: config.volume ?? 0.7,
    rumble: config.rumble ?? true,
    controllers: Array.from({ length: 4 }, (_, index) => ({ connected: index === 0, battery: 4 })),
  });
}

export function validateRemoteState(value) {
  if (value?.version !== 1 || !Number.isFinite(value.volume) || value.volume < 0
      || value.volume > 1 || typeof value.rumble !== 'boolean'
      || !Array.isArray(value.controllers) || value.controllers.length !== 4)
    throw new Error('Invalid local remote state version 1.');
  const controllers = value.controllers.map(controller => {
    if (typeof controller?.connected !== 'boolean' || !Number.isInteger(controller.battery)
        || controller.battery < 0 || controller.battery > 4)
      throw new Error('Each remote needs a connection flag and battery level from 0 to 4.');
    return { connected: controller.connected, battery: controller.battery };
  });
  return { version: 1, volume: value.volume, rumble: value.rumble, controllers };
}

export async function readRemoteState(config) {
  const response = await fetch('/api/remote-state');
  if (!response.ok) throw new Error('Could not read local remote state.');
  const state = await response.json();
  return state === null ? defaultRemoteState(config) : validateRemoteState(state);
}

let pendingSave = Promise.resolve();
export function saveRemoteState(value) {
  const state = validateRemoteState(value);
  const save = pendingSave.catch(() => {}).then(async () => {
    const response = await fetch('/api/remote-state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
    });
    if (!response.ok) throw new Error('Could not save local remote state.');
    return validateRemoteState(await response.json());
  });
  pendingSave = save;
  return save;
}
