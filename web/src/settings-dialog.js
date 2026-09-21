import { indexLayout, poseLayout } from './animation.js';

export const SETTINGS_DIALOG_LAYOUTS = ['my_DialogWindow_a0'];
export const SETTINGS_VALIDATION_HOLD_UPDATES = 181;
const LAYOUT = SETTINGS_DIALOG_LAYOUTS[0];

/** Settings validation calls DialogWindow::callBtn0(message, 180, false).
 * Native stt_normal exits when ++counter > 180; it exposes no dismiss button. */
export function createSettingsDialog(
  layouts,
  { messages = {}, onSound = () => {}, onComplete = () => {} } = {},
) {
  const strings = messages.messages || messages;
  const source = layouts[LAYOUT];
  let request = null;
  let phase = 'closed';
  let frame = 0;
  const animation = (suffix) => source.animations[`${LAYOUT}_${suffix}`];

  return {
    get active() {
      return request !== null;
    },
    open(next) {
      if (request || !source || !Number.isInteger(next?.messageId)) return false;
      request = { ...next };
      phase = 'enter';
      frame = 0;
      onSound('WIPL_SE_INFO_WINDOW');
      return true;
    },
    reset() {
      const active = request !== null;
      request = null;
      phase = 'closed';
      frame = 0;
      return active;
    },
    hover: () => false,
    activate: () => false,
    back: () => false,
    keyInput: () => false,
    advance(frames) {
      if (!request || !Number.isFinite(frames) || frames <= 0) return;
      frame += frames;
      while (request) {
        const duration =
          phase === 'hold'
            ? SETTINGS_VALIDATION_HOLD_UPDATES
            : animation(phase === 'enter' ? 'DialogIn' : 'DialogOut').frames;
        if (frame < duration) break;
        frame -= duration;
        if (phase === 'enter') phase = 'hold';
        else if (phase === 'hold') phase = 'exit';
        else {
          const requestId = request.requestId;
          request = null;
          phase = 'closed';
          frame = 0;
          onComplete(requestId);
        }
      }
    },
    presentation() {
      if (!request) return { layers: [], controls: [], locked: false };
      const suffix = phase === 'exit' ? 'DialogOut' : 'DialogIn';
      const layout = poseLayout(source, [
        {
          animation: animation(suffix),
          group: 'G_InOut',
          frame: phase === 'hold' ? animation(suffix).frames - 1 : frame,
          loop: false,
        },
      ]);
      const panes = indexLayout(layout).panes;
      panes.get('T_Dialog').text = strings[request.messageId] || '';
      for (const name of ['Wait_00', 'N_Prog']) panes.get(name).flags &= ~1;
      return {
        layers: [{ layout, prefix: 'settings-validation:' }],
        controls: [],
        locked: true,
      };
    },
    getSnapshot: () => ({ active: request !== null, phase, frame, requestId: request?.requestId }),
  };
}
