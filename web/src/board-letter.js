import { indexLayout, poseLayout } from './animation.js';
import { createBoardKeyboard } from './board-keyboard.js';
import { isPrimaryKeyboardTrigger } from './keyboard-activation.js';
import { createContactDialog } from './board-contact-dialog.js';
import { arrangeMessageBody, keyboardTransitionLayers } from './board-message-view.js';
import { createMemoEditorScroll } from './memo-editor-scroll.js';
import { createMemoScrollArrows } from './memo-scroll-arrows.js';
import { keyboardCaretAtPoint } from './keyboard-text-hit.js';
import { createTextScrollRepeat } from './text-scroll-repeat.js';
import { MAX_LOCAL_LETTER_UNITS, validateLocalAttachment } from './message-service.js';
import { arrowClip, createArrowInteraction } from './arrow-interaction.js';
import { createPaneAnimationBinding } from './pane-animation-binding.js';

export const LETTER_LAYOUT = 'sofkeybd/my_LetterL';
// LetterWriter allocates 0x800 bytes. Reserve one UTF-16 unit for its terminator;
// the original editor's separate maximum-length setting is not yet verified.
export const LOCAL_LETTER_MAX_LENGTH = MAX_LOCAL_LETTER_UNITS;
const PREFIX = 'letter-body:';
const FOOTER_PREFIX = 'letter-footer:';

/** Explicit local service fixture. onLetter commits only to the local outbox;
 * this controller has no mail transport or network-service implementation.
 */
