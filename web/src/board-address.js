import { indexLayout, poseLayout } from './animation.js';
import { createBoardKeyboard } from './board-keyboard.js';
import { isPrimaryKeyboardTrigger } from './keyboard-activation.js';
import { CONTACT_DIALOG_LAYOUTS, createContactDialog } from './board-contact-dialog.js';
import { createPaneAnimationBinding } from './pane-animation-binding.js';
import { validateContacts } from './contact-storage.js';
import { registrationAddressIssue, validateOwnWiiNumber } from './address-validation.js';
import {
  addressBookGeometry,
  applyAddressBookGeometry,
  addressBookAlphaRoots,
} from './address-book-pages.js';

export const ADDRESS_LAYOUTS = [
  'th_Adress_a', 'th_Adress_b', 'th_Adress_c', 'th_Adress_d', ...CONTACT_DIALOG_LAYOUTS,
];
export const ADDRESS_RECIPIENT_LAYOUTS = [...ADDRESS_LAYOUTS, 'my_Dialog_a'];
const BOOK = ADDRESS_LAYOUTS[0],
  CARD = ADDRESS_LAYOUTS[1],
  FORM = ADDRESS_LAYOUTS[2],
  KIND = ADDRESS_LAYOUTS[3];
const suffix = (value) => String(value).padStart(2, '0');
const writeText = (layout, values) => {
  for (const pane of indexLayout(layout).panes.values())
    if (pane.type === 'txt1') pane.text = values[pane.name] ?? '';
  return layout;
};

/** Offline Address Book fixture. Authored page turns, registration selector,
 * cards and keytops are reused. The Address controller's broader
 * network/registration state machine is deliberately not claimed as reproduced.
 */
