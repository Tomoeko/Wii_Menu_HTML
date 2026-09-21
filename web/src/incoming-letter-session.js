import { createIncomingLetterReader, INCOMING_LETTER_LAYOUTS } from './incoming-letter-reader.js';
import { createBoardLetter } from './board-letter.js';
import { createContactDialog, SERVICE_DIALOG_LAYOUT } from './board-contact-dialog.js';
import { isPrimaryKeyboardTrigger } from './keyboard-activation.js';

export const INCOMING_SESSION_LAYOUTS = [...INCOMING_LETTER_LAYOUTS, SERVICE_DIALOG_LAYOUT];

/** The Board owns the reader; this session owns its local Reply composer and
 * service dialog. Closing or replacing the Board silently disposes all children.
 */
export function createIncomingLetterSession(layouts, options) {
  let composer = null;
  let dialog = null;
  let disposed = false;
  let replyDraft = '';
  const reader = createIncomingLetterReader(layouts, {
    ...options,
    onReply({ recipient }) {
      if (disposed) return;
      composer = createBoardLetter(layouts, {
        ...options,
        recipient,
        draft: replyDraft,
        footerAlreadyEntered: true,
        onDraft(value) { replyDraft = value; },
        onDone() {
          if (disposed) return;
          composer?.dispose();
          composer = null;
          reader.resumeReply();
        },
      });
    },
    onReplyError: options.onLetterError,
    onServiceRequired() {
      if (disposed) return;
      reader.suspendAudio();
      dialog = createContactDialog(layouts, {
        kind: 'network', messages: options.messages, onSound: options.onSound,
        onDone(openSettings) {
          if (disposed) return;
          dialog = null;
          if (openSettings) options.onAction?.('network-settings');
        },
      });
    },
  });
  const active = () => dialog || composer || reader;
  const api = {
    advance(frames) {
      if (disposed) return;
      // A newly created child starts on the next update, not with the elapsed
      // batch that completed its parent's transition.
      active().advance(frames);
    },
    hover: (id) => !disposed && active().hover(id),
    activate(id, triggers) {
      if (disposed) return false;
      if (composer && !dialog) return composer.activate(id, triggers);
      return isPrimaryKeyboardTrigger(triggers) && active().activate(id);
    },
    back: () => !disposed && active().back(),
    holdControl(id) {
      if (disposed || dialog) return false;
      if (composer) return composer.holdControl(id);
      // Reader scrolls are down-triggered, unlike the composer's held repeat.
      if (!id?.startsWith('incoming-scroll-') || !reader.controls().some(
        (control) => control.id === id && !control.disabled,
      )) return false;
      reader.hover(id);
      reader.activate(id);
      return true;
    },
    releaseControl() { composer?.releaseControl(); },
    selectTextAt: (point) => !disposed && !dialog && Boolean(composer?.selectTextAt(point)),
    keyInput(key, modifiers) {
      if (disposed) return false;
      if (modifiers?.type === 'blur') {
        api.releaseControl();
        active().hover(null);
        reader.suspendAudio();
        return false;
      }
      if (composer) return composer.keyInput(key, modifiers) ||
        (key === 'Escape' && modifiers?.type !== 'keyup' && composer.back());
      if (key === 'Escape') return api.back();
      if (!dialog && ['ArrowUp', 'ArrowDown'].includes(key))
        return reader.activate(key === 'ArrowUp' ? 'incoming-scroll-up' : 'incoming-scroll-down');
      return false;
    },
    suspendAudio() { reader.suspendAudio(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      composer?.dispose();
      composer = null;
      dialog = null;
      reader.dispose();
    },
    snapshot() {
      const state = reader.snapshot();
      const child = composer?.snapshot();
      return { ...state, scene: 'incoming-letter', reading: !disposed && !state.closed,
        editing: Boolean(child?.editing), composing: Boolean(composer), modal: Boolean(dialog),
        locked: disposed || (dialog ? dialog.snapshot().phase !== 'idle'
          : child ? child.locked : state.locked),
        readerPhase: state.phase, readerFrame: state.frame };
    },
    presentation() {
      if (disposed) return { ...api.snapshot(), layers: [], controls: [] };
      const view = reader.presentation();
      const child = (dialog || composer)?.presentation();
      return { ...api.snapshot(), layers: [...view.layers, ...(child?.layers || [])],
        controls: child?.controls || view.controls };
    },
  };
  return api;
}
