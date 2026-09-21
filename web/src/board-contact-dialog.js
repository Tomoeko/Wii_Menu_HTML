import { indexLayout, poseLayout } from './animation.js';

export const CONTACT_DIALOG_LAYOUTS = ['my_DialogWindow_b', 'my_DialogWindow_a1'];
export const SERVICE_DIALOG_LAYOUT = 'my_DialogWindow_a2';
const PREFIX = 'address-dialog:';

/** AddressEdit uses callSBtn2(No, Yes, true): its question stays on the
 * contact card, N_Top is hidden, and the left Yes / right No buttons own input.
 * After deletion, callBtn1(message 81, OK) presents the completed local action.
 */
export function createContactDialog(
  layouts,
  { kind, content = '', messages = {}, onSound = () => {}, onDone = () => {} },
) {
  if (!['erase', 'erased', 'no-mii', 'address', 'network', 'pending-registration',
    'duplicate-wii', 'duplicate-email', 'own-wii', 'invalid-wii', 'invalid-email',
    'book-full', 'registered'].includes(kind))
    throw new Error('Unknown contact dialog.');
  const strings = messages.messages || messages;
  const key = kind === 'network' ? SERVICE_DIALOG_LAYOUT
    : kind === 'erase' ? CONTACT_DIALOG_LAYOUTS[0] : CONTACT_DIALOG_LAYOUTS[1];
  const source = layouts[key];
  const noticeButton = {
    erased: 'address-erased-ok', 'no-mii': 'address-mii-ok', address: 'address-info-ok',
    'pending-registration': 'address-pending-ok',
    'duplicate-wii': 'address-duplicate-ok', 'duplicate-email': 'address-duplicate-ok',
    'own-wii': 'address-invalid-ok', 'invalid-wii': 'address-invalid-ok',
    'invalid-email': 'address-invalid-ok',
    'book-full': 'address-full-ok',
    registered: 'address-registered-ok',
  };
  const noticeText = {
    erased: strings[81] ?? 'That Wii Friend has been erased.',
    'no-mii': strings[380] ?? 'No Miis have been registered.\nPlease use the Mii Channel to\ncreate a Mii.',
    address: content,
    'duplicate-wii': strings[82] ?? 'That Wii Number is already registered.',
    'duplicate-email': strings[83] ?? 'That e-mail address is already registered.',
    'own-wii': strings[86] ?? "This Wii Number can't be registered.",
    'invalid-wii': strings[84] ?? 'This Wii Number is incorrect.',
    'invalid-email': strings[446]
      ?? 'The information you entered\nis incorrect. Please check the\ninformation and try again.',
    'pending-registration': strings[87]
      ?? 'Confirming registration...\n\nYou must register one another to\nbe able to exchange messages.',
    'book-full': strings[80]
      ?? "Your address book is full, so you\ncan't register a new address.",
    registered: strings[74]
      ?? 'The address has been registered.\nTo exchange messages, you must both\nregister one another and configure\nyour Internet settings.',
    network: strings[324] ?? 'No Internet connection has been configured.\nPlease configure your Internet settings.',
  };
  const choices = kind === 'network'
    ? [{ id: 'network-quit', side: 'A', message: 37, fallback: 'Quit' },
      { id: 'network-settings', side: 'B', message: 326, fallback: 'Settings' }]
    : kind === 'erase'
    ? [{ id: 'address-erase-yes', side: 'A', message: 321, fallback: 'Yes' },
      { id: 'address-erase-no', side: 'B', message: 322, fallback: 'No' }]
    : [{ id: noticeButton[kind], side: 'B', message: 46, fallback: 'OK' }];
  let phase = 'enter';
  let frame = 0;
  let selected = null;
  let hovered = null;
  const focus = new Map();
  const animation = (suffix) => source.animations[`${key}_${suffix}`];
  const clip = (suffix, group, age) => ({
    animation: animation(suffix), group, frame: Math.min(age, animation(suffix).frames - 1), loop: false,
  });
  const duration = () => animation(phase === 'enter' ? 'DialogIn'
    : phase === 'select' ? 'SelectBtn_Ac' : 'DialogOut').frames;
  onSound('WIPL_SE_INFO_WINDOW');
  const api = {
    remaining: () => ['idle', 'done'].includes(phase) ? Infinity : duration() - frame,
    hover(id) {
      if (phase !== 'idle' || !choices.some((choice) => choice.id === id)) id = null;
      if (hovered === id) return false;
      if (hovered) focus.set(hovered, { entering: false, frame: 0 });
      hovered = id;
      if (id) {
        focus.set(id, { entering: true, frame: 0 });
        onSound('WIPL_SE_BT_TARGETTING');
      }
      return true;
    },
    activate(id) {
      if (phase !== 'idle' || !choices.some((choice) => choice.id === id)) return false;
      selected = choices.find((choice) => choice.id === id);
      phase = 'select';
      frame = 0;
      onSound(['address-erase-no', 'network-quit'].includes(id) ? 'WIPL_SE_CANCEL' : 'WIPL_SE_DECIDE');
      return true;
    },
    back: () => api.activate(kind === 'erase' ? 'address-erase-no' : choices[0].id),
    advance(frames) {
      for (const state of focus.values()) state.frame += frames;
      if (phase === 'idle' || phase === 'done') return;
      frame += frames;
      while (!['idle', 'done'].includes(phase) && frame >= duration()) {
        frame -= duration();
        if (phase === 'enter') phase = 'idle';
        else if (phase === 'select') phase = 'exit';
        else {
          phase = 'done';
          onDone(!['address-erase-no', 'network-quit'].includes(selected.id));
        }
      }
    },
    snapshot: () => ({ phase, frame, kind }),
    presentation() {
      const clips = [clip('DialogIn', 'G_InOut', phase === 'enter' ? frame : Infinity)];
      for (const [id, state] of focus) {
        const { side } = choices.find((choice) => choice.id === id);
        clips.push(clip(state.entering ? 'FocusBtn_on' : 'FocusBtn_off', `G_FocusBtn${side}`, state.frame));
      }
      if (selected) clips.push(clip('SelectBtn_Ac', `G_SelectBtn${selected.side}`,
        phase === 'select' ? frame : Infinity));
      if (phase === 'exit') clips.push(clip('DialogOut', 'G_InOut', frame));
      const layout = poseLayout(source, clips);
      const panes = indexLayout(layout).panes;
      if (kind === 'erase') panes.get('N_Top').flags &= ~1;
      else panes.get('T_Dialog').text = noticeText[kind];
      for (const choice of choices)
        panes.get(`T_Btn${choice.side}`).text = strings[choice.message] ?? choice.fallback;
      return {
        layers: [{ layout, prefix: PREFIX }],
        controls: choices.map((choice) => ({
          id: choice.id, label: strings[choice.message] ?? choice.fallback,
          pane: `B_Btn${choice.side}`, prefix: PREFIX, disabled: phase !== 'idle',
        })),
      };
    },
  };
  return api;
}
