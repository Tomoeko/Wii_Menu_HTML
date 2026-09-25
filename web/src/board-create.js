import { indexLayout, poseLayout, sampleTrack } from './animation.js';
import { KEYBOARD_LAYOUTS, createBoardKeyboard } from './board-keyboard.js';
import { isPrimaryKeyboardTrigger } from './keyboard-activation.js';
import { ADDRESS_LAYOUTS, createBoardAddress } from './board-address.js';
import { createBoardLetter } from './board-letter.js';
import { LETTER_RECIPIENT_LAYOUTS, createLetterRecipientPicker } from './letter-recipient-picker.js';
import { createMemoEditorScroll } from './memo-editor-scroll.js';
import { createMemoScrollArrows } from './memo-scroll-arrows.js';
import { arrangeMessageBody, keyboardTransitionLayers } from './board-message-view.js';
import { keyboardCaretAtPoint } from './keyboard-text-hit.js';
import { createTextScrollRepeat } from './text-scroll-repeat.js';
import { commonArrowDefinitions, createArrowInteraction } from './arrow-interaction.js';
import { createPaneAnimationBinding } from './pane-animation-binding.js';
import { createContactDialog } from './board-contact-dialog.js';

export const CREATE_LAYOUTS = [
  'my_Mail_a',
  'my_IplTop_e',
  'sofkeybd/my_Memo_a',
  'sofkeybd/my_LetterL',
  'th_Adress_a',
  'my_DialogWindow_a2',
  ...KEYBOARD_LAYOUTS,
  ...ADDRESS_LAYOUTS,
  ...LETTER_RECIPIENT_LAYOUTS,
];
const CHOICES = [
  { id: 'memo', pane: 'B_MailIn', stem: 'Mail', label: 'Memo', message: 133 },
  { id: 'letter', pane: 'B_LetterIn', stem: 'Letter', label: 'Letter' },
  { id: 'address', pane: 'B_AdressIn', stem: 'Adress', label: 'Address Book', message: 134 },
];
const setText = (layout, values) => {
  for (const pane of indexLayout(layout).panes.values())
    if (pane.type === 'txt1') pane.text = values[pane.name] ?? '';
  return layout;
};

/** Original Create selector and local Memo/Address flows. Layouts, group
 * bindings and common-button queues follow the WAD and iplMailAddressSelect. */
