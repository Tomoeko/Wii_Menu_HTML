import { indexLayout } from './animation.js';
import { createBoardKeyboard } from './board-keyboard.js';

export const SETTINGS_KEYBOARD_UPDATES = 30;

/** Native non-letter keyboard entrance/exit (4.3U 0x8143E9A4/0x814405F0). */
export function settingsKeyboardPose(phase, frame) {
  const time = Math.min(1, Math.max(0, frame / SETTINGS_KEYBOARD_UPDATES));
  const progress = phase === 'enter' ? time : phase === 'exit' ? 1 - time : 1;
  const smooth = progress * progress * (3 - 2 * progress);
  return { y: -200 * (1 - smooth), alpha: Math.trunc(255 * smooth) };
}

/** Settings owns the retained page raster; this controller owns only its native
 * software keyboard. Completion returns text to the original HTML form. */
export function createSettingsKeyboard(
  layouts,
  {
    display,
    measureText,
    measureTextLayout,
    messages = {},
    predict,
    dictionaries,
    getKeyboardPreferences = () => ({}),
    onKeyboardPreferencesChange = () => {},
    onSound = () => {},
    onResult = () => {},
    onComplete = () => {},
  } = {},
) {
  const strings = messages.messages || messages;
  let request = null;
  let keyboard = null;
  let phase = 'closed';
  let frame = 0;
  let completion = null;
  const interactive = () => phase === 'edit';

  function close(text, { reason }) {
    if (!interactive()) return;
    phase = 'exit';
    frame = 0;
    completion = { requestId: request.requestId, text, accepted: reason === 'ok' };
    // Native Manager state 3 begins disappearance. Setting::calcKeyboard
    // updates the HTML input then; state 4 resumes normal input after hiding.
    onResult(completion);
    onSound(`WIPL_SE_SK_${reason === 'ok' ? 'DECIDE' : 'CANCEL'}_CLOSE`);
  }

  return {
    get active() {
      return keyboard !== null;
    },
    reset() {
      // A global scene exit already closes the Settings surface and discards
      // its pending form request. Do not deliver stale callbacks afterward.
      const wasActive = keyboard !== null;
      keyboard?.dispose();
      request = null;
      keyboard = null;
      phase = 'closed';
      frame = 0;
      completion = null;
      return wasActive;
    },
    open(next) {
      if (keyboard || !['console-nickname', 'settings-form'].includes(next?.profile)) return false;
      if (![3, 5, 6, 7, 10, 13].includes(next.nativeType ?? 6)) return false;
      const maxLength = Math.min(255, Math.max(1, Number(next.maxLength) || 10));
      request = { ...next };
      keyboard = createBoardKeyboard(layouts, {
        initialPreferences: getKeyboardPreferences(),
        onPreferencesChange: onKeyboardPreferencesChange,
        profile: next.profile,
        nativeType: next.nativeType ?? 6,
        maxLength,
        rowLimit: next.rowLimit ?? 1,
        secret: Boolean(next.secret),
        multiline: false,
        predictionAllowed: next.predictionAllowed === true,
        languageSelectionAllowed: next.languageSelectionAllowed === true,
        layoutSelectionAllowed:
          next.layoutSelectionAllowed ?? [5, 6, 13].includes(next.nativeType ?? 6),
        symbolsAllowed: next.symbolsAllowed === true,
        showTextBox: true,
        showBackground: true,
        value: String(next.text ?? '')
          .replace(/[\r\n]/g, '')
          .slice(0, maxLength),
        title: next.title || strings[next.titleId] || '',
        cancelLabel: strings[37] || 'Quit',
        display,
        measureText,
        measureTextLayout,
        predict,
        dictionaries,
        onSound,
        onClose: close,
      });
      phase = 'enter';
      frame = 0;
      completion = null;
      onSound('WIPL_SE_SK_OPEN');
      return true;
    },
    advance(frames) {
      if (!keyboard || !Number.isFinite(frames) || frames <= 0) return;
      keyboard.advance(frames);
      if (phase !== 'enter' && phase !== 'exit') return;
      frame = Math.min(SETTINGS_KEYBOARD_UPDATES, frame + frames);
      if (frame < SETTINGS_KEYBOARD_UPDATES) return;
      if (phase === 'enter') phase = 'edit';
      else {
        const result = completion;
        request = null;
        keyboard = null;
        phase = 'closed';
        completion = null;
        onComplete(result);
      }
    },
    hover: (id) => interactive() && keyboard.hover(id),
    activate: (id, triggers) => interactive() && keyboard.activate(id, triggers),
    holdControl: (id) => interactive() && keyboard.holdControl(id),
    releaseControl: () => keyboard?.releaseControl(),
    selectTextAt: (point) => interactive() && keyboard.selectTextAt(point),
    keyInput: (key, modifiers) =>
      (interactive() || modifiers?.type === 'blur') &&
      (keyboard?.keyInput(key, modifiers) ?? false),
    back: () => interactive() && keyboard.back(),
    getSnapshot: () => ({
      active: keyboard !== null,
      phase,
      frame,
      requestId: request?.requestId ?? null,
      keyboard: keyboard?.snapshot() ?? null,
    }),
    presentation() {
      if (!keyboard) return { layers: [], controls: [] };
      const result = keyboard.presentation();
      const pose = settingsKeyboardPose(phase, frame);
      for (const layer of result.layers) {
        if (layer.prefix === 'keyboard-toolbar:') {
          const panes = indexLayout(layer.layout).panes;
          const up = panes.get('N_UP');
          const down = panes.get('N_DOWN');
          up.translation[1] -= pose.y / 3;
          down.translation[1] += pose.y / 3;
          up.alpha = phase === 'enter' ? 0 : pose.alpha;
          down.alpha = pose.alpha;
        } else {
          if (layer.prefix !== 'keyboard-background:') layer.layout.root.translation[1] += pose.y;
          if (layer.clipFollowsRoot) layer.clip.y -= pose.y;
          layer.alpha = pose.alpha / 255;
        }
      }
      return {
        ...result,
        controls: interactive() ? result.controls : [],
      };
    },
  };
}
