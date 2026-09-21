import { indexLayout, poseLayout } from './animation.js';
import { arrowClip, commonArrowDefinitions, createArrowInteraction } from './arrow-interaction.js';
import { ADDRESS_RECIPIENT_LAYOUTS, createBoardAddress } from './board-address.js';

export const LETTER_RECIPIENT_LAYOUTS = [...ADDRESS_RECIPIENT_LAYOUTS, 'my_IplTop_e'];
const FOOTER_PREFIX = 'recipient-footer:';
const footerDurations = { entry: 29, select: 30, cancel: 49 };

/** Local text-recipient selector for LetterWriter route zero. The Address
 * controller owns the book; this wrapper owns the shared footer reservations.
 * Hosts must not draw a second footer, and must wait for the completion callback
 * before opening a composer with footerAlreadyEntered: true.
 */
export function createLetterRecipientPicker(layouts, {
  contacts = [], messages = {}, display = { width: 832 }, onSound = () => {},
  ownWiiNumber = null,
  onSelect = () => {}, onCancel = () => {},
} = {}) {
  for (const key of LETTER_RECIPIENT_LAYOUTS)
    if (!layouts[key]) throw new Error(`Missing original recipient picker layout: ${key}`);
  if (typeof onSelect !== 'function' || typeof onCancel !== 'function')
    throw new TypeError('Recipient completion handlers must be functions.');
  const strings = messages.messages || messages;
  const text = (id, fallback) => strings[id] ?? fallback;
  const source = layouts.my_IplTop_e;
  const animation = source.animations.my_IplTop_e;
  const clip = (group, frame) => ({ animation, group, frame, loop: false });
  const arrows = createArrowInteraction(commonArrowDefinitions(source));
  const backFocus = createArrowInteraction({ back: {
    focusIn: arrowClip(animation, 'G_CalExit', 2900, 2906),
    focusOut: arrowClip(animation, 'G_CalExit', 2930, 2938),
  } });
  let transition = 'entry';
  let action = 'entry';
  let transitionFrame = 0;
  let age = 0;
  let outcome = null;
  let closed = false;
  const begin = (name) => {
    transition = name;
    action = name;
    transitionFrame = 0;
    arrows.hover(null);
    backFocus.hover(null);
  };
  const address = createBoardAddress(layouts, {
    mode: 'recipient', contacts, messages, display, onSound, ownWiiNumber,
    onRecipientTransition: begin,
    onRecipient: (recipient) => { outcome = { recipient }; },
    onCancel: () => { outcome = { cancelled: true }; },
  });
  const direction = (id) => id === 'address-prev' ? 'prev' : id === 'address-next' ? 'next' : null;
  const controls = () => {
    if (closed) return [];
    const state = address.snapshot();
    if (state.modal) return address.controls();
    const disabled = Boolean(transition) || state.locked || state.finished;
    return [
      ...address.controls().map((control) => ({ ...control,
        prefix: direction(control.id) ? FOOTER_PREFIX : control.prefix,
        disabled: disabled || Boolean(control.disabled),
      })),
      { id: 'recipient-back', pane: 'B_CalExit', prefix: FOOTER_PREFIX,
        label: text(79, 'Back'), disabled },
    ];
  };
  const api = {
    controls,
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Invalid picker frame delta.');
      let remaining = frames;
      while (remaining > 0 && !closed) {
        // Preserve scene/queue update boundaries and stop at handoff, so a
        // newly created composer never receives this parent's leftover batch.
        const amount = transition || address.snapshot().locked ? Math.min(1, remaining) : remaining;
        remaining -= amount;
        age += amount;
        arrows.advance(amount);
        backFocus.advance(amount);
        if (transition) transitionFrame += amount;
        address.advance(amount);
        if (transition && transitionFrame >= footerDurations[transition]) transition = null;
        if (outcome && !transition) {
          closed = true;
          if (outcome.cancelled) onCancel();
          else onSelect({ ...outcome.recipient }, { footerAlreadyEntered: true });
        }
      }
    },
    hover(id) {
      if (closed) return false;
      const state = address.snapshot();
      if (state.modal) return address.hover(id);
      const allowed = controls().some((control) => control.id === id && !control.disabled);
      const retainedArrow = !transition && direction(id) && arrows.hovered === direction(id);
      if (!allowed && !retainedArrow) id = null;
      const backChanged = backFocus.hover(id === 'recipient-back' ? 'back' : null);
      const arrowChanged = arrows.hover(direction(id));
      const addressChanged = address.hover(id === 'recipient-back' ? null : id);
      if (backChanged && id === 'recipient-back') onSound('WIPL_SE_BT_TARGETTING');
      return backChanged || arrowChanged || addressChanged;
    },
    activate(id) {
      if (!controls().some((control) => control.id === id && !control.disabled)) return false;
      if (id === 'recipient-back') return api.back();
      const activated = address.activate(id);
      if (activated && direction(id)) arrows.press(direction(id));
      return activated;
    },
    back() {
      if (closed) return false;
      if (address.snapshot().modal) return address.back();
      if (!controls().some((control) => control.id === 'recipient-back' && !control.disabled)) return false;
      return address.back();
    },
    dispose() {
      closed = true;
      outcome = null;
      address.dispose();
      arrows.reset();
      backFocus.reset();
    },
    snapshot: () => ({ ...address.snapshot(), scene: 'recipient-picker',
      closed, transition, frame: transitionFrame,
      locked: closed || Boolean(transition) || address.snapshot().locked }),
    presentation() {
      const body = address.presentation();
      if (closed) return { ...api.snapshot(), layers: [], controls: [] };
      const frame = transitionFrame;
      const clips = [clip('G_SeenChange', 1040), clip('G_SeenChange', 3126), ...backFocus.clips()];
      let left = text(79, 'Back');
      let right = text(36, 'Post');
      if (action === 'entry') {
        clips.push(clip('G_SeenChange', frame < 15
          ? 3213 + Math.min(frame, 13) : 3113 + Math.min(frame - 15, 13)));
      } else if (action === 'select') {
        if (frame >= 14) left = text(37, 'Quit');
        if (frame >= 15) right = text(51, 'Send');
        clips.push(clip('G_SeenChange', frame < 16
          ? 3213 + Math.min(frame, 13) : 3313 + Math.min(frame - 16, 13)));
      } else if (action === 'cancel') {
        clips.push(clip('G_CalExit', 3000 + Math.min(frame, 20)));
        if (frame >= 21) clips.push(clip('G_SeenChange', frame < 35
          ? 3213 + Math.min(frame - 21, 13) : 3113 + Math.min(frame - 35, 13)));
      }
      const departing = ['select', 'cancel'].includes(action);
      for (const side of ['L', 'R']) clips.push(clip(`G_Arw${side}_End`, departing
        ? 10100 + Math.min(frame, 10) : 10150 + Math.min(age, 10)));
      clips.push(clip('G_ArwRoop', 10000 + age % 55), ...arrows.clips());
      const footer = poseLayout(source, clips);
      for (const pane of indexLayout(footer).panes.values()) {
        if (pane.type === 'txt1') pane.text = {
          T_CalExit: left, T_Add: left, T_CalAdd_R: right,
        }[pane.name] ?? '';
      }
      const normalLayers = body.layers.filter((layer) => layer.prefix !== 'address-dialog:');
      const dialogs = body.layers.filter((layer) => layer.prefix === 'address-dialog:');
      return { ...api.snapshot(), layers: [...normalLayers,
        ...(!body.modal ? [{ layout: footer, prefix: FOOTER_PREFIX }] : []), ...dialogs],
      controls: controls() };
    },
  };
  return api;
}