export function createBoardCreate(
  layouts,
  {
    onBack = () => {},
    messages = {},
    draft = '',
    attachments = [],
    onDraft = () => {},
    onAction = () => {},
    onSound = () => {},
    display,
    measureText,
    predict,
    getKeyboardPreferences = () => ({}),
    onKeyboardPreferencesChange = () => {},
    contacts = [],
    onContacts = () => {},
    onContactsError = () => {},
    localRegistration = false,
    ownWiiNumber = null,
    letterService = 'offline',
    onLetter,
    onLetterError = () => {},
    measureTextLines = (value) => value.split('\n').length,
    measureTextLayout,
  } = {},
) {
  const memoTemplate = layouts['sofkeybd/my_Memo_a'];
  const letterTemplate = indexLayout(memoTemplate).panes.get('T_Letter');
  const memoLines = (value) => {
    if (measureTextLayout) return measureTextLayout(value, letterTemplate, memoTemplate);
    let start = 0;
    return {
      lineHeight: 42,
      lines: value.split('\n').map((text) => {
        const line = { text, start, end: start + text.length };
        start += text.length + 1;
        return line;
      }),
    };
  };
  const memoScroll = createMemoEditorScroll(() => onSound('WIPL_SE_LINE_SCROLL'));
  const memoArrows = createMemoScrollArrows(memoTemplate);
  const bindMemoPane = createPaneAnimationBinding(memoTemplate);
  const miiFocus = createArrowInteraction({
    'memo-mii': {
      focusIn: {
        animation: bindMemoPane(memoTemplate.animations.my_Memo_a_NigaoeFoucusIn, 'Nigaoe'),
        from: 0,
        to: 6,
      },
      focusOut: {
        animation: bindMemoPane(memoTemplate.animations.my_Memo_a_NigaoeFoucusOut, 'Nigaoe'),
        from: 0,
        to: 6,
      },
    },
  });
  const footerAnimation = layouts.my_IplTop_e.animations.my_IplTop_e;
  const footerFocusPane = { back: 'N_BtnL_a3_Cal', submit: 'N_BtnL_a7_Add_R' };
  const footerFocusTrack = Object.fromEntries(
    Object.entries(footerFocusPane).map(([id, paneName]) => [
      id,
      footerAnimation.targets.find((target) => target.name === paneName)
        .tracks.find((track) => track.kind === 'RLPA' && track.target === 6),
    ]),
  );
  const scrollRepeat = createTextScrollRepeat({
    advance: (frames) => api.advance(frames, true),
    activate: (id) => api.activate(id),
  });
  const strings = messages.messages || messages;
  const text = (id, fallback) => strings[id] ?? fallback;
  let editing = false,
    memoText = draft,
    caret = draft.length,
    networkDialog = false;
  let keyboard = null,
    keyboardProgress = 0,
    address = null;
  let miiDialog = null;
  let letter = null;
  let recipientPicker = null;
  const letterDrafts = new Map();
  const addressArrows = createArrowInteraction(commonArrowDefinitions(layouts.my_IplTop_e));
  const addressDirection = (id) =>
    id === 'address-prev' ? 'prev' : id === 'address-next' ? 'next' : null;
  let bases = {},
    age = 0,
    phase = null,
    page = 'selector',
    memoLeaving = false,
    focus = null,
    focusAge = 0,
    focusClips = [];
  const clip = (key, name, group, offset = 0, end, delay = 0) => ({
    key,
    animation: layouts[key]?.animations[name],
    group,
    offset,
    end,
    delay,
  });
  const select = (name, group, delay = 0) =>
    clip('my_Mail_a', `my_Mail_a_${name}`, group, 0, undefined, delay);
  const footer = (from, to, group = 'G_SeenChange', delay = 0) =>
    clip('my_IplTop_e', 'my_IplTop_e', group, from, to, delay);
  const length = (item) =>
    item.end === undefined ? (item.animation?.frames ?? 0) : item.end - item.offset;
  const sample = (item, frame) => ({
    animation: item.animation,
    group: item.group,
    loop: false,
    frame: Math.min(
      item.end ?? Math.max(0, (item.animation?.frames ?? 0) - 1),
      item.offset + Math.max(0, frame - item.delay - (item.startDelay ?? 0)),
    ),
  });
  const posed = (key, clips, frame, base = bases[key]) =>
    poseLayout(
      base,
      clips
        .filter((item) => item.key === key && frame >= item.delay)
        .map((item) => sample(item, frame)),
    );
  const commit = (clips, frame) => {
    for (const key of new Set(clips.map((item) => item.key))) bases[key] = posed(key, clips, frame);
  };
  const start = (clips, done, duration) => {
    scrollRepeat.release();
    commit(focusClips, focusAge);
    addressArrows.hover(null);
    miiFocus.hover(null);
    focus = null;
    focusClips = [];
    phase = {
      clips,
      frame: 0,
      frames:
        duration ??
        Math.max(0, ...clips.map((item) => item.delay + (item.startDelay ?? 0) + length(item))),
      done,
    };
  };
  const bodyKey = () =>
    page === 'memo'
      ? 'sofkeybd/my_Memo_a'
      : page === 'letter'
        ? 'sofkeybd/my_LetterL'
        : 'th_Adress_a';
  const bodyClip = (suffix) => {
    const key = bodyKey(),
      stem = page === 'memo' ? 'my_Memo_a' : 'my_LetterL';
    if (page === 'address')
      return [
        clip(key, `th_Adress_a_note_alp_${suffix === 'MailIn' ? 'in' : 'out'}`, 'G_note_all'),
      ];
    return [clip(key, `${stem}_${suffix}`)];
  };
  const dialogClip = (suffix, group) =>
    clip('my_DialogWindow_a2', `my_DialogWindow_a2_${suffix}`, group);
  const footerFocusStart = (id, enter, layout) => {
    const track = footerFocusTrack[id];
    const current = indexLayout(layout).panes.get(footerFocusPane[id]).scale[0];
    let low = enter ? 2900 : 2930;
    let high = enter ? 2906 : 2938;
    // A quick leave and re-entry resumes the original focus curve at the
    // current pose. Restarting its first frame would snap a partly scaled Back.
    for (let index = 0; index < 14; index++) {
      const middle = (low + high) / 2;
      if ((sampleTrack(track, middle) < current) === enter) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  const hoverClips = (id, enter, layout) => {
    if (id === 'memo-scroll-up' || id === 'memo-scroll-down') return [];
    if (addressDirection(id)) return [];
    if (networkDialog)
      return [
        dialogClip(
          `FocusBtn_${enter ? 'on' : 'off'}`,
          `G_FocusBtn${id === 'network-quit' ? 'A' : 'B'}`,
        ),
      ];
    if (id === 'submit')
      return [footer(footerFocusStart(id, enter, layout), enter ? 2906 : 2938, 'G_Cmn_R')];
    const button = CHOICES.find((button) => button.id === id);
    if (button)
      return [select(`${button.stem}Foucus${enter ? 'In' : 'Out'}`, `G_${button.stem}Foucus`)];
    return id === 'back'
      ? [footer(footerFocusStart(id, enter, layout), enter ? 2906 : 2938, 'G_CalExit')]
      : [];
  };
  const controls = (addressState) => {
    if (letter) return letter.controls();
    if (recipientPicker) return recipientPicker.controls();
    if (miiDialog) return miiDialog.presentation().controls;
    if (keyboard) return [...keyboard.controls(), ...(!phase ? memoArrows.controls() : [])];
    if (networkDialog)
      return [
        { id: 'network-quit', pane: 'B_BtnA', prefix: 'create-network:', label: text(37, 'Quit') },
        {
          id: 'network-settings',
          pane: 'B_BtnB',
          prefix: 'create-network:',
          label: text(326, 'Settings'),
        },
      ];
    addressState ??= address?.interactionState();
    if (addressState?.saving) return [];
    if (addressState?.editing || addressState?.modal) return address.controls();
    return [
      ...(address ? address.controls() : []),
      ...(page === 'selector'
        ? CHOICES.map((choice) => ({
            ...choice,
            label: text(choice.message, choice.label),
            prefix: 'scene-create:',
          }))
        : []),
      ...(page === 'memo'
        ? [
            {
              id: 'memo-edit',
              pane: 'B_2l_TextBox',
              prefix: 'scene-create-body:',
              label: 'Write a memo',
            },
            {
              id: 'memo-mii',
              pane: 'B_Nigaoe',
              prefix: 'scene-create-body:',
              label: text(139, 'Add a Mii'),
            },
            // The text hit pane spans the sheet. Arrow buttons must follow it
            // in DOM order so their overlap dispatches scroll, not text entry.
            ...memoArrows.controls(),
          ]
        : []),
      { id: 'back', pane: 'B_CalExit', prefix: 'scene-create-footer:', label: text(79, 'Back') },
      ...(page !== 'selector' &&
      page !== 'closed' &&
      (page !== 'address' || addressState?.rightLabel)
        ? [
            {
              id: 'submit',
              pane: 'B_Add_R',
              prefix: 'scene-create-footer:',
              label: page === 'address' ? addressState?.rightLabel : text(36, 'Post'),
              disabled: page === 'address' &&
                (!addressState?.rightLabel || addressState.rightDisabled),
            },
          ]
        : []),
    ];
  };
  function snapshot(addressState = address?.interactionState()) {
    const letterState = letter?.snapshot();
    const recipientState = recipientPicker?.snapshot();
    return {
      scene: 'create',
      page: letter ? 'letter' : page,
      editing: editing || Boolean(addressState?.editing) || Boolean(letterState?.editing),
      letter: letterState ?? null,
      recipientPicker: recipientState ?? null,
      addressStep: addressState?.step,
      memoText,
      memoScroll: memoScroll.snapshot(),
      networkDialog,
      miiDialog: Boolean(miiDialog),
      locked: Boolean(phase) || Boolean(addressState?.locked) ||
        Boolean(letterState?.locked) || Boolean(recipientState?.locked) ||
        Boolean(miiDialog && miiDialog.snapshot().phase !== 'idle'),
      phase: phase ? 'transition' : letterState?.phase ?? null,
      frame: phase?.frame ?? 0,
      duration: phase?.frames ?? 0,
    };
  }
  const closeNetwork = (openSettings) => {
    onSound(openSettings ? 'WIPL_SE_DECIDE' : 'WIPL_SE_CANCEL');
    start([dialogClip('SelectBtn_Ac', `G_SelectBtn${openSettings ? 'B' : 'A'}`)], () => {
      start([dialogClip('DialogOut', 'G_InOut')], () => {
        const action = networkDialog === 'wc24' ? 'wc24-settings' : 'network-settings';
        networkDialog = false;
        if (openSettings) onAction(action);
      });
    });
  };
  const finishSelectorLetter = ({ sent }) => {
    letter = null;
    page = 'selector';
    if (sent) {
      // MailAddressSelect::onEventDerived (0x813C3458) exits the
      // Create selector after a successful LetterWriter result.
      start([select('SelectOut', 'G_SelectInOut'), footer(3426, 3439)], () => {
        page = 'closed';
        onBack();
      });
    } else {
      commit([footer(3113, 3126)], 13);
      start([select('LetterOut', 'G_AdressInOut')], () => {});
    }
  };
  const openRecipientPicker = () => {
    page = 'letter-picker';
    recipientPicker = createLetterRecipientPicker(layouts, {
      contacts, messages, display, onSound, ownWiiNumber,
      onCancel() {
        recipientPicker = null;
        page = 'selector';
        commit([footer(3113, 3126)], 13);
        start([select('LetterOut', 'G_AdressInOut')], () => {});
      },
      onSelect(recipient, { footerAlreadyEntered }) {
        recipientPicker = null;
        page = 'letter';
        const draftKey = `${recipient.kind}:${recipient.address}`;
        letter = createBoardLetter(layouts, {
          recipient, draft: letterDrafts.get(draftKey) ?? '', messages,
          attachments,
          onDraft: (value) => letterDrafts.set(draftKey, value),
          onLetter, onLetterError, onSound, display, measureText, predict,
          measureTextLines, measureTextLayout,
          getKeyboardPreferences, onKeyboardPreferencesChange,
          footerAlreadyEntered, leftButtonMessage: 37, footerExitToSelector: true,
          onDone: finishSelectorLetter,
        });
      },
    });
    // The parent owns LetterIn/Out only; Address and LetterWriter own their
    // body and common-button queues (0x813C2D60, 0x813C3458).
    start([select('LetterIn', 'G_AdressInOut')], () => {});
  };
  const api = {
    dispose() {
      scrollRepeat.release();
      keyboard?.dispose();
      address?.dispose();
      letter?.dispose();
      recipientPicker?.dispose();
      keyboard = null;
      miiDialog = null;
      address = null;
      letter = null;
      recipientPicker = null;
      phase = null;
      page = 'closed';
      memoLeaving = false;
      editing = false;
      networkDialog = false;
      focus = null;
      miiFocus.reset();
    },
    holdControl(id) {
      if (letter) return letter.holdControl(id);
      if (recipientPicker) return false;
      if (phase) return false;
      if (address) return address.holdControl(id);
      if (keyboard?.holdControl(id)) return true;
      if (!keyboard || !['memo-scroll-up', 'memo-scroll-down'].includes(id) ||
          !controls().some((control) => control.id === id && !control.disabled)) return false;
      scrollRepeat.hold(id);
      return true;
    },
    releaseControl() {
      letter?.releaseControl();
      address?.releaseControl();
      scrollRepeat.release();
      keyboard?.releaseControl();
    },
    selectTextAt(point) {
      if (letter) return letter.selectTextAt(point);
      if (recipientPicker) return false;
      if (!phase && address) return address.selectTextAt(point);
      if (phase || page !== 'memo') return false;
      const layer = api.presentation().layers.find((entry) => entry.prefix === 'scene-create-body:');
      const index = keyboardCaretAtPoint({
        layout: layer.layout,
        paneName: 'T_Letter',
        hitPaneName: keyboard ? 'T_2l_TextBox' : 'B_2l_TextBox',
        text: keyboard?.snapshot().text ?? memoText,
        point,
        display,
        measure: measureTextLayout,
      });
      if (index === null) return false;
      if (!keyboard && !api.activate('memo-edit')) return false;
      keyboard.setCaret(index, { pointer: true });
      return true;
    },
    open() {
      api.dispose();
      addressArrows.reset();
      age = 0;
      bases = Object.fromEntries(CREATE_LAYOUTS.map((key) => [key, poseLayout(layouts[key])]));
      page = 'selector';
      memoLeaving = false;
      editing = false;
      networkDialog = false;
      miiDialog = null;
      letter = null;
      focus = null;
      focusAge = 0;
      focusClips = [];
      miiFocus.reset();
      // The common footer inherits the board's completed entry before transition.
      commit([footer(1040, 1040)], 0);
      commit(
        ['L', 'R'].map((side) => footer(10815, 10815, `G_Arw${side}_Focus`)),
        0,
      );
      // Board::onEventDerived queues APPEAR_LEFT_BUTTON after FROM_BOARD_TO_MAIL_SEL.
      start(
        [
          select('SelectIn', 'G_SelectInOut'),
          footer(4000, 4026),
          footer(10100, 10110, 'G_ArwL_End'),
          footer(10100, 10110, 'G_ArwR_End'),
          footer(3113, 3126, 'G_SeenChange', 26),
        ],
        () => {},
      );
      return true;
    },
    advance(frames, repeated = false) {
      if (page === 'closed') return;
      if (!repeated) return scrollRepeat.advance(frames);
      keyboard?.advance(frames);
      miiDialog?.advance(frames);
      const advancingLetter = letter;
      address?.advance(frames);
      const advancingPhase = phase;
      recipientPicker?.advance(frames);
      advancingLetter?.advance(frames);
      addressArrows.advance(frames);
      memoArrows.advance(frames);
      miiFocus.advance(frames);
      if (page === 'memo') {
        const input = keyboard?.snapshot();
        memoScroll.measure(
          memoLines(input?.displayText ?? memoText),
          input?.displayCaret ?? caret,
          Boolean(keyboard && !phase),
        );
        memoScroll.advance(frames);
        const openingKeyboard = Boolean(keyboard && phase && keyboardProgress === 0);
        memoArrows.update(openingKeyboard || memoLeaving
          ? { previous: false, next: false }
          : memoScroll.snapshot(), Boolean(keyboard));
      }
      if (!Number.isFinite(frames) || frames < 0)
        throw new RangeError('Frames must be nonnegative');
      age += frames;
      focusAge += frames;
      // A child callback can install a new parent transition. Its first
      // update belongs to the next host tick, not this child's elapsed batch.
      let remaining = phase === advancingPhase ? frames : 0;
      if (!remaining) return;
      while (phase) {
        const amount = Math.min(remaining, phase.frames - phase.frame);
        phase.frame += amount;
        remaining -= amount;
        if (phase.frame < phase.frames) break;
        const completed = phase;
        commit(completed.clips, completed.frames);
        phase = null;
        completed.done?.();
        if (!remaining) break;
      }
    },
    hover(id) {
      if (letter) return letter.hover(id);
      if (recipientPicker) return recipientPicker.hover(id);
      if (miiDialog) return miiDialog.hover(id);
      scrollRepeat.hover(id);
      const memoArrowChanged = !phase && memoArrows.hover(id);
      if (keyboard && !phase) {
        const changed = keyboard.hover(id);
        if (memoArrowChanged && id?.startsWith('memo-scroll-')) onSound('WIPL_SE_CHAR_FOCUS');
        return changed || memoArrowChanged;
      }
      let childChanged = false;
      let childOwnsSound = false;
      let parentTarget = id;
      if (address && !phase) {
        const isAddressControl = id?.startsWith('address-') || id?.startsWith('key-');
        const isArrow = id === 'address-prev' || id === 'address-next';
        childChanged = address.hover(isAddressControl && !isArrow ? id : null);
        childOwnsSound = Boolean(isAddressControl && !isArrow);
        if (isAddressControl && !isArrow) parentTarget = null;
      }
      if (
        phase ||
        focus === parentTarget ||
        (parentTarget &&
          !controls().some((control) => control.id === parentTarget && !control.disabled) &&
          !(addressDirection(parentTarget) && address?.interactionState().step === 'book'))
      )
        return childChanged;
      addressArrows.hover(addressDirection(parentTarget));
      miiFocus.hover(parentTarget);
      const focusLayout = posed('my_IplTop_e', focusClips, focusAge);
      commit(focusClips, focusAge);
      focusClips = [
        ...(focus ? hoverClips(focus, false, focusLayout) : []),
        ...(parentTarget ? hoverClips(parentTarget, true, focusLayout) : []),
      ];
      focus = parentTarget;
      focusAge = 0;
      if (parentTarget && !childOwnsSound) onSound('WIPL_SE_BT_TARGETTING');
      return true;
    },
    activate(id, triggers) {
      if (letter) return letter.activate(id, triggers);
      if (recipientPicker)
        return isPrimaryKeyboardTrigger(triggers) && recipientPicker.activate(id);
      if (miiDialog) return isPrimaryKeyboardTrigger(triggers) && miiDialog.activate(id);
      if (
        phase ||
        page === 'closed' ||
        !controls().some((control) => control.id === id && !control.disabled)
      )
        return false;
      // The empty Post button still accepts pointer focus, but cannot send a
      // blank local record. Keep activation separate from its visual state.
      if (id === 'submit' && page === 'memo' && !memoText.trim()) return false;
      if (!isPrimaryKeyboardTrigger(triggers)) {
        if (networkDialog) return false;
        if (keyboard) return keyboard.activate(id, triggers);
        return address?.activate(id, triggers) ?? false;
      }
      if (networkDialog) {
        closeNetwork(id === 'network-settings');
        return true;
      }
      if (id === 'memo-scroll-up' || id === 'memo-scroll-down') {
        if (!memoScroll.scroll(id.endsWith('up') ? -1 : 1, { editing: Boolean(keyboard) })) return false;
        memoArrows.press(id);
        return true;
      }
      if (keyboard) return keyboard.activate(id, triggers);
      if (id === 'memo-mii') {
        miiFocus.hover(null);
        miiDialog = createContactDialog(layouts, {
          kind: 'no-mii', messages, onSound,
          onDone() { miiDialog = null; },
        });
        return true;
      }
      if (address && (id.startsWith('address-') || id.startsWith('key-'))) {
        const activated = address.activate(id, triggers);
        if (activated && (id === 'address-prev' || id === 'address-next')) {
          // Press and hover are independent original footer groups. Keep the
          // focus pose while the pointer remains over the page-turn arrow.
          addressArrows.press(addressDirection(id));
        }
        return activated;
      }
      if (id === 'submit' && address) {
        onSound('WIPL_SE_DECIDE');
        if (address.interactionState().step === 'review') {
          // Native review starts card_fnsh with the common-footer press;
          // Address owns persistence and the completion notice after departure.
          start([footer(3000, 3020, 'G_Cmn_R')]);
          return address.submit();
        }
        start([footer(3000, 3020, 'G_Cmn_R')], () => {
          if (address.interactionState().step === 'book' && !localRegistration) {
            networkDialog = 'wc24';
            bases.my_DialogWindow_a2 = poseLayout(layouts.my_DialogWindow_a2);
            start([dialogClip('DialogIn', 'G_InOut')]);
          } else address.submit();
        });
        return true;
      }
      if (id === 'memo-edit') {
        editing = true;
        caret = memoText.length;
        keyboardProgress = 0;
        keyboard = createBoardKeyboard(layouts, {
          initialPreferences: getKeyboardPreferences(),
          onPreferencesChange: onKeyboardPreferencesChange,
          value: memoText,
          onSound,
          display,
          measureText,
          predict,
          textLayout: memoLines,
          onChange: (value) => {
            memoText = value;
            onDraft(value);
          },
          onClose: (_value, { reason } = {}) => {
            onSound(reason === 'ok' ? 'WIPL_SE_SK_DECIDE_CLOSE' : 'WIPL_SE_SK_CANCEL_CLOSE');
            keyboardProgress = 1;
            start(
              [footer(3313, 3326)],
              () => {
                editing = false;
                keyboard = null;
                keyboardProgress = 0;
                memoArrows.update(memoScroll.snapshot(), false);
              },
              30,
            );
          },
        });
        onSound('WIPL_SE_SK_OPEN');
        start(
          [clip('sofkeybd/my_Memo_a', 'my_Memo_a_TouchLetter'), footer(3413, 3426)],
          () => {
            keyboardProgress = 1;
          },
          30,
        );
        return true;
      }
      if (id === 'submit' && page === 'memo') {
        editing = false;
        memoLeaving = true;
        memoArrows.update({ previous: false, next: false }, false);
        start([footer(3000, 3020, 'G_Cmn_R')], () => {
          onSound('WIPL_SE_DECIDE');
          start([clip('sofkeybd/my_Memo_a', 'my_Memo_a_SendOut'), footer(3413, 3426)], () => {
            onAction('post-memo', { text: memoText });
            memoText = '';
            caret = 0;
            onDraft(memoText);
            start([select('SelectOut', 'G_SelectInOut'), footer(3426, 3439)], () => {
              page = 'closed';
              onBack();
            });
          });
        });
        return true;
      }
      if (id === 'back') return api.back();
      const choice = page === 'selector' && CHOICES.find((choice) => choice.id === id);
      if (!choice) return false;
      onSound('WIPL_SE_DECIDE');
      if (id === 'letter') {
        if (letterService === 'local') {
          openRecipientPicker();
          return true;
        }
        networkDialog = 'network';
        onSound('WIPL_SE_INFO_WINDOW');
        bases.my_DialogWindow_a2 = poseLayout(layouts.my_DialogWindow_a2);
        start([dialogClip('DialogIn', 'G_InOut')], () => {});
        return true;
      }
      page = id;
      memoLeaving = false;
      if (id === 'address')
        address = createBoardAddress(layouts, {
          messages,
          contacts,
          ownWiiNumber,
          onSound,
          display,
          measureText,
          measureTextLayout,
          predict,
          getKeyboardPreferences,
          onKeyboardPreferencesChange,
          onAction(action, detail) {
            if (action !== 'send-message') return;
            if (letterService === 'local') {
              const recipient = detail.contact;
              const draftKey = `${recipient.kind}:${recipient.address}`;
              address.leaveContact(() => {
                letter = createBoardLetter(layouts, {
                  recipient, draft: letterDrafts.get(draftKey) ?? '', messages,
                  attachments,
                  onDraft: (value) => letterDrafts.set(draftKey, value),
                  onLetter, onLetterError, onSound, display, measureText, predict,
                  measureTextLines, measureTextLayout,
                  getKeyboardPreferences, onKeyboardPreferencesChange,
                  onDone() {
                    letter = null;
                    address.showContact();
                  },
                });
              });
              return;
            }
            // AddressEdit checks network configuration before creating Letter.
            // This local fixture retains that original offline boundary.
            networkDialog = 'network';
            onSound('WIPL_SE_INFO_WINDOW');
            bases.my_DialogWindow_a2 = poseLayout(layouts.my_DialogWindow_a2);
            start([dialogClip('DialogIn', 'G_InOut')]);
          },
          onContacts: (values) => {
            const result = onContacts(values);
            if (result && typeof result.then === 'function') {
              return result.then(() => { contacts = structuredClone(values); });
            }
            contacts = structuredClone(values);
            return result;
          },
          onContactsError,
        });
      start(
        [
          select(`${choice.stem}In`, 'G_AdressInOut'),
          // SceneManager consumes the child-creation queue after calculating
          // the parent. Prepared Address begins on the next update; its
          // frame-zero pose must remain applied while that update is pending.
          ...bodyClip('MailIn').map((item) => ({
            ...item,
            startDelay: id === 'address' ? 1 : 0,
          })),
          // Address initialization starts both original arrow entrances
          // immediately (0x81382A20/2C, common-button operations 23/24).
          ...(id === 'address'
            ? ['L', 'R'].map((side) => footer(10150, 10160, `G_Arw${side}_End`, 1))
            : []),
          footer(3213, 3226),
          // Address starts disappearance immediately; the native queue then
          // clears busy, writes Register, and plays the two-button entrance.
          footer(3313, 3326, 'G_SeenChange', id === 'address' ? 15 : 13),
        ],
        () => {},
      );
      return true;
    },
    back() {
      if (letter) return letter.back();
      if (recipientPicker) return recipientPicker.back();
      if (miiDialog) return miiDialog.back();
      if (phase || page === 'closed') return false;
      if (networkDialog) {
        closeNetwork(false);
        return true;
      }
      if (keyboard) return keyboard.back();
      if (address?.interactionState().locked) return false;
      if (address?.back()) return true;
      onSound('WIPL_SE_CANCEL');
      if (page === 'selector') {
        start(
          [
            select('SelectOut', 'G_SelectInOut'),
            footer(3000, 3020, 'G_CalExit'),
            footer(3213, 3226, 'G_SeenChange', 20),
            footer(3426, 3439, 'G_SeenChange', 33),
          ],
          () => {
            page = 'closed';
            onBack();
          },
        );
      } else if (page === 'address') {
        // Mode 0 starts the parent selector and child book together
        // (0x8138563C). Footer reservations wait for the Back press instead.
        start(
          [
            // The parent common-before layout has already calculated when
            // Address starts this animation. The child common-after advances
            // this update; the selector begins advancing on the next one.
            select('AdressOut', 'G_AdressInOut', 1),
            ...bodyClip('MailOut'),
            // Back starts arrow operations 25/26 before the footer queue
            // (0x81385754/60). Do not hold the appeared endpoint until exit.
            ...['L', 'R'].map((side) => footer(10100, 10110, `G_Arw${side}_End`)),
            footer(3000, 3020, 'G_CalExit'),
            footer(3413, 3426, 'G_SeenChange', 21),
            footer(3113, 3126, 'G_SeenChange', 35),
          ],
          () => {
            page = 'selector';
            address = null;
          },
        );
      } else {
        const choice = CHOICES.find((choice) => choice.id === page);
        if (page === 'memo') {
          memoLeaving = true;
          memoArrows.update({ previous: false, next: false }, false);
        }
        start([footer(3000, 3020, 'G_CalExit')], () => {
          start(
            [...bodyClip('MailOut'), footer(3413, 3426), footer(3113, 3126, 'G_SeenChange', 13)],
            () => {
              page = 'selector';
              memoLeaving = false;
              address = null;
              start([select(`${choice.stem}Out`, 'G_AdressInOut')], () => {});
            },
          );
        });
      }
      return true;
    },
    keyInput(key, modifiers) {
      if (letter) return letter.keyInput(key, modifiers);
      if (recipientPicker)
        return key === 'Escape' && modifiers?.type !== 'keyup' ? recipientPicker.back() : false;
      if (modifiers?.type === 'blur') api.releaseControl();
      return !phase
        ? (keyboard?.keyInput(key, modifiers) ?? address?.keyInput(key, modifiers) ?? false)
        : false;
    },
    snapshot() {
      return snapshot();
    },
    presentation() {
      if (letter) return { ...api.snapshot(), ...letter.presentation(), page: 'letter' };
      const working = (key) =>
        posed(key, focusClips, focusAge, posed(key, phase?.clips || [], phase?.frame || 0));
      const addressView = address?.presentation();
      const layers = [
        {
          layout: setText(working('my_Mail_a'), {
            T_Mail: text(133, 'Memo'),
            T_Adress: text(134, 'Address Book'),
          }),
          prefix: 'scene-create:',
        },
      ];
      if (recipientPicker) {
        const view = recipientPicker.presentation();
        return { ...api.snapshot(), layers: [...layers, ...view.layers], controls: view.controls };
      }
      if (address)
        layers.push(
          ...addressView.layers.filter((layer) =>
            !layer.prefix.startsWith('keyboard-') && layer.prefix !== 'address-dialog:')
            .map((layer) => {
              if (layer.prefix !== 'address-book:') return layer;
              const layout = posed(
                'th_Adress_a',
                phase?.clips || [],
                phase?.frame || 0,
                layer.layout,
              );
              // Native draw repeats the same animated sheet pane. Browser
              // instances must retain the animated alpha of that template.
              const panes = indexLayout(layout).panes;
              for (const [name, pane] of panes) {
                if (/^N_note_[ade]:stack-\d+$/.test(name))
                  pane.alpha = panes.get(name.split(':')[0]).alpha;
              }
              return { ...layer, layout };
            }),
        );
      if (page !== 'selector' && page !== 'closed' && !address) {
        const values =
          page === 'address'
            ? { T_nmbr_b: '1/20', T_nmbr_c: '2/20', T_wii_name: text(134, 'Address Book') }
            : {
                T_Header: page === 'memo' ? text(133, 'Memo') : '',
                T_TouchLetter: page === 'memo' && !memoText ? text(140, 'Write a memo') : '',
                T_Nigaoe: text(139, '←Add a Mii'),
                T_Letter: memoText,
              };
        const body = setText(working(bodyKey()), values);
        if (page === 'memo') {
          const focusedBody = poseLayout(body, [...miiFocus.clips(), ...memoArrows.clips()]);
          body.root = focusedBody.root;
          body.materials = focusedBody.materials;
          let editorOpacity = 0;
          if (keyboard && keyboardProgress === 1)
            editorOpacity = phase ? Math.max(0, 1 - phase.frame / 30) : 1;
          const arrowPanes = indexLayout(body).panes;
          for (const name of ['P_txtScrll_UP', 'P_txtScrll_DOWN']) {
            const pane = arrowPanes.get(name);
            if (pane) pane.alpha = Math.round(pane.alpha * editorOpacity);
          }
          const progress = phase && editing
            ? keyboardProgress === 0
              ? Math.min(1, phase.frame / 30)
              : 1 - Math.min(1, phase.frame / 30)
            : keyboardProgress;
          arrangeMessageBody(body, {
            text: keyboard?.snapshot().displayText ?? memoText,
            hint: text(140, 'Write a memo'),
            keyboard: keyboard?.snapshot(), editing, progress,
            scrollOffset: memoScroll.snapshot().offset, measureTextLines,
            lineHeight: memoLines(keyboard?.snapshot().displayText ?? memoText).lineHeight,
          });
        }
        layers.push({ layout: body, prefix: 'scene-create-body:' });
      }
      let footerLayout = working('my_IplTop_e');
      footerLayout = poseLayout(footerLayout, [
        // Original common-arrow idle motion continues through focus/press.
        // This scene-local clock does not claim the native global loop phase.
        sample(footer(10000, 10055, 'G_ArwRoop'), age % 55),
        ...addressArrows.clips(),
        // Address retires page arrows before its form child owns input
        // (0x81386248). Reuse their original hidden pose in child steps.
        ...(addressView && addressView.step !== 'book'
          ? ['L', 'R'].map((side) => sample(footer(10110, 10110, `G_Arw${side}_End`), 0))
          : []),
      ]);
      if (!addressView?.modal) layers.push({
        layout: setText(footerLayout, {
          T_CalExit: text(79, 'Back'),
          T_Add: text(79, 'Back'),
          T_CalAdd_R: page === 'address' ? addressView?.rightLabel || '' : text(36, 'Post'),
        }),
        prefix: 'scene-create-footer:',
      });
      if (addressView?.editing)
        layers.push(
          ...addressView.layers.filter((layer) => layer.prefix.startsWith('keyboard-')),
        );
      if (keyboard) {
        const keyboardLayers = keyboard.presentation().layers;
        const progress = phase
          ? keyboardProgress === 0
            ? Math.min(1, phase.frame / 30)
            : 1 - Math.min(1, phase.frame / 30)
          : 1;
        layers.push(...keyboardTransitionLayers(
          keyboardLayers, progress, Boolean(phase && keyboardProgress === 0),
        ));
      }
      if (addressView)
        layers.push(...addressView.layers.filter((layer) => layer.prefix === 'address-dialog:'));
      if (networkDialog)
        layers.push({
          layout: setText(working('my_DialogWindow_a2'), {
            T_Dialog:
              networkDialog === 'wc24'
                ? text(
                    382,
                    'WiiConnect24 is not turned on.\nConfirm your WiiConnect24 setting\nin Wii Settings.',
                  )
                : text(
                    324,
                    'No Internet connection has been configured.\nPlease configure your Internet settings.',
                  ),
            T_BtnA: text(37, 'Quit'),
            T_BtnB: text(326, 'Settings'),
          }),
          prefix: 'create-network:',
        });
      if (miiDialog) layers.push(...miiDialog.presentation().layers);
      return {
        ...snapshot(addressView),
        layers,
        controls: controls(addressView).map((control) => ({
          ...control,
          disabled:
            Boolean(phase) || Boolean(addressView?.locked) || Boolean(control.disabled),
        })),
      };
    },
  };
  api.open();
  return api;
}