export function createBoardAddress(
  layouts,
  {
    messages = {},
    contacts = [],
    ownWiiNumber = null,
    onContacts = () => {},
    onContactsError = () => {},
    onAction = () => {},
    onSound = () => {},
    display = { width: 832 },
    measureText,
    measureTextLayout,
    predict,
    getKeyboardPreferences = () => ({}),
    onKeyboardPreferencesChange = () => {},
    mode = 'manage',
    onRecipient = () => {},
    onCancel = () => {},
    onRecipientTransition = () => {},
  } = {},
) {
  if (!['manage', 'recipient'].includes(mode)) throw new Error('Invalid Address Book mode.');
  const recipientMode = mode === 'recipient';
  const requiredLayouts = recipientMode ? ADDRESS_RECIPIENT_LAYOUTS : ADDRESS_LAYOUTS;
  for (const key of requiredLayouts)
    if (!layouts[key]) throw new Error(`Missing original Address Book layout: ${key}`);
  const strings = messages.messages || messages,
    text = (id, fallback) => strings[id] ?? fallback;
  const entries = validateContacts(contacts);
  const consoleNumber = validateOwnWiiNumber(ownWiiNumber);
  const copyContacts = () => structuredClone(entries);
  let step = 'book',
    page = 0,
    pendingPage = null,
    phase = null,
    keyboard = null,
    focus = null,
    focusAge = 0,
    focusClips = [];
  let registration = { kind: 'wii', address: '', nickname: '' },
    selected = -1;
  let formOrigin = 'registration';
  let dialog = null;
  let erasing = false;
  let pendingMutation = null;
  let disposed = false;
  let recipientFinished = false;
  let bases = Object.fromEntries(requiredLayouts.map((key) => [key, poseLayout(layouts[key])]));
  // Local fixture confirmation is explicit, and never queries WiiConnect24.
  const eligible = (contact) => Boolean(contact) && contact.confirmed !== false;
  const saveContactsChange = (next, onSaved, onFailure = () => {}) => {
    const attempt = {};
    pendingMutation = attempt;
    const success = () => {
      if (disposed || pendingMutation !== attempt) return;
      pendingMutation = null;
      entries.splice(0, entries.length, ...next);
      onSaved();
    };
    const failure = (error) => {
      if (disposed || pendingMutation !== attempt) return;
      pendingMutation = null;
      onFailure();
      onContactsError(error);
    };
    try {
      const result = onContacts(structuredClone(next));
      if (result && typeof result.then === 'function') result.then(success, failure);
      else success();
    } catch (error) {
      failure(error);
    }
  };
  const clip = (key, name, group, reverse = false) => ({
    key,
    animation: layouts[key].animations[`${key}_${name}`],
    group,
    reverse,
  });
  const bindCardPane = createPaneAnimationBinding(layouts[CARD]);
  const addressValueClip = (name) => ({
    key: CARD,
    animation: bindCardPane(layouts[CARD].animations[`${CARD}_${name}`], 'T_frnd_crd_00'),
  });
  const addressValue = (shorten = false) => {
    const value = registration.address;
    if (registration.kind === 'wii') return value.replace(/(.{4})(?=.)/g, '$1 ');
    // AddressData 0x8138E394 retains the full email separately from its card
    // label, which abbreviates values longer than sixteen UTF-16 code units.
    return shorten && value.length > 16 ? `${value.slice(0, 14)}...` : value;
  };
  const sample = (item, age) => ({
    ...item,
    frame: item.reverse
      ? Math.max(0, item.animation.frames - 1 - age)
      : Math.min(item.animation.frames - 1, age),
    loop: false,
  });
  const posed = (key, clips, frame, base = bases[key]) =>
    poseLayout(
      base,
      clips.filter((item) => item.key === key).map((item) => sample(item, frame)),
    );
  const commit = (clips, frame) => {
    for (const key of new Set(clips.map((item) => item.key))) bases[key] = posed(key, clips, frame);
  };
  const start = (clips, done) => {
    commit(focusClips, focusAge);
    focusClips = [];
    focus = null;
    phase = {
      clips,
      frame: 0,
      frames: Math.max(0, ...clips.map((item) => item.animation.frames)),
      done,
    };
  };
  const bookIn = () => [
    clip(BOOK, 'note_alp_in', 'G_note_all'),
    clip(BOOK, 'note_trns_in', 'G_note_all'),
  ];
  const bookOut = () => [
    clip(BOOK, 'note_alp_out', 'G_note_all'),
    clip(BOOK, 'note_trns_out', 'G_note_all'),
  ];
  const recipientBook = (entering) => [
    clip(BOOK, entering ? 'note_trns_in' : 'note_trns_out', 'G_note_all'),
    { ...clip('my_Dialog_a', entering ? 'DialogIn' : 'DialogOut'),
      animation: createPaneAnimationBinding(layouts.my_Dialog_a)(
        layouts.my_Dialog_a.animations[`my_Dialog_a_${entering ? 'DialogIn' : 'DialogOut'}`],
        'N_Top',
      ) },
  ];
  const formQuestion = () =>
    step === 'nickname'
      ? formOrigin === 'contact' ? text(50, 'Nickname') : text(73, 'Apply a nickname.')
      : registration.kind === 'wii'
        ? text(71, 'Enter a Wii Number.')
        : text(72, 'Enter an e-mail address.');
  const fieldValue = () => (step === 'nickname' ? registration.nickname : registration.address);
  const addressIssue = () => registrationAddressIssue(registration, {
    contacts: entries, ownWiiNumber: consoleNumber,
  });
  const showAddressIssue = () => {
    if (!registration.address.length) return false;
    const kind = addressIssue();
    if (!kind) return false;
    dialog = createContactDialog(layouts, {
      kind, messages, onSound, onDone() { dialog = null; },
    });
    return true;
  };
  const validField = () =>
    step === 'mii' || step === 'review' ? true : step === 'nickname'
      ? Boolean(registration.nickname.trim())
      : addressIssue() === null;
  const showRegistrationForm = (next, { entering = false, restoring = false } = {}) => {
    step = next;
    const mii = next === 'mii';
    commit([clip(FORM, mii ? 'name_alp_in' : 'mii_alp_in', mii ? 'G_name_00' : 'G_mii')], 0);
    const contents = [
      clip(FORM, 'question_alp_in', 'G_question_00'),
      clip(FORM, mii ? 'mii_alp_in' : 'name_alp_in', mii ? 'G_mii' : 'G_name_00'),
    ];
    if (restoring) commit(contents, Infinity);
    start([
      ...(entering ? [clip(FORM, 'card_strt', 'G_card_strt_fnsh')] : []),
      ...(restoring ? [] : contents),
    ]);
  };
  const showRegistrationReview = () => {
    step = 'review';
    // AddressEdit 0x8138B880 resets the three action buttons at their
    // scale-in start. State 34 uses the common footer and value pane only.
    commit(['crd_btn_00', 'crd_btn_10', 'crd_btn_11', 'crd_btn_gry'].map(
      (group) => clip(CARD, 'btn_scl_in', group),
    ), 0);
    start([
      clip(CARD, 'card_strt', 'card_strt_fnsh'),
      clip(CARD, 'card_msg_alp_in', 'card_msg'),
    ]);
  };
  const saveRegistration = () => {
    // Native state 35 waits for card_fnsh before storing and announcing
    // registration (0x8138BA68). Local persistence must also succeed first.
    start([clip(CARD, 'card_fnsh', 'card_strt_fnsh')], () => {
      let slot = entries.findIndex((entry) => entry === null);
      if (slot < 0) slot = entries.length;
      const next = copyContacts();
      next[slot] = { ...registration };
      saveContactsChange(next, () => {
        selected = slot;
        page = Math.floor(selected / 5) + 1;
        commit(
          [clip(BOOK, 'note_e_rtt', 'G_note_e_rtt'), clip(BOOK, 'note_c_rtt', 'note_c_rtt')],
          16,
        );
        dialog = createContactDialog(layouts, {
          kind: 'registered', messages, onSound,
          onDone() {
            dialog = null;
            step = 'book';
            start(bookIn());
          },
        });
      }, showRegistrationReview);
    });
  };
  const returnToBook = () => {
    const outgoing =
      step === 'kind'
        ? [clip(KIND, 'btn_fnsh', 'G_btn_strt_fnsh')]
        : [
            clip(
              step === 'contact' || step === 'review' ? CARD : FORM,
              'card_fnsh',
              step === 'contact' || step === 'review' ? 'card_strt_fnsh' : 'G_card_strt_fnsh',
            ),
          ];
    start(outgoing, () => {
      step = 'book';
      start(bookIn());
    });
  };
  const openInput = () => {
    // USA 4.3 Address requests at 0x8138CD94/CECC/CFBC use distinct IPL
    // profiles. Forced number/e-mail modes must not overwrite general choices.
    const nickname = step === 'nickname';
    const wiiNumber = !nickname && registration.kind === 'wii';
    onSound('WIPL_SE_SK_OPEN');
    keyboard = createBoardKeyboard(layouts, {
      initialPreferences: getKeyboardPreferences(),
      onPreferencesChange: onKeyboardPreferencesChange,
      nativeType: nickname ? 11 : wiiNumber ? 12 : 7,
      value: fieldValue(),
      maxLength: nickname ? 10 : wiiNumber ? 16 : 99,
      rowLimit: nickname ? 1 : wiiNumber ? 2 : 5,
      multiline: false,
      showTextBox: true,
      onSound,
      display,
      measureText,
      measureTextLayout,
      predict,
      onChange: (value) => {
        registration[step === 'nickname' ? 'nickname' : 'address'] = value;
      },
      onClose: (_value, { reason } = {}) => {
        onSound(reason === 'ok' ? 'WIPL_SE_SK_DECIDE_CLOSE' : 'WIPL_SE_SK_CANCEL_CLOSE');
        keyboard = null;
        // AddressEdit 0x8138A91C preserves the draft and checks own identity,
        // duplicates and validity in that order after a nonempty OK result.
        if (reason === 'ok' && step === 'address') showAddressIssue();
      },
    });
  };
  const controls = () => {
    if (disposed || recipientFinished) return [];
    if (pendingMutation) return [];
    if (dialog) return dialog.presentation().controls;
    if (erasing) return [];
    if (keyboard) return keyboard.controls();
    if (step === 'book')
      return [
        {
          id: 'address-prev',
          pane: 'B_ArwL',
          prefix: 'scene-create-footer:',
          label: 'Previous address page',
        },
        {
          id: 'address-next',
          pane: 'B_ArwR',
          prefix: 'scene-create-footer:',
          label: 'Next address page',
        },
        ...(page
          ? Array.from({ length: 5 }, (_, index) => ({
              id: `address-entry-${index}`,
              pane: `B_name_b_${suffix(index)}`,
              prefix: 'address-book:',
              label: entries[(page - 1) * 5 + index]?.nickname || 'Empty address',
              disabled: !entries[(page - 1) * 5 + index],
            }))
          : []),
      ];
    if (step === 'kind')
      return [
        { id: 'address-wii', pane: 'B_btn_00', prefix: 'address-kind:', label: text(77, 'Wii') },
        {
          id: 'address-email',
          pane: 'B_btn_01',
          prefix: 'address-kind:',
          label: text(70, 'Others'),
        },
      ];
    if (step === 'address' || step === 'nickname')
      return [
        {
          id: 'address-edit',
          pane: 'B_crd_edgi_00',
          prefix: 'address-form:',
          label: formQuestion(),
        },
      ];
    if (step === 'mii') return [{
      id: 'address-mii', pane: 'B_crd_edgi_00', prefix: 'address-form:',
      label: text(139, '←Add a Mii'),
    }];
    if (step === 'review') return [{
      id: 'address-info', pane: 'B_card_beta', prefix: 'address-card:',
      label: registration.kind === 'wii' ? text(44, 'Wii Number') : text(63, 'E-mail Address'),
    }];
    return [
      { id: 'address-mii', pane: 'B_mii_icon_00', prefix: 'address-card:', label: 'Choose a Mii' },
      { id: 'address-info', pane: 'B_card_beta', prefix: 'address-card:',
        label: registration.kind === 'wii' ? text(44, 'Wii Number') : text(63, 'E-mail Address') },
      {
        id: 'address-send',
        pane: 'B_crd_btn_00',
        prefix: 'address-card:',
        label: text(42, 'Send Message'),
      },
      {
        id: 'address-edit-name',
        pane: 'B_crd_btn_10',
        prefix: 'address-card:',
        label: text(43, 'Change\nNickname'),
      },
      {
        id: 'address-erase',
        pane: 'B_crd_btn_11',
        prefix: 'address-card:',
        label: text(47, 'Erase'),
      },
    ];
  };
  const hoverClip = (id, enter) => {
    if (id === 'address-info') return [addressValueClip(`btn_${enter ? 'in' : 'out'}`)];
    if (id?.startsWith('address-entry-'))
      return [
        clip(
          BOOK,
          `name_${enter ? 'in' : 'out'}`,
          `name_b_${suffix(Number(id.split('-').at(-1)))}`,
        ),
      ];
    if (id === 'address-wii' || id === 'address-email')
      return [
        clip(KIND, `btn_${enter ? 'in' : 'out'}`, `G_btn_${id === 'address-wii' ? '00' : '01'}`),
      ];
    const group = id === 'address-mii' ? 'mii_icon_00' :
      id === 'address-send'
        ? 'crd_btn_00'
        : id === 'address-edit-name'
          ? 'crd_btn_10'
          : id === 'address-erase'
            ? 'crd_btn_11'
            : null;
    return group ? [clip(CARD, `btn_${enter ? 'in' : 'out'}`, group)] : [];
  };
  const cardButtons = (direction) => [
    step === 'contact' && !eligible(registration) ? 'crd_btn_gry' : 'crd_btn_00',
    'crd_btn_10', 'crd_btn_11',
  ]
    .map((group) => clip(CARD, `btn_scl_${direction}`, group));
  const returnToContact = () => {
    start([clip(FORM, 'card_fnsh', 'G_card_strt_fnsh')], () => {
      step = 'contact';
      start([clip(CARD, 'card_strt', 'card_strt_fnsh')]);
    });
  };
  // Parent scene status reads do not need private contact records. Share the
  // same state rules while preserving defensive copies in public snapshots.
  function state(includeContacts = false) {
    return {
      step,
      mode,
      finished: recipientFinished,
      page,
      bookGeometry: addressBookGeometry(page, pendingPage, display.width),
      editing: Boolean(keyboard),
      saving: Boolean(pendingMutation),
      locked: Boolean(pendingMutation) || Boolean(phase) || Boolean(keyboard?.snapshot().locked)
        || Boolean(dialog && dialog.snapshot().phase !== 'idle'),
      modal: erasing || Boolean(dialog),
      dialog: dialog?.snapshot() ?? null,
      ...(includeContacts ? { contacts: copyContacts() } : {}),
      rightLabel:
        recipientMode ? '' : step === 'book'
          ? text(41, 'Register')
          : ['address', 'nickname', 'mii', 'review'].includes(step)
            ? text(46, 'OK')
            : '',
      rightDisabled: step === 'book' ? false : !validField(),
    };
  }
  const api = {
    controls,
    holdControl(id) {
      return !disposed && !pendingMutation && !phase && !dialog && !erasing &&
        (keyboard?.holdControl(id) ?? false);
    },
    releaseControl() {
      keyboard?.releaseControl();
    },
    selectTextAt(point) {
      return !disposed && !pendingMutation && !phase && !dialog && !erasing &&
        (keyboard?.selectTextAt(point) ?? false);
    },
    dispose() {
      disposed = true;
      keyboard?.dispose();
      keyboard = null;
      phase = null;
      dialog = null;
      focus = null;
      pendingMutation = null;
    },
    leaveContact(onDone) {
      if (disposed) return false;
      if (pendingMutation || phase || step !== 'contact' || keyboard || dialog || erasing) return false;
      start([clip(CARD, 'card_fnsh', 'card_strt_fnsh')], onDone);
      return true;
    },
    showContact() {
      if (disposed) return false;
      if (phase || step !== 'contact') return false;
      start([clip(CARD, 'card_strt', 'card_strt_fnsh')]);
      return true;
    },
    advance(frames) {
      if (disposed) return;
      keyboard?.advance(frames);
      focusAge += frames;
      let remaining = frames;
      while (remaining > 0 && (phase || dialog)) {
        const activePhase = phase;
        const activeDialog = dialog;
        const amount = Math.min(remaining, phase ? phase.frames - phase.frame : Infinity,
          dialog?.remaining() ?? Infinity);
        remaining -= amount;
        if (activePhase) {
          activePhase.frame += amount;
          if (activePhase.frame >= activePhase.frames) {
            commit(activePhase.clips, activePhase.frames);
            phase = null;
            activePhase.done?.();
          }
        }
        // A dialog created at a phase boundary starts at frame zero; only the
        // dialog that existed at the beginning of this interval advances.
        activeDialog?.advance(amount);
      }
    },
    hover(id) {
      if (disposed || pendingMutation) return false;
      if (dialog) return dialog.hover(id);
      if (erasing) return false;
      if (phase) return false;
      if (keyboard) return keyboard.hover(id);
      // Review's value pane and the no-Miis form do not use card-button
      // focus clips or their cue (0x8138C6DC, 0x8138D1B4).
      if (step === 'mii' || (step === 'review' && id === 'address-info')) id = null;
      if (recipientMode && id?.startsWith('address-entry-')
        && !eligible(entries[(page - 1) * 5 + Number(id.split('-').at(-1))])) id = null;
      if (step === 'contact' && id === 'address-send' && !eligible(registration)) id = null;
      if (id === focus) return false;
      if (id && !controls().some((control) => control.id === id && !control.disabled)) {
        return false;
      }
      commit(focusClips, focusAge);
      focusClips = [...hoverClip(focus, false), ...hoverClip(id, true)];
      focus = id;
      focusAge = 0;
      if (id) onSound('WIPL_SE_BT_TARGETTING');
      return true;
    },
    activate(id, triggers) {
      if (disposed || recipientFinished || pendingMutation) return false;
      if (dialog) return isPrimaryKeyboardTrigger(triggers) && dialog.activate(id);
      if (erasing) return false;
      if (phase) return false;
      if (keyboard) return keyboard.activate(id, triggers);
      if (!isPrimaryKeyboardTrigger(triggers)) return false;
      if (!controls().some((control) => control.id === id && !control.disabled)) return false;
      if (id === 'address-next' || id === 'address-prev') {
        // Address::stt_cover_normal/stt_normal select separate page cues.
        onSound(id === 'address-next' ? 'WIPL_SE_FL_PAGE_INC' : 'WIPL_SE_FL_PAGE_DEC');
        const forward = id === 'address-next';
        pendingPage = (page + (forward ? 1 : -1) + 21) % 21;
        const cover = page === 0 || pendingPage === 0;
        // At either end the native controller turns the cover in the
        // opposite direction while moving the full twenty-page stack.
        const wrapping = (page === 0 && !forward) || (page === 20 && forward);
        start(
          [
            clip(
              BOOK,
              cover ? 'note_e_rtt' : 'note_c_rtt',
              cover ? 'G_note_e_rtt' : 'note_c_rtt',
              wrapping ? forward : !forward,
            ),
          ],
          () => {
            page = pendingPage;
            pendingPage = null;
            // The next stack face is supplied by the controller after each turn.
            commit([clip(BOOK, 'note_c_rtt', 'note_c_rtt')], 15);
          },
        );
        return true;
      }
      if (recipientMode && id.startsWith('address-entry-')) {
        selected = (page - 1) * 5 + Number(id.split('-').at(-1));
        const recipient = { ...entries[selected] };
        if (!eligible(recipient)) {
          dialog = createContactDialog(layouts, {
            kind: 'pending-registration', messages, onSound,
            onDone() { dialog = null; },
          });
          return true;
        }
        onSound('WIPL_SE_DECIDE');
        onRecipientTransition('select');
        start([clip(BOOK, 'name_psh', `name_b_${suffix(selected % 5)}`)], () => {
          start(recipientBook(false), () => {
            recipientFinished = true;
            onRecipient(recipient);
          });
        });
        return true;
      }
      if (id === 'address-send' && !eligible(registration)) {
        // Unlike eligible Send, 0x8138CBF0 opens message 87 immediately,
        // without a button press or the local Letter/network action.
        dialog = createContactDialog(layouts, {
          kind: 'pending-registration', messages, onSound,
          onDone() { dialog = null; },
        });
        return true;
      }
      if (step === 'mii' && id === 'address-mii') {
        // The original zero-Mii branch opens message 380 before DECIDE.
        dialog = createContactDialog(layouts, {
          kind: 'no-mii', messages, onSound, onDone() { dialog = null; },
        });
        onSound('WIPL_SE_DECIDE');
        return true;
      }
      if (id !== 'address-edit') onSound('WIPL_SE_DECIDE');
      if (id.startsWith('address-entry-')) {
        selected = (page - 1) * 5 + Number(id.split('-').at(-1));
        registration = { ...entries[selected] };
        formOrigin = 'contact';
        start([clip(BOOK, 'name_psh', `name_b_${suffix(selected % 5)}`)], () => {
          start(bookOut(), () => {
            step = 'contact';
            commit(cardButtons('in'), 100);
            start([clip(CARD, 'card_strt', 'card_strt_fnsh')]);
          });
        });
        return true;
      }
      if (id === 'address-wii' || id === 'address-email') {
        registration.kind = id === 'address-wii' ? 'wii' : 'email';
        start([clip(KIND, 'btn_psh', `G_btn_${id === 'address-wii' ? '00' : '01'}`)], () => {
          start([clip(KIND, 'btn_fnsh', 'G_btn_strt_fnsh')], () => {
            step = 'address';
            start([
              clip(FORM, 'card_strt', 'G_card_strt_fnsh'),
              clip(FORM, 'question_alp_in', 'G_question_00'),
              clip(FORM, 'name_alp_in', 'G_name_00'),
            ]);
          });
        });
        return true;
      }
      if (id === 'address-edit') {
        openInput();
        return true;
      }
      if (id === 'address-mii') {
        start([clip(CARD, 'btn_psh', 'mii_icon_00')], () => {
          // Original AddressEdit reports message 380 for an empty Mii list.
          dialog = createContactDialog(layouts, {
            kind: 'no-mii', messages, onSound, onDone() { dialog = null; },
          });
        });
        return true;
      }
      if (id === 'address-info') {
        start([addressValueClip('btn_psh')], () => {
          dialog = createContactDialog(layouts, {
            kind: 'address', content: addressValue(), messages, onSound,
            onDone() { dialog = null; },
          });
        });
        return true;
      }
      if (id === 'address-send') {
        start([clip(CARD, 'btn_psh', 'crd_btn_00')], () => {
          onAction('send-message', { contact: { ...registration }, changed: false });
        });
        return true;
      }
      if (id === 'address-edit-name') {
        formOrigin = step;
        start(
          [clip(CARD, 'btn_psh', 'crd_btn_10')],
          () => {
            start([clip(CARD, 'card_fnsh', 'card_strt_fnsh')], () => {
              step = 'nickname';
              start([
                clip(FORM, 'card_strt', 'G_card_strt_fnsh'),
                clip(FORM, 'question_alp_in', 'G_question_00'),
                clip(FORM, 'name_alp_in', 'G_name_00'),
              ]);
            });
          },
        );
        return true;
      }
      start([clip(CARD, 'btn_psh', 'crd_btn_11')], () => {
        // AddressEdit 0x8138967C retires card buttons before asking to erase.
        erasing = true;
        start(cardButtons('out'), () => {
          start([clip(CARD, 'card_msg_alp_in', 'card_msg')]);
          dialog = createContactDialog(layouts, {
            kind: 'erase', messages, onSound,
            onDone(confirmed) {
              dialog = null;
              const finish = (erased) => {
                start([clip(CARD, 'card_msg_alp_out', 'card_msg')], () => {
                  if (!erased) {
                    start(cardButtons('in'), () => { erasing = false; });
                    return;
                  }
                  dialog = createContactDialog(layouts, {
                    kind: 'erased', messages, onSound,
                    onDone() {
                      dialog = null;
                      erasing = false;
                      returnToBook();
                    },
                  });
                });
              };
              if (!confirmed) finish(false);
              else {
                // 0x81386F84 clears this slot without moving later contacts.
                // The local success notice additionally waits for persistence.
                const next = copyContacts();
                next[selected] = null;
                saveContactsChange(next, () => finish(true), () => finish(false));
              }
            },
          });
        });
      });
      return true;
    },
    submit() {
      if (disposed || pendingMutation) return false;
      if (recipientMode) return false;
      if (phase || keyboard || erasing || dialog) return false;
      if (step === 'book') {
        if (entries.filter(Boolean).length >= 100) {
          // Address 0x813861A4 checks occupied slots after the service gate,
          // then opens message 80. A full book still accepts Register.
          dialog = createContactDialog(layouts, {
            kind: 'book-full', messages, onSound, onDone() { dialog = null; },
          });
          return true;
        }
        formOrigin = 'registration';
        selected = -1;
        registration = { kind: 'wii', address: '', nickname: '' };
        start(bookOut(), () => {
          step = 'kind';
          start([clip(KIND, 'btn_strt', 'G_btn_strt_fnsh')]);
        });
        return true;
      }
      if (step === 'address' && showAddressIssue()) return false;
      if (step === 'review') {
        saveRegistration();
        return true;
      }
      if (step === 'mii') {
        start([clip(FORM, 'card_fnsh', 'G_card_strt_fnsh')], showRegistrationReview);
        return true;
      }
      if ((step === 'address' || step === 'nickname') && validField()) {
        if (formOrigin === 'contact') {
          const next = copyContacts();
          next[selected] = { ...entries[selected], nickname: registration.nickname };
          saveContactsChange(next, returnToContact);
          return true;
        }
        if (step === 'nickname') {
          start([
            clip(FORM, 'question_alp_out', 'G_question_00'),
            clip(FORM, 'name_alp_out', 'G_name_00'),
          ], () => showRegistrationForm('mii'));
        } else {
          start([clip(FORM, 'card_fnsh', 'G_card_strt_fnsh')],
            () => showRegistrationForm('nickname', { entering: true }));
        }
        return true;
      }
      return false;
    },
    back() {
      if (disposed || pendingMutation) return false;
      if (dialog) return dialog.back();
      if (phase || erasing) return false;
      if (keyboard) return keyboard.back();
      if (recipientMode && !recipientFinished) {
        onSound('WIPL_SE_CANCEL');
        onRecipientTransition('cancel');
        start(recipientBook(false), () => {
          recipientFinished = true;
          onCancel();
        });
        return true;
      }
      if (step === 'book') return false;
      onSound('WIPL_SE_CANCEL');
      if (step === 'nickname' && formOrigin === 'contact') {
        registration = { ...entries[selected] };
        returnToContact();
      } else if (step === 'review') {
        start([clip(CARD, 'card_fnsh', 'card_strt_fnsh')],
          () => showRegistrationForm('mii', { entering: true, restoring: true }));
      } else if (step === 'mii') {
        start([
          clip(FORM, 'question_alp_out', 'G_question_00'),
          clip(FORM, 'mii_alp_out', 'G_mii'),
        ], () => showRegistrationForm('nickname'));
      } else if (step === 'nickname') {
        start([
          clip(FORM, 'question_alp_out', 'G_question_00'),
          clip(FORM, 'name_alp_out', 'G_name_00'),
        ], () => showRegistrationForm('address'));
      } else returnToBook();
      return true;
    },
    keyInput(key, modifiers) {
      if (disposed) return false;
      if (modifiers?.type === 'blur') keyboard?.releaseControl();
      return (!phase || modifiers?.type === 'blur') && keyboard
        ? keyboard.keyInput(key, modifiers) : false;
    },
    interactionState: () => state(),
    snapshot: () => state(true),
    presentation() {
      const work = (key) =>
        posed(key, focusClips, focusAge, posed(key, phase?.clips || [], phase?.frame || 0));
      const layers = [];
      if (step === 'book') {
        const geometry = addressBookGeometry(page, pendingPage, display.width);
        const values = {
          T_wii_msg: text(66, "This console's Wii Number:"),
          T_wii_name: (consoleNumber ?? '0000000000000000').match(/.{4}/g).join(' '),
          T_adrs_00: text(134, 'Address Book'),
          T_nmbr_b: `${geometry.facePage}/20`,
          T_nmbr_c: `${geometry.turnPage}/20`,
        };
        for (let index = 0; index < 5; index++) {
          values[`T_name_b_${suffix(index)}`] =
            entries[(geometry.facePage - 1) * 5 + index]?.nickname ?? '';
          values[`T_name_c_${suffix(index)}`] =
            entries[(geometry.turnPage - 1) * 5 + index]?.nickname ?? '';
        }
        let book = work(BOOK);
        if (recipientMode) {
          const grayClips = [];
          for (let index = 0; index < 5; index++) {
            if (!eligible(entries[(geometry.facePage - 1) * 5 + index]))
              // 0x81384124 resets the inactive row's gray-in clip at frame
              // zero. Its final frame is the gray hover color, not idle.
              grayClips.push(sample(clip(BOOK, 'gry_name_in', `name_b_${suffix(index)}`), 0));
            grayClips.push(sample(clip(BOOK, 'name_c_gry', `G_name_c_${suffix(index)}`),
              eligible(entries[(geometry.turnPage - 1) * 5 + index]) ? 0 : 1));
          }
          book = poseLayout(book, grayClips);
        }
        book = applyAddressBookGeometry(writeText(book, values), geometry);
        layers.push({
          layout: book,
          prefix: 'address-book:',
          alphaContextRoots: addressBookAlphaRoots(book),
        });
        if (recipientMode) layers.push({
          layout: writeText(work('my_Dialog_a'), { T_Dialog: text(78, 'Choose an address') }),
          prefix: 'address-prompt:',
        });
      } else if (step === 'kind')
        layers.push({
          layout: writeText(work(KIND), {
            T_btn_name_00: text(77, 'Wii'),
            T_btn_name_01: text(70, 'Others'),
          }),
          prefix: 'address-kind:',
        });
      else if (step === 'address' || step === 'nickname' || step === 'mii') {
        const form = writeText(work(FORM), {
          T_question_00: step === 'mii' ? text(85, 'You can attach a Mii.') : formQuestion(),
          T_name_00: step === 'mii' ? '' : fieldValue(),
          T_msg_00: formOrigin === 'contact' ? text(73, 'Apply nickname') : '',
          T_mii_msg_00: step === 'mii' ? text(139, '←Add a Mii') : '',
        });
        if (step !== 'mii') indexLayout(form).panes.get('N_mii_all').flags &= ~1;
        layers.push({ layout: form, prefix: 'address-form:' });
      } else {
        const inactiveButton = step === 'contact' && !eligible(registration)
          ? 'crd_btn_00' : 'crd_btn_gry';
        // Native initialization resets the inactive scale-in clip at zero;
        // the authored gray branch replaces Send while registration is pending.
        const card = writeText(poseLayout(work(CARD), [
          sample(clip(CARD, 'btn_scl_in', inactiveButton), 0),
        ]), {
          T_name_00: registration.nickname,
          T_frnd_crd_00: addressValue(true),
          T_card_msg_00: erasing ? text(48, 'Erase this?')
            : step === 'review' ? text(68, 'This information has been\nadded to your address book.') : '',
          T_crd_btn_00: text(42, 'Send Message'),
          T_crd_btn_10: text(43, 'Change\nNickname'),
          T_crd_btn_11: text(47, 'Erase'),
          T_crd_btn_gry: text(42, 'Send Message'),
        });
        layers.push({ layout: card, prefix: 'address-card:' });
      }
      if (keyboard) layers.push(...keyboard.presentation().layers);
      if (dialog) layers.push(...dialog.presentation().layers);
      return {
        ...api.snapshot(),
        layers,
        controls: controls().map((control) => ({
          ...control,
          disabled: Boolean(phase) || Boolean(control.disabled),
        })),
      };
    },
  };
  // The BRLYT is saved in a turned-page editor pose. Frame zero restores
  // the closed cover shown by the fresh native Address Book capture.
  commit([clip(BOOK, 'note_e_rtt', 'G_note_e_rtt'), clip(BOOK, 'note_c_rtt', 'note_c_rtt')], 0);
  commit(
    Array.from({ length: 5 }, (_, index) => clip(BOOK, 'name_out', `name_b_${suffix(index)}`)),
    6,
  );
  start(recipientMode ? recipientBook(true) : bookIn(), recipientMode ? () => {
    // 0x81382A4C uses occupied count, not the first occupied slot or the
    // number of confirmed contacts. State zero then opens the first page.
    if (entries.some(Boolean)) api.activate('address-next');
  } : undefined);
  return api;
}
