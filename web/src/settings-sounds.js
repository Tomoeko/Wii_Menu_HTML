// USA 4.3 Setting::setSE, 0x813F9834; switch table at 0x81657700.
// Values are written by the original HTML to wii.se / wii.excse.
const sounds = new Map([
  [1, 'WIPL_SE_BT_PUSH'],
  [2, 'WIPL_SE_BT_TARGETTING'],
  [3, 'WIPL_SE_DECIDE'],
  [4, 'WIPL_SE_CANCEL'],
  [5, 'WIPL_SE_CHOICE_CHG'],
  [6, 'WIPL_SE_CHAR_DELETE_ERROR'],
  [10, 'WIPL_SE_OUTPUT_MODE_SELECT'],
  [11, 'WIPL_SE_OUTPUT_MODE_SELECT'],
  [12, 'WIPL_SE_OUTPUT_MODE_SELECT'],
  [30, 'WIPL_SE_CANCEL'],
  [31, 'WIPL_SE_CANCEL'],
  [32, 'WIPL_SE_CANCEL'],
]);

export function settingsSoundSymbol(value) {
  return sounds.get(value) ?? null;
}

/** www::wiisetting::Setter_ collects se/excse; Setting::setSE consumes them
 * once per update. Decisions replace a same-update hover. The native browser
 * readiness counter's additional hover suppression is a separate boundary. */
export function createSettingsSoundQueue() {
  let primary = 0;
  let exceptional = 0;
  let frameRemainder = 0;
  return {
    request(value, { channel = 'se' } = {}) {
      if (!Number.isFinite(value)) return;
      const byte = Math.trunc(value) & 255;
      if (byte === 2 && (primary !== 0 || exceptional !== 0)) return;
      if (channel === 'excse') exceptional = byte;
      else primary = byte;
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Invalid sound clock');
      frameRemainder += frames;
      const updates = Math.floor(frameRemainder);
      if (updates === 0) return null;
      frameRemainder -= updates;
      let value = primary;
      if ((value === 0 || value === 2) && exceptional !== 0) value = exceptional;
      primary = 0;
      exceptional = 0;
      return value === 0 ? null : value;
    },
    clear() {
      primary = 0;
      exceptional = 0;
      frameRemainder = 0;
    },
  };
}
