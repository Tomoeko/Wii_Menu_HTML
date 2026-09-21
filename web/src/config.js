/** User-editable settings. Hardware services are represented by local fixtures. */
import { validateChannelEnabled } from './channel-selection.js';
import { DEFAULT_RECONNECT_FIXTURE, validateReconnectFixture } from './remote-state.js';
import { DEFAULT_GRAPHICS, normalizeGraphics } from './graphics.js';

export const DEFAULT_CONFIG = Object.freeze({
  display: { aspectRatio: '16:9' },
  graphics: DEFAULT_GRAPHICS,
  startup: { healthSafety: true, restartServiceReadyFrames: 94, restartBlackFrames: 43 },
  audio: { volume: 0.7, muted: false, backgroundMode: 'prepared' },
  sdCard: { enabled: true },
  wiiRemote: {
    volume: 0.7, rumble: true, reconnectDelayMs: 3000,
    reconnect: DEFAULT_RECONNECT_FIXTURE,
  },
  input: { homeKeys: ['Home', 'h'], grabButtons: [1, 2] },
  channels: { persistLayout: true, enabled: {} },
});

export function normalizeConfig(value = {}) {
  const result = structuredClone(DEFAULT_CONFIG);
  for (const section of Object.keys(result)) {
    if (value[section] && typeof value[section] === 'object') {
      Object.assign(result[section], value[section]);
    }
  }
  if (!['4:3', '16:9'].includes(result.display.aspectRatio)) {
    throw new Error('display.aspectRatio must be "4:3" or "16:9".');
  }
  if (!Number.isFinite(result.audio.volume) || result.audio.volume < 0 || result.audio.volume > 1) {
    throw new Error('audio.volume must be between 0 and 1.');
  }
  if (!['prepared', 'realtime'].includes(result.audio.backgroundMode)) {
    throw new Error('audio.backgroundMode must be "prepared" or "realtime".');
  }
  for (const key of ['restartServiceReadyFrames', 'restartBlackFrames']) {
    const value = result.startup[key];
    if (!Number.isInteger(value) || value < 0 || value > 3600)
      throw new Error(`startup.${key} must be an integer between 0 and 3600.`);
  }
  for (const [section, key] of [
    ['startup', 'healthSafety'],
    ['audio', 'muted'],
    ['sdCard', 'enabled'],
    ['wiiRemote', 'rumble'],
    ['channels', 'persistLayout'],
  ]) {
    if (typeof result[section][key] !== 'boolean')
      throw new Error(`${section}.${key} must be true or false.`);
  }
  if (
    !Array.isArray(result.input.grabButtons) ||
    !result.input.grabButtons.length ||
    result.input.grabButtons.some((button) => ![1, 2].includes(button))
  ) {
    throw new Error('input.grabButtons must contain 1 (middle), 2 (right), or both.');
  }
  if (
    !Array.isArray(result.input.homeKeys) ||
    !result.input.homeKeys.length ||
    result.input.homeKeys.some((key) => typeof key !== 'string' || !key.length)
  ) {
    throw new Error('input.homeKeys must contain keyboard key names.');
  }
  if (
    !Number.isFinite(result.wiiRemote.volume) ||
    result.wiiRemote.volume < 0 ||
    result.wiiRemote.volume > 1
  ) {
    throw new Error('wiiRemote.volume must be between 0 and 1.');
  }
  if (
    !Number.isFinite(result.wiiRemote.reconnectDelayMs) ||
    result.wiiRemote.reconnectDelayMs < 0 ||
    result.wiiRemote.reconnectDelayMs > 60000
  ) {
    throw new Error('wiiRemote.reconnectDelayMs must be between 0 and 60000.');
  }
  result.channels.enabled = validateChannelEnabled(result.channels.enabled);
  result.graphics = normalizeGraphics(value.graphics);
  result.wiiRemote.reconnect = validateReconnectFixture(result.wiiRemote.reconnect);
  return result;
}

export async function loadConfig() {
  const response = await fetch('/config.json');
  if (!response.ok) throw new Error('Could not load config.json.');
  return normalizeConfig(await response.json());
}