export function createBoardLetter(layouts, {
  recipient, draft = '', attachment = null, attachments = [], messages = {},
  onDraft = () => {}, onAttachmentChange = () => {}, onDone = () => {},
  onLetter = async () => { throw new Error('Local letter storage is unavailable.'); },
  onLetterError = () => {}, onSound = () => {}, display, measureText, predict,
  measureTextLines = (value) => value.split('\n').length, measureTextLayout,
  getKeyboardPreferences = () => ({}), onKeyboardPreferencesChange = () => {},
  createId = () => globalThis.crypto.randomUUID(),
  footerAlreadyEntered = false,
  leftButtonMessage = 79,
  footerExitToSelector = false,
} = {}) {
  const source = layouts[LETTER_LAYOUT];
  const strings = messages.messages || messages;
  const text = (id, fallback) => strings[id] ?? fallback;
  const leftLabel = () => text(leftButtonMessage, leftButtonMessage === 37 ? 'Quit' : 'Back');
  const contact = { kind: recipient.kind, address: recipient.address, nickname: recipient.nickname };
  const template = indexLayout(source).panes.get('T_Letter');
  const lines = (value) => {
    if (measureTextLayout) return measureTextLayout(value, template, source);
    let offset = 0;
    return { lineHeight: 42, lines: value.split('\n').map((value) => {
      const line = { text: value, start: offset, end: offset + value.length };
      offset += value.length + 1;
      return line;
    }) };
  };
  const animation = (suffix) => source.animations[`my_LetterL_${suffix}`];
  const clip = (suffix, frame, group) => ({
    animation: animation(suffix), group,
    frame: Math.min(frame, animation(suffix).frames - 1), loop: false,
  });
  let value = draft.slice(0, LOCAL_LETTER_MAX_LENGTH);
  const availableAttachments = [];
  const attachmentIds = new Set();
  for (const item of attachments) {
    const attachment = validateLocalAttachment(item);
    if (attachment && !attachmentIds.has(attachment.id)) {
      attachmentIds.add(attachment.id);
      availableAttachments.push(attachment);
    }
  }
  let selectedAttachment = validateLocalAttachment(attachment);
  if (selectedAttachment && !availableAttachments.some((item) => item.id === selectedAttachment.id))
    availableAttachments.unshift(selectedAttachment);
  let pickerOpen = false;
  let pickerIndex = Math.max(0, availableAttachments.findIndex(
    (item) => item.id === selectedAttachment?.id,
  ));
  let phase = { name: 'enter', frame: 0, frames: animation('MailIn').frames };
  let keyboard = null;
  let dialog = null;
  let hovered = null;
  let sendId = null;
  let save = null;
  let closed = false;
  const scroll = createMemoEditorScroll(() => onSound('WIPL_SE_LINE_SCROLL'));
  const arrows = createMemoScrollArrows(source, {
    stem: 'my_LetterL', controlPrefix: 'letter', layoutPrefix: PREFIX,
  });
  const bindPane = createPaneAnimationBinding(source);
  const miiFocus = createArrowInteraction({
    'letter-mii': {
      focusIn: arrowClip(bindPane(animation('NigaoeFoucusIn'), 'Nigaoe')),
      focusOut: arrowClip(bindPane(animation('NigaoeFoucusOut'), 'Nigaoe')),
    },
  });
  const photoFocus = createArrowInteraction({
    'letter-photo': {
      focusIn: arrowClip(bindPane(animation('PicFocusIn'), 'G_Pic')),
      focusOut: arrowClip(bindPane(animation('PicFocusOut'), 'G_Pic')),
    },
  });
  const footerInteraction = createArrowInteraction(Object.fromEntries(
    ['back', 'submit'].map((id) => {
      const group = id === 'back' ? 'G_CalExit' : 'G_Cmn_R';
      const source = layouts.my_IplTop_e.animations.my_IplTop_e;
      return [id, {
        focusIn: arrowClip(source, group, 2900, 2906),
        focusOut: arrowClip(source, group, 2930, 2938),
        press: arrowClip(source, group, 3000, 3020),
      }];
    }),
  ));
  const repeat = createTextScrollRepeat({
    advance: (frames) => api.advance(frames, true), activate: (id) => api.activate(id),
  });
  const start = (name, frames) => {
    repeat.release();
    hovered = null;
    miiFocus.hover(null);
    photoFocus.hover(null);
    footerInteraction.hover(null);
    phase = { name, frame: 0, frames };
  };
  const update = (next) => {
    if (next === value) return;
    value = next;
    sendId = null;
    onDraft(next);
  };
  const finishSave = () => {
    if (closed || !save?.settled) return;
    if (save.error) {
      save = null;
      start('return', animation('ReturnIn').frames);
    } else {
      closed = true;
      phase = null;
      value = '';
      onDraft('');
      onDone({ sent: true });
    }
  };
  const beginSave = () => {
    sendId ??= createId();
    const attempt = { settled: false, error: null };
    save = attempt;
    const payload = {
      id: sendId, recipient: { ...contact }, text: value, attachment: selectedAttachment,
    };
    start('send', animation('SendOut').frames);
    // A failed response may follow a committed write. Retain this id until
    // text changes so the server can acknowledge a retry without duplicating it.
    const current = () => !closed && save === attempt;
    Promise.resolve().then(() => current() ? onLetter(payload) : undefined).then(() => {
      if (!current()) return;
      attempt.settled = true;
      if (phase?.name === 'saving') finishSave();
    }, (error) => {
      if (!current()) return;
      attempt.settled = true;
      attempt.error = error;
      onLetterError(error);
      if (phase?.name === 'saving') finishSave();
    });
  };
  const completePhase = (name) => {
    phase = null;
    if (name === 'keyboard-close') keyboard = null;
    else if (name === 'send-press') beginSave();
    else if (name === 'send') {
      start('saving', Infinity);
      finishSave();
    } else if (name === 'exit') {
      closed = true;
      onDone({ sent: false });
    }
  };
  const controls = () => {
    if (closed) return [];
    if (dialog) return dialog.presentation().controls;
    if (keyboard) return [...keyboard.controls(), ...arrows.controls()];
    if (pickerOpen) {
      return [
        ...availableAttachments.map((attachment, index) => ({
          id: `letter-attachment-${index}`,
          pane: `LetterPicker_${index}`,
          prefix: PREFIX,
          label: `Photo ${index + 1}`,
          selected: index === pickerIndex,
        })),
        { id: 'letter-picker-cancel', pane: 'B_CalExit', prefix: FOOTER_PREFIX,
          label: leftLabel() },
      ];
    }
    const result = [
      { id: 'letter-edit', pane: 'B_2l_TextBox', prefix: PREFIX, label: text(142, 'Write a message') },
      { id: 'letter-mii', pane: 'B_Nigaoe', prefix: PREFIX, label: text(139, 'Add a Mii') },
      ...arrows.controls(),
      { id: 'back', pane: 'B_CalExit', prefix: FOOTER_PREFIX, label: leftLabel() },
      { id: 'submit', pane: 'B_Add_R', prefix: FOOTER_PREFIX,
        label: text(39, 'Send'), disabled: !value.trim() && !selectedAttachment },
    ];
    if (availableAttachments.length)
      result.splice(1, 0, {
        id: 'letter-photo', pane: 'B_Pic', prefix: PREFIX,
        label: selectedAttachment ? text(48, 'Remove photo') : text(49, 'Attach a photo'),
      });
    return result;
  };
  const api = {
    controls,
    dispose() {
      closed = true;
      repeat.release();
      keyboard?.dispose();
      keyboard = null;
      phase = null;
      dialog = null;
      pickerOpen = false;
      save = null;
      hovered = null;
      photoFocus.reset();
    },
    advance(frames, repeated = false) {
      if (closed) return;
      if (!repeated) return repeat.advance(frames);
      keyboard?.advance(frames);
      arrows.advance(frames);
      miiFocus.advance(frames);
      footerInteraction.advance(frames);
      const state = keyboard?.snapshot();
      scroll.measure(lines(state?.displayText ?? value), state?.displayCaret ?? value.length,
        Boolean(keyboard && !phase));
      scroll.advance(frames);
      arrows.update(scroll.snapshot(), Boolean(keyboard));
      dialog?.advance(frames);
      let remaining = frames;
      while (phase && remaining > 0) {
        const active = phase;
        const amount = Math.min(remaining, active.frames - active.frame);
        active.frame += amount;
        remaining -= amount;
        if (active.frame < active.frames) break;
        completePhase(active.name);
      }
    },
    hover(id) {
      if (closed) return false;
      repeat.hover(id);
      if (dialog) return dialog.hover(id);
      if (phase) return false;
      if (pickerOpen) {
        if (hovered === id) return false;
        hovered = controls().some((item) => item.id === id) ? id : null;
        if (hovered) onSound('WIPL_SE_BT_TARGETTING');
        return true;
      }
      const arrowChanged = arrows.hover(id);
      if (keyboard) {
        const keyboardChanged = keyboard.hover(id);
        if (arrowChanged && arrows.controls().some((control) => control.id === id))
          onSound('WIPL_SE_CHAR_FOCUS');
        return keyboardChanged || arrowChanged;
      }
      if (hovered === id) return arrowChanged;
      hovered = controls().some((item) => item.id === id && !item.disabled) ? id : null;
      miiFocus.hover(hovered);
      photoFocus.hover(hovered);
      footerInteraction.hover(hovered);
      if (hovered) onSound('WIPL_SE_BT_TARGETTING');
      return true;
    },
    activate(id, triggers) {
      if (dialog) return isPrimaryKeyboardTrigger(triggers) && dialog.activate(id);
      if (phase || !controls().some((item) => item.id === id && !item.disabled)) return false;
      if (!isPrimaryKeyboardTrigger(triggers)) return keyboard?.activate(id, triggers) ?? false;
      if (pickerOpen) {
        if (id === 'letter-picker-cancel') {
          pickerOpen = false;
          hovered = null;
          onSound('WIPL_SE_CANCEL');
          return true;
        }
        const prefix = 'letter-attachment-';
        if (!id.startsWith(prefix)) return false;
        const index = Number(id.slice(prefix.length));
        if (!Number.isInteger(index) || !availableAttachments[index]) return false;
        pickerIndex = index;
        selectedAttachment = structuredClone(availableAttachments[index]);
        onAttachmentChange(structuredClone(selectedAttachment));
        pickerOpen = false;
        hovered = null;
        onSound('WIPL_SE_PIC_ZOOM_IN');
        return true;
      }
      if (id.startsWith('letter-scroll-')) {
        if (!scroll.scroll(id.endsWith('up') ? -1 : 1, { editing: Boolean(keyboard) })) return false;
        arrows.press(id);
        return true;
      }
      if (keyboard) return keyboard.activate(id, triggers);
      if (id === 'back') return api.back();
      if (id === 'submit') {
        onSound('WIPL_SE_DECIDE');
        footerInteraction.press('submit');
        start('send-press', 21);
        return true;
      }
      if (id === 'letter-mii') {
        miiFocus.hover(null);
        dialog = createContactDialog(layouts, {
          kind: 'no-mii', messages, onSound, onDone() { dialog = null; },
        });
        return true;
      }
      if (id === 'letter-photo') {
        if (!availableAttachments.length) return false;
        if (availableAttachments.length > 1) {
          pickerIndex = Math.max(0, availableAttachments.findIndex(
            (item) => item.id === selectedAttachment?.id,
          ));
          pickerOpen = true;
          hovered = null;
          onSound('WIPL_SE_PIC_ZOOM_IN');
          return true;
        }
        if (selectedAttachment) {
          selectedAttachment = null;
          onAttachmentChange(null);
          onSound('WIPL_SE_PIC_ZOOM_OUT');
          start('photo-clear', animation('ExitPic').frames);
        } else {
          onSound('WIPL_SE_PIC_ZOOM_IN');
          start('photo-select', animation('SelectPic').frames);
          // The local picker is deterministic: the first verified imported
          // photo is selected when the native selection motion completes.
          selectedAttachment = availableAttachments[0];
          onAttachmentChange(structuredClone(selectedAttachment));
        }
        return true;
      }
      if (id !== 'letter-edit') return false;
      keyboard = createBoardKeyboard(layouts, {
        value, maxLength: LOCAL_LETTER_MAX_LENGTH, onSound, display, measureText, predict,
        textLayout: lines, onChange: update,
        initialPreferences: getKeyboardPreferences(),
        onPreferencesChange: onKeyboardPreferencesChange,
        onClose(_text, { reason } = {}) {
          onSound(reason === 'ok' ? 'WIPL_SE_SK_DECIDE_CLOSE' : 'WIPL_SE_SK_CANCEL_CLOSE');
          start('keyboard-close', 30);
        },
      });
      onSound('WIPL_SE_SK_OPEN');
      start('keyboard-open', 30);
      return true;
    },
    back() {
      if (dialog) return dialog.back();
      if (phase || closed) return false;
      if (pickerOpen) {
        pickerOpen = false;
        hovered = null;
        onSound('WIPL_SE_CANCEL');
        return true;
      }
      if (keyboard) return keyboard.back();
      onSound('WIPL_SE_CANCEL');
      // LetterWriter route zero restores the selector's Back-only footer:
      // press 27, reserve 16, write Back (35), then reserve 11 (0x813C0F38).
      start('exit', footerExitToSelector ? 50 : animation('MailOut').frames);
      return true;
    },
    keyInput(key, modifiers) {
      if (modifiers?.type === 'blur') api.releaseControl();
      return !phase && !dialog && keyboard ? keyboard.keyInput(key, modifiers) : false;
    },
    selectTextAt(point) {
      if (phase || dialog || closed) return false;
      const layout = api.presentation().layers.find((layer) => layer.prefix === PREFIX).layout;
      const index = keyboardCaretAtPoint({
        layout, paneName: 'T_Letter', text: keyboard?.snapshot().text ?? value,
        hitPaneName: keyboard ? 'T_2l_TextBox' : 'B_2l_TextBox',
        point, display, measure: measureTextLayout,
      });
      if (index === null) return false;
      if (!keyboard && !api.activate('letter-edit')) return false;
      keyboard.setCaret(index, { pointer: true });
      return true;
    },
    holdControl(id) {
      if (phase || dialog || !keyboard) return false;
      if (keyboard.holdControl(id)) return true;
      if (!id?.startsWith('letter-scroll-') || !controls().some((item) => item.id === id)) return false;
      repeat.hold(id);
      return true;
    },
    releaseControl() {
      repeat.release();
      keyboard?.releaseControl();
    },
    snapshot() {
      return { text: value, recipient: { ...contact }, editing: Boolean(keyboard),
        attachment: selectedAttachment ? structuredClone(selectedAttachment) : null,
        pickerOpen, pickerIndex,
        locked: Boolean(phase) || Boolean(dialog && dialog.snapshot().phase !== 'idle'),
        modal: Boolean(dialog), phase: phase?.name ?? null, frame: phase?.frame ?? 0,
        duration: phase?.frames ?? 0, saving: Boolean(save), closed, scroll: scroll.snapshot() };
    },
    presentation() {
      const name = phase?.name;
      const frame = phase?.frame ?? 0;
      const progress = name === 'keyboard-open' ? Math.min(1, frame / 30)
        : name === 'keyboard-close' ? 1 - Math.min(1, frame / 30) : keyboard ? 1 : 0;
      const clips = [
        clip('MailIn', name === 'enter' ? frame : Infinity), ...arrows.clips(), ...miiFocus.clips(),
        ...photoFocus.clips(),
      ];
      if (name === 'exit') clips.push(clip('MailOut', frame));
      if (name === 'keyboard-open') clips.push(clip('TouchLetter', frame));
      if (name === 'photo-select') clips.push(clip('SelectPic', frame, 'G_Pic'));
      if (name === 'photo-clear') clips.push(clip('ExitPic', frame, 'G_Pic'));
      if (name === 'send' || name === 'saving')
        clips.push(clip('SendOut', name === 'send' ? frame : Infinity));
      if (name === 'return') clips.push(clip('ReturnIn', frame));
      const body = poseLayout(source, clips);
      const panes = indexLayout(body).panes;
      panes.get('T_Header').text = text(141, 'Sending the message\nto xxxxxxxxxx.')
        .replace('xxxxxxxxxx', contact.nickname);
      panes.get('T_SendMes').text = text(143, 'Sending message...');
      panes.get('T_Nigaoe').text = text(139, '←Add a Mii');
      if (selectedAttachment) {
        const photo = panes.get('SendPic');
        const scale = Math.min(photo.size[0] / selectedAttachment.width,
          photo.size[1] / selectedAttachment.height);
        photo.size = [selectedAttachment.width * scale, selectedAttachment.height * scale];
        body.textures = [...body.textures, {
          name: `letter-${selectedAttachment.id}`, format: 4,
          width: selectedAttachment.width, height: selectedAttachment.height,
          url: selectedAttachment.localSrc,
        }];
        body.materials[photo.material].textureMaps[0] = {
          texture: body.textures.length - 1, wrapS: 0, wrapT: 0,
        };
        for (const key of ['N_Pic', 'B_Pic', 'PicMask', 'SendPic']) panes.get(key).flags &= ~1;
      } else {
        panes.get('SendPic').flags &= ~1;
        if (!availableAttachments.length)
          for (const key of ['N_Pic', 'B_Pic', 'PicMask']) panes.get(key).flags &= ~1;
      }
      if (pickerOpen) {
        for (const [index, attachment] of availableAttachments.entries()) {
          const paneName = `LetterPicker_${index}`;
          const imageName = `LetterPickerImage_${index}`;
          const width = 112;
          const height = 84;
          const column = index % 3;
          const row = Math.floor(index / 3);
          const image = structuredClone(panes.get('SendPic'));
          const material = structuredClone(body.materials[image.material]);
          const textureIndex = body.textures.push({
            name: `letter-picker-${attachment.id}`,
            format: 4,
            width: attachment.thumbnail?.width ?? attachment.width,
            height: attachment.thumbnail?.height ?? attachment.height,
            url: attachment.thumbnail?.localSrc ?? attachment.localSrc,
          }) - 1;
          material.name = `${material.name}-${index}`;
          material.textureMaps = structuredClone(material.textureMaps);
          material.textureMaps[0].texture = textureIndex;
          image.name = imageName;
          image.flags = 1;
          image.alpha = index === pickerIndex ? 255 : 190;
          image.translation = [-170 + column * 130, 112 - row * 104, 2];
          image.size = [width, height];
          image.material = body.materials.push(material) - 1;
          const hit = {
            name: paneName,
            type: 'bnd1',
            flags: 1,
            origin: 4,
            alpha: 255,
            translation: image.translation,
            rotation: [0, 0, 0],
            scale: [1, 1],
            size: [width, height],
            children: [],
          };
          hit.children.push(image);
          body.root.children.push(hit);
        }
      }
      arrangeMessageBody(body, {
        kind: 'letter', text: keyboard?.snapshot().displayText ?? value,
        hint: text(142, 'Write a message'), keyboard: keyboard?.snapshot(),
        editing: Boolean(keyboard), progress, scrollOffset: scroll.snapshot().offset, measureTextLines,
        lineHeight: lines(keyboard?.snapshot().displayText ?? value).lineHeight,
      });
      const footerClips = [{
        animation: layouts.my_IplTop_e.animations.my_IplTop_e,
        // Incoming Reply completes common command 15 before creating this
        // child. Its MailIn body must not replay the already entered footer.
        group: 'G_SeenChange',
        frame: name === 'enter' && !footerAlreadyEntered ? 3313 + Math.min(frame, 13) : 3326,
        loop: false,
      }, ...['L', 'R'].map((side) => ({
        // The common footer retains its completed Board-arrow exit while an
        // input form owns it. Posing a fresh layout must retain that state too.
        animation: layouts.my_IplTop_e.animations.my_IplTop_e,
        group: `G_Arw${side}_End`, frame: 10110, loop: false,
      }))];
      footerClips.push(...footerInteraction.clips());
      if (name === 'exit' && footerExitToSelector) {
        const animation = layouts.my_IplTop_e.animations.my_IplTop_e;
        footerClips.push({ animation, group: 'G_CalExit',
          frame: 3000 + Math.min(frame, 20), loop: false });
        if (frame >= 21) footerClips.push({ animation, group: 'G_SeenChange',
          frame: frame < 36 ? 3413 + Math.min(frame - 21, 13)
            : 3113 + Math.min(frame - 36, 13), loop: false });
      }
      const footer = poseLayout(layouts.my_IplTop_e, footerClips);
      const left = name === 'exit' && footerExitToSelector && frame >= 35
        ? text(35, 'Back') : leftLabel();
      for (const pane of indexLayout(footer).panes.values())
        if (pane.type === 'txt1') pane.text = ({
          T_CalExit: left, T_Add: left, T_CalAdd_R: text(39, 'Send'),
        })[pane.name] ?? '';
      const layers = [{ layout: body, prefix: PREFIX }];
      if (!dialog && !keyboard && !['send', 'saving'].includes(name))
        layers.push({ layout: footer, prefix: FOOTER_PREFIX });
      if (keyboard) layers.push(...keyboardTransitionLayers(
        keyboard.presentation().layers, progress, name === 'keyboard-open',
      ));
      if (dialog) layers.push(...dialog.presentation().layers);
      return { ...api.snapshot(), layers, controls: controls().map((control) => ({
        ...control, disabled: Boolean(control.disabled || phase),
      })) };
    },
  };
  return api;
}
