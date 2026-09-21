import { indexLayout, poseLayout } from './animation.js';
import { arrowClip, createArrowInteraction } from './arrow-interaction.js';
import { createMemoScrollArrows } from './memo-scroll-arrows.js';
import { fitIncomingPhoto, validateIncomingLetter } from './incoming-letter-fixture.js';
import { createMemoEraseDialog, MEMO_DIALOG_LAYOUT } from './board-memo-dialog.js';

export const INCOMING_LETTER_LAYOUTS = ['my_LetterL', 'my_BbsMask_a', 'my_IplTop_e', MEMO_DIALOG_LAYOUT];
const BODY_PREFIX = 'incoming-letter:';
const FOOTER_PREFIX = 'incoming-letter-footer:';
const clamp = (value, maximum) => Math.max(0, Math.min(value, maximum));

/** Isolated incoming-message presentation. No API, Board mutation or transport
 * is installed here. The host owns local composer creation and calls resumeReply
 * after that child closes. Explicit local erasure and photo forwarding commit
 * through the host's local fixture callbacks.
 */
export function createIncomingLetterReader(layouts, {
  record, letterService = 'offline', messages = {}, onBack = () => {},
  onReply = null, onReplyError = () => {}, onServiceRequired = () => {}, onSound = () => {},
  onErase = null, onEraseError = () => {}, onErased = () => {},
  origin = [0, 0, 0], photoAvailable = true,
  measureTextLines = (value) => value.split('\n').length,
} = {}) {
  const letter = validateIncomingLetter(record);
  if (!['offline', 'local'].includes(letterService)) throw new Error('Invalid Letter service mode.');
  for (const key of INCOMING_LETTER_LAYOUTS)
    if (!layouts[key]) throw new Error(`Missing original incoming Letter layout: ${key}`);
  if (onReply !== null && typeof onReply !== 'function') throw new TypeError('Invalid local Reply callback.');
  if (onErase !== null && typeof onErase !== 'function') throw new TypeError('Invalid local erase callback.');
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite))
    throw new TypeError('Incoming Letter origin must contain three finite coordinates.');
  if (typeof photoAvailable !== 'boolean') throw new TypeError('Invalid photo availability.');
  const cardOrigin = [...origin];
  const showPhoto = Boolean(letter.photo) && photoAvailable;
  // BoardObject::permit_reply (USA 4.3, 0x81395E94) requires a nonzero
  // address type and a zero noReply flag. The local fixture models both.
  const canReply = letter.sender !== null && letter.replyAllowed !== false;
  const footerAppear = canReply ? 3640 : 3600;
  const footerDisappear = canReply ? 3660 : 3620;
  const source = layouts.my_LetterL;
  const strings = messages.messages || messages;
  const text = (id, fallback) => strings[id] ?? fallback;
  const panes = indexLayout(source).panes;
  const measuredLines = measureTextLines(letter.text, panes.get('T_Letter'), source);
  if (!Number.isFinite(measuredLines) || measuredLines < 0 || measuredLines > 1024)
    throw new RangeError('Incoming Letter text measurement is outside the fixture bounds.');
  const lines = Math.max(1, Math.ceil(measuredLines));
  const bodyCount = Math.ceil(lines / 4);
  const maximum = Math.max(0, 160 + bodyCount * panes.get('N_Body').size[1]
    + panes.get('N_Header').size[1] + panes.get('N_Footer').size[1] - 456);
  const animation = (suffix) => source.animations[`my_LetterL_${suffix}`];
  const clip = (suffix, frame, group) => ({ animation: animation(suffix), group,
    frame: Math.min(frame, animation(suffix).frames - 1), loop: false });
  const common = layouts.my_IplTop_e.animations.my_IplTop_e;
  const footerClip = (group, frame) => ({ animation: common, group, frame, loop: false });
  const arrows = createMemoScrollArrows(source, {
    stem: 'my_LetterL', controlPrefix: 'incoming', layoutPrefix: BODY_PREFIX, allowEditing: false,
  });
  const photoFocus = createArrowInteraction({
    'incoming-photo': {
      focusIn: arrowClip(animation('PicFocusIn'), 'G_Pic'),
      focusOut: arrowClip(animation('PicFocusOut'), 'G_Pic'),
    },
  });
  const footerDefinitions = Object.fromEntries(
    [['incoming-back', 'G_CalExit'], ['incoming-reply', 'G_Cmn_R']].map(([id, group]) => [id, {
      focusIn: arrowClip(common, group, 2900, 2906),
      focusOut: arrowClip(common, group, 2930, 2938),
      press: arrowClip(common, group, 3000, 3020),
    }]),
  );
  footerDefinitions['incoming-trash'] = {
    focusIn: arrowClip(common, 'G_Dust', 2900, 2909),
    focusOut: arrowClip(common, 'G_Dust', 2930, 2938),
    press: arrowClip(common, 'G_Dust', 2800, 2820),
  };
  const footerFocus = createArrowInteraction(footerDefinitions);
  let phase = { name: 'open', frame: 0, duration: 26 };
  let mode = 'letter';
  let hovered = null;
  let scroll = 0;
  let movement = null;
  let scrollSound = false;
  let closed = false;
  let age = 0;
  let replyGeneration = 0;
  let eraseGeneration = 0;
  let eraseDialog = null;
  let eraseCommitted = false;
  let eraseExitComplete = false;
  const sound = (active) => {
    if (active === scrollSound) return;
    scrollSound = active;
    onSound('WIPL_SE_MESSAGE_SCROLL', { loop: active });
  };
  const start = (name, duration) => {
    sound(false);
    hovered = null;
    photoFocus.hover(null);
    footerFocus.hover(null);
    arrows.hover(null);
    phase = { name, frame: 0, duration };
    updateArrows();
  };
  const updateArrows = () => {
    const returning = phase?.name === 'photo-out' && phase.frame >= animation('ExitPic').frames;
    const visible = (mode === 'letter' || returning) && !closed
      && !['open', 'close', 'reply-out', 'trash-select', 'erase-dialog',
        'erase-close', 'erase-wait'].includes(phase?.name);
    arrows.update({ previous: visible && scroll > 0, next: visible && scroll < maximum }, false);
  };
  const position = (frame) => {
    const progress = clamp(frame, 20) / 20;
    return clamp(movement.start + movement.delta * progress * progress * (3 - 2 * progress), maximum);
  };
  const finishErase = () => {
    if (closed || !eraseCommitted || !eraseExitComplete) return;
    closed = true;
    phase = null;
    onErased(letter.id);
  };
  const acceptErase = () => {
    const generation = ++eraseGeneration;
    eraseCommitted = false;
    eraseExitComplete = false;
    // 0x81397964 starts ExitLetter and reports result2 to the Board. Its
    // erase task (0x81391F24) and visual exit run independently; 0x813913DC
    // waits for the task before finally removing the object from the list.
    start('erase-close', Math.max(17, animation('ExitLetter').frames));
    onSound('WIPL_SE_BOARD_DUMP');
    const failed = (error) => {
      if (closed || generation !== eraseGeneration) return;
      eraseCommitted = false;
      eraseExitComplete = false;
      // A browser storage failure has no measured native counterpart. Keep
      // the same record and scroll position, then restore its original footer.
      start('trash-cancel', 13);
      onEraseError(error);
    };
    try {
      Promise.resolve(onErase(letter.id)).then(() => {
        if (closed || generation !== eraseGeneration) return;
        eraseCommitted = true;
        finishErase();
      }, failed);
    } catch (error) {
      failed(error);
    }
  };
  const complete = (name) => {
    phase = null;
    if (name === 'close') {
      closed = true;
      onBack();
    } else if (name === 'trash-select') {
      phase = { name: 'erase-dialog', frame: 0, duration: Infinity };
      eraseDialog = createMemoEraseDialog(layouts[MEMO_DIALOG_LAYOUT], {
        messages, onSound,
        onDone(accepted) {
          eraseDialog = null;
          if (closed) return;
          if (accepted) acceptErase();
          else start('trash-cancel', 13);
        },
      });
    } else if (name === 'erase-close') {
      eraseExitComplete = true;
      phase = { name: 'erase-wait', frame: animation('ExitLetter').frames, duration: Infinity };
      finishErase();
    } else if (name === 'photo-in') {
      mode = 'photo';
      start('photo-footer-in', 13);
    } else if (name === 'photo-out') mode = 'letter';
    else if (name === 'back-press') {
      if (mode === 'photo') start('photo-out', 26);
      else start('close', 26);
    } else if (name === 'reply-press') {
      if (letterService === 'offline') onServiceRequired();
      // The local host starts its child after the parent footer's 18→15
      // reservation. Native code requests scene 0xB while that queue runs;
      // reproducing their overlap requires a shared parent/child footer owner.
      else start('reply-out', 26);
    } else if (name === 'reply-out') {
      const forwardingPhoto = mode === 'photo' && showPhoto;
      mode = 'reply-child';
      const generation = ++replyGeneration;
      const failed = (error) => {
        // The host may remove this reader, cancel its child, or launch a newer
        // child before an asynchronous construction failure reaches us.
        if (closed || mode !== 'reply-child' || generation !== replyGeneration) return;
        api.resumeReply();
        onReplyError(error);
      };
      try {
        const reply = { recipient: { ...letter.sender }, recordId: letter.id };
        if (forwardingPhoto) reply.attachment = structuredClone(letter.photo);
        const pending = onReply(reply);
        if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(failed);
      } catch (error) {
        failed(error);
      }
    }
  };
  const controls = () => {
    if (closed || mode === 'reply-child') return [];
    if (eraseDialog) return eraseDialog.presentation().controls;
    const disabled = Boolean(phase);
    const result = [
      { id: 'incoming-back', pane: 'B_CalExit', prefix: FOOTER_PREFIX,
        label: text(35, 'Back'), disabled },
    ];
    if (mode === 'photo' || canReply) {
      result.push({ id: mode === 'photo' ? 'incoming-photo-send' : 'incoming-reply',
        pane: 'B_Add_R', prefix: FOOTER_PREFIX,
        label: mode === 'photo' ? text(39, 'Send') : text(67, 'Reply'),
        disabled: disabled || (mode === 'photo' && !canReply) ||
          (letterService === 'local' && !onReply) });
    }
    if (mode === 'letter' && letter.origin !== 'outbox') {
      result.push({ id: 'incoming-trash', pane: 'B_Dust', prefix: FOOTER_PREFIX,
        label: text(40, 'Trash'), disabled: disabled || !onErase });
      result.push(...arrows.controls().map((control) => ({ ...control, disabled })));
      if (showPhoto) result.push({ id: 'incoming-photo', pane: 'B_Pic', prefix: BODY_PREFIX,
        label: 'View attached photo', disabled });
    }
    return result;
  };
  const api = {
    controls,
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Invalid Letter frame delta.');
      if (closed) return;
      const advanceClocks = (step) => {
        age += step;
        photoFocus.advance(step);
        footerFocus.advance(step);
        arrows.advance(step);
        if (movement) {
          movement.frame += step;
          scroll = position(movement.frame);
          sound(mode === 'letter' && !phase
            && Math.abs(scroll - position(movement.frame - 1)) > 1);
          if (movement.frame >= 20) movement = null;
        } else sound(false);
      };
      if (eraseDialog) {
        advanceClocks(frames);
        eraseDialog.advance(frames);
        updateArrows();
        return;
      }
      let remaining = frames;
      while (remaining > 0 && !closed) {
        if (!phase) {
          advanceClocks(remaining);
          break;
        }
        const current = phase;
        const step = Math.min(remaining, current.duration - current.frame);
        advanceClocks(step);
        current.frame += step;
        remaining -= step;
        if (current.frame < current.duration) break;
        complete(current.name);
        updateArrows();
        if (eraseDialog) break;
      }
      updateArrows();
    },
    hover(id) {
      if (eraseDialog) return eraseDialog.hover(id);
      if (phase || !controls().some((control) => control.id === id && !control.disabled)) id = null;
      if (id === hovered) return false;
      hovered = id;
      photoFocus.hover(id);
      footerFocus.hover(id);
      arrows.hover(id);
      if (id) onSound('WIPL_SE_BT_TARGETTING');
      return true;
    },
    activate(id) {
      if (eraseDialog) return eraseDialog.activate(id);
      if (!controls().some((control) => control.id === id && !control.disabled)) return false;
      if (id === 'incoming-back') return api.back();
      if (id.startsWith('incoming-scroll-')) {
        if (movement) return false;
        movement = { start: scroll, delta: id.endsWith('up') ? -300 : 300, frame: -1 };
        arrows.press(id);
      } else if (id === 'incoming-photo') {
        onSound('WIPL_SE_PIC_ZOOM_IN');
        start('photo-in', animation('SelectPic').frames);
      } else if (id === 'incoming-reply' || id === 'incoming-photo-send') {
        onSound('WIPL_SE_DECIDE');
        footerFocus.press(id);
        start('reply-press', 21);
      } else if (id === 'incoming-trash') {
        onSound('WIPL_SE_BT_PUSH');
        start('trash-select', 33);
      }
      return true;
    },
    back() {
      if (eraseDialog) return eraseDialog.back();
      if (phase || closed || mode === 'reply-child') return false;
      // 0x8139B87C/0x8139B8E0 start common command 27 (3000..3020),
      // then state 3 waits for that press before the reader/photo exit.
      onSound(mode === 'photo' ? 'WIPL_SE_PIC_ZOOM_OUT' : 'WIPL_SE_BOARD_UNSELECT');
      footerFocus.press('incoming-back');
      start('back-press', 21);
      return true;
    },
    resumeReply() {
      if (closed || mode !== 'reply-child') return false;
      replyGeneration++;
      mode = 'letter';
      start('reply-back', 13);
      return true;
    },
    suspendAudio() { sound(false); },
    dispose() {
      closed = true;
      replyGeneration++;
      eraseGeneration++;
      eraseDialog = null;
      phase = null;
      movement = null;
      hovered = null;
      sound(false);
      updateArrows();
    },
    snapshot() {
      return { mode, phase: phase?.name ?? null, frame: phase?.frame ?? 0,
        duration: Number.isFinite(phase?.duration) ? phase.duration : 0,
        locked: eraseDialog ? eraseDialog.snapshot().phase !== 'idle'
          : Boolean(phase) || mode === 'reply-child',
        closed, scroll, scrollLimit: maximum, recordId: letter.id,
        erasing: ['erase-close', 'erase-wait'].includes(phase?.name),
        eraseDialog: eraseDialog?.snapshot() ?? null };
    },
    presentation() {
      const state = api.snapshot();
      if (closed) return { ...state, layers: [], controls: [] };
      const name = phase?.name;
      const frame = phase?.frame ?? 0;
      const exiting = ['close', 'erase-close', 'erase-wait'].includes(name);
      const bodyClips = [
        clip('SelectLetter', name === 'open' ? frame : Infinity),
        // 0x8139A1C8/0x8139A1E4 start the two original arrow-loop bindings
        // together. Both bind this resource to the same G_ArwRoop group.
        { animation: animation('Loop'), group: 'G_ArwRoop', frame: age, loop: true },
        ...arrows.clips(),
      ];
      if (exiting) bodyClips.push(clip('ExitLetter', frame));
      if (!phase && mode === 'letter') bodyClips.push(...photoFocus.clips());
      if (mode === 'photo' || name === 'photo-in' || name === 'photo-out') {
        bodyClips.push(clip('SelectPic', name === 'photo-in' ? frame : Infinity, 'G_Pic'));
        if (name === 'photo-out') bodyClips.push(clip('ExitPic', frame, 'G_Pic'));
      }
      if (name === 'reply-out' || mode === 'reply-child')
        bodyClips.push(clip('Reply', name === 'reply-out' ? frame : Infinity, 'G_Reply'));
      if (name === 'reply-back') bodyClips.push(clip('ReplyBack', frame, 'G_Reply'));
      const body = poseLayout(source, bodyClips);
      // Shared focus_object::LinearIntp<VEC3>, initialized with float17 at
      // 0x8139A170, independently interpolates the card origin and BRLAN scale.
      const originFraction = name === 'open' ? 1 - clamp(frame, 17) / 17
        : exiting ? clamp(frame, 17) / 17 : 0;
      body.root.translation = cardOrigin.map((value) => value * originFraction);
      const panes = indexLayout(body).panes;
      for (const pane of panes.values()) if (pane.type === 'txt1') pane.text = '';
      panes.get('T_Header').text = letter.header;
      panes.get('T_Letter').text = letter.text;
      for (const key of ['Nigaoe', 'B_Nigaoe', 'SendPic']) panes.get(key).flags &= ~1;
      const sheet = panes.get('N_Body');
      const copies = Array.from({ length: bodyCount - 1 }, (_, index) => {
        const copy = structuredClone(sheet);
        const rename = (pane) => {
          pane.name = `IncomingRow${index + 1}-${pane.name}`;
          for (const child of pane.children || []) rename(child);
        };
        rename(copy);
        copy.translation[1] -= sheet.size[1] * (index + 1);
        return copy;
      });
      const parent = panes.get('N_MemoRoot');
      parent.children.splice(parent.children.indexOf(sheet) + 1, 0, ...copies);
      panes.get('N_Footer').translation[1] -= sheet.size[1] * (bodyCount - 1);
      panes.get('N_Memo').translation[1] = scroll;
      if (showPhoto) {
        const photo = panes.get('Pic');
        photo.size = fitIncomingPhoto(letter.photo, panes.get('Pic').size);
        body.textures = [...body.textures, { name: `incoming-${letter.photo.id}`, format: 4,
          width: letter.photo.width, height: letter.photo.height, url: letter.photo.localSrc }];
        body.materials[photo.material].textureMaps[0] = {
          texture: body.textures.length - 1, wrapS: 0, wrapT: 0,
        };
      } else for (const key of ['N_Pic', 'B_Pic', 'PicMask']) panes.get(key).flags &= ~1;
      // Ordinary Letters use appear/disappear commands 17/18 with Reply,
      // or 13/14 without it. Open starts at 9, Back ends at 10, and photo
      // entry/Back use 15/16 around those same Letter reservations.
      // Dispatch table 0x8160F7B8; reader functions 0x8139AAA0/0x8139ABA4.
      const sequenceFrame = (first, second) => frame < 13 ? first + frame
        : second + clamp(frame - 13, 13);
      let footerFrame = mode === 'photo' ? 3326 : footerAppear + 13;
      if (name === 'open') footerFrame = sequenceFrame(3100, footerAppear);
      else if (name === 'close') footerFrame = sequenceFrame(footerDisappear, 3426);
      else if (name === 'photo-in') footerFrame = footerDisappear + clamp(frame, 13);
      else if (name === 'photo-footer-in') footerFrame = 3313 + clamp(frame, 13);
      else if (name === 'photo-out') footerFrame = sequenceFrame(3413, footerAppear);
      else if (name === 'reply-out') footerFrame = sequenceFrame(3660, 3313);
      else if (name === 'reply-back') footerFrame = 3640 + clamp(frame, 13);
      else if (name === 'trash-select') footerFrame = frame < 20 ? footerAppear + 13
        : footerDisappear + clamp(frame - 20, 13);
      else if (name === 'erase-dialog') footerFrame = footerDisappear + 13;
      else if (name === 'trash-cancel') footerFrame = footerAppear + clamp(frame, 13);
      else if (name === 'erase-close' || name === 'erase-wait') footerFrame = 3426 + clamp(frame, 13);
      const replying = (name === 'reply-out' && frame >= 13) || mode === 'reply-child';
      const photoFooter = mode === 'photo' && !(name === 'photo-out' && frame >= 13);
      const footer = poseLayout(layouts.my_IplTop_e, [
        footerClip('G_SeenChange', footerFrame),
        footerClip('G_ArwL_End', 10110), footerClip('G_ArwR_End', 10110), ...footerFocus.clips(),
        ...(name === 'trash-select' ? [footerClip('G_Dust', 2800 + clamp(frame, 20))] : []),
      ]);
      let rightLabel = canReply ? text(67, 'Reply') : '';
      if (replying || photoFooter) rightLabel = text(39, 'Send');
      for (const pane of indexLayout(footer).panes.values()) if (pane.type === 'txt1') {
        pane.text = {
          T_CalExit: replying ? text(37, 'Cancel') : text(35, 'Back'),
          T_CalAdd_R: rightLabel,
          T_Dust: text(40, 'Trash'),
        }[pane.name] ?? '';
      }
      const maskSource = layouts.my_BbsMask_a;
      const maskSuffix = exiting ? 'MaskOut' : 'MaskIn';
      const mask = poseLayout(maskSource, [{ animation: maskSource.animations[`my_BbsMask_a_${maskSuffix}`],
        frame: name === 'open' || exiting ? frame : Infinity, loop: false }]);
      // focus_object::draw at 0x81398C04 draws T_Letter and N_TopBtn before
      // PicMask/N_Pic, then ReplyMask last. The BRLYT hierarchy alone reverses
      // the arrows/photo order. Keep every original ancestor transform while
      // drawing those overlays in the native order, without a second pose.
      const photoOverlay = {
        ...body,
        root: {
          ...body.root,
          children: [
            {
              ...panes.get('N_Memo'),
              children: [{
                ...parent,
                children: parent.children.filter((pane) =>
                  ['PicMask', 'N_Pic'].includes(pane.name)),
              }],
            },
            panes.get('ReplyMask'),
          ],
        },
      };
      return { ...state, layers: [
        { layout: mask, prefix: 'incoming-letter-mask:' },
        { layout: body, prefix: BODY_PREFIX, exclude: new Set(['PicMask', 'N_Pic', 'ReplyMask']) },
        { layout: photoOverlay, prefix: BODY_PREFIX },
        ...(mode === 'reply-child' ? [] : [{ layout: footer, prefix: FOOTER_PREFIX }]),
        ...(eraseDialog?.presentation().layers || []),
      ], controls: controls() };
    },
  };
  updateArrows();
  onSound('WIPL_SE_BOARD_SELECT');
  return api;
}
