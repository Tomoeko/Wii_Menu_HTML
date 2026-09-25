import { indexLayout, poseLayout } from './animation.js';
import { standardDisplay } from './display.js';
import { createMemoEraseDialog, MEMO_DIALOG_LAYOUT } from './board-memo-dialog.js';
import { createMemoScrollArrows } from './memo-scroll-arrows.js';
import { createFooterArrowVisibility } from './footer-controller.js';
import { createIncomingLetterSession, INCOMING_SESSION_LAYOUTS } from './incoming-letter-session.js';
import { validateIncomingLetter } from './incoming-letter-fixture.js';
import { isPrimaryKeyboardTrigger } from './keyboard-activation.js';

export const MEMO_LAYOUTS = [
  'LetterS_a',
  'LetterS_b',
  'my_Memo_a',
  'my_BbsMask_a',
  'my_IplTop_e',
  MEMO_DIALOG_LAYOUT,
  ...INCOMING_SESSION_LAYOUTS,
];
const CARD = 'LetterS_a',
  READER = 'my_Memo_a',
  MASK = 'my_BbsMask_a',
  FOOTER = 'my_IplTop_e';
const READER_PREFIX = 'memo-reader:',
  FOOTER_PREFIX = 'memo-footer:';
const clamp = (value, max) => Math.max(0, Math.min(value, max));
const cardLayout = (record) => record.kind === 'letter' ? 'LetterS_b' : CARD;
const dayKey = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    : null;
};
export const MEMOS_PER_PAGE = 10;

/** BoardObject::set_thumb_text copies six UTF-16 units, stopping at a newline. */
export function memoThumbnail(text) {
  const firstLine = String(text).split('\n')[0];
  return firstLine.length > 6 ? `${firstLine.slice(0, 6)}...` : firstLine;
}

/** RBRGetPosRect and Nwc24Manager's shared Memo/letter record path. */
export const MEMO_BOUNDS = Object.freeze({
  left: -230,
  right: 230,
  bottom: -80,
  top: 180,
});
export function newMemoPosition(random = Math.random) {
  // Native receive() evaluates Y before X and uses separate single-precision
  // multiply/add instructions (USA 4.3, 0x81343344–0x81343380).
  const vertical = Math.fround(random());
  const horizontal = Math.fround(random());
  return {
    x: Math.fround(-230 + Math.fround(460 * horizontal)),
    y: Math.fround(180 + Math.fround(-260 * vertical)),
  };
}
export function memoPosition(record) {
  const position = record.position ?? { x: 0, y: 53 };
  return [Math.max(-230, Math.min(230, position.x)), Math.max(-80, Math.min(180, position.y)), 0];
}
export function memoSummary(records, today = new Date()) {
  const current = records.filter((record) => dayKey(record.createdAt) === dayKey(today));
  return {
    count: Math.min(99, current.length),
    unreadCount: current.filter((record) => !record.readAt).length,
  };
}

/** Original BoardObject cards, pinch motion and focus_object reader/deletion.
 * Local record transport replaces CDB/NAND; source layout animations are retained. */
export function createBoardMemos(
  layouts,
  {
    memos = [],
    date = new Date(),
    messages = {},
    display = standardDisplay,
    measureTextLines = (value) => String(value).split('\n').length,
    now = () => new Date(),
    onBack = () => {},
    onMemos = () => {},
    onSound = () => {},
    random = Math.random,
    letterService = 'offline',
    onLetter,
    onLetterError,
    onEraseLetter,
    onEraseMemo = null,
    onBoardError = () => {},
    onAction,
    measureTextLayout,
    measureText,
    predict,
    getKeyboardPreferences,
    onKeyboardPreferencesChange,
    unavailablePhotoIds = new Set(),
    unavailableThumbnailIds = new Set(),
  } = {},
) {
  for (const key of MEMO_LAYOUTS)
    if (!layouts[key]) throw new Error(`Missing original Memo layout: ${key}`);
  if (onEraseMemo !== null && typeof onEraseMemo !== 'function') {
    throw new TypeError('Invalid local Memo erase callback.');
  }
  const messageMap = messages.messages || messages;
  const text = (id, fallback) => messageMap[id] ?? fallback;
  const animation = (key, suffix) => layouts[key].animations[`${key}_${suffix}`];
  const clip = (key, suffix, frame, group, loop = false) => ({
    animation: animation(key, suffix),
    frame,
    group,
    loop,
  });
  const footerClip = (group, frame) => ({
    animation: layouts[FOOTER].animations[FOOTER],
    frame,
    group,
    loop: false,
  });
  const duration = (key, suffix) => animation(key, suffix).frames;
  let records = [],
    selectedDate = dayKey(date),
    age = 0,
    selected = null;
  let drag = null,
    dialog = null,
    erasePending = false;
  let incoming = null;
  let eraseGeneration = 0;
  let eraseCommitted = false;
  let eraseExitComplete = false;
  const arrival = new Map();
  const pinAnimations = new Map();
  let phase = 'board',
    frame = 0,
    hovered = null,
    focus = new Map(),
    cardOrder = [];
  let scroll = 0,
    scrollTween = null,
    lineCount = 1,
    scrollLimit = 0;
  let scrollSoundActive = false;
  const setScrollSound = (active) => {
    if (active === scrollSoundActive) return;
    scrollSoundActive = active;
    onSound('WIPL_SE_MESSAGE_SCROLL', { loop: active });
  };
  const scrollPosition = (motion, frame) => {
    const progress = clamp(frame, 20) / 20;
    return clamp(motion.start + motion.delta * progress * progress * (3 - 2 * progress),
      scrollLimit);
  };
  let readerArrows = createMemoScrollArrows(layouts[READER]);
  const footerArrows = createFooterArrowVisibility(layouts[FOOTER]);
  let heldArrow = null;
  const arrowId = (id) =>
    id === 'memo-up' ? 'memo-scroll-up' : id === 'memo-down' ? 'memo-scroll-down' : null;
  const updateReaderArrows = () => {
    const visible = !['board', 'open', 'close', 'erase-close', 'erase-wait'].includes(phase);
    readerArrows.update({
      previous: visible && scroll > 0,
      next: visible && scroll < scrollLimit,
    }, false);
  };
  let page = 0;
  let pageTransition = null;
  let dayRecords = [];
  const pageCount = () => Math.max(1, Math.ceil(dayRecords.length / MEMOS_PER_PAGE));
  const visible = () => dayRecords.slice(page * MEMOS_PER_PAGE, (page + 1) * MEMOS_PER_PAGE);
  const prefix = (record) => `memo-card-${record.id}:`;
  const reading = () => phase !== 'board';
  const locked = () => incoming ? incoming.snapshot().locked : !['board', 'read'].includes(phase);
  const resetSelection = () => {
    eraseGeneration++;
    incoming?.dispose();
    incoming = null;
    setScrollSound(false);
    selected = null;
    phase = 'board';
    frame = 0;
    hovered = null;
    focus.clear();
    scrollTween = null;
    heldArrow = null;
    readerArrows = createMemoScrollArrows(layouts[READER]);
    footerArrows.reset();
    footerArrows.setArrows({ prev: true, next: true });
    drag = null;
    dialog = null;
    erasePending = false;
    pageTransition = null;
  };
  const refreshOrder = () => {
    dayRecords = records
      .filter((record) => dayKey(record.createdAt) === selectedDate)
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    page = Math.min(page, pageCount() - 1);
    cardOrder = visible().map((record) => record.id);
  };
  const normalize = (record, index) => {
    if (!record || typeof record.text !== 'string' || !dayKey(record.createdAt)) return null;
    const content = record.kind === 'letter' ? validateIncomingLetter(record) : record;
    const position = record.position
      ? memoPosition(record)
      : Object.values(newMemoPosition(random));
    return {
      ...content,
      id: String(record.id ?? `local-${record.createdAt}-${index}`),
      position: { x: position[0], y: position[1] },
      readAt: record.readAt ?? null,
    };
  };
  const setMemos = (value, { settled = false } = {}) => {
    records = (Array.isArray(value) ? value : []).map(normalize).filter(Boolean);
    page = 0;
    arrival.clear();
    pinAnimations.clear();
    for (const record of records) {
      const start = settled
        ? age - duration(cardLayout(record), 'PasteLetter')
        : age;
      arrival.set(record.id, start);
    }
    refreshOrder();
    resetSelection();
  };
  setMemos(memos);

  const emit = () =>
    onMemos(structuredClone(records));

  const finishMemoErase = () => {
    if (!erasePending || !eraseCommitted || !eraseExitComplete) return;
    records = records.filter((record) => record.id !== selected.id);
    refreshOrder();
    emit();
    resetSelection();
    onBack();
  };
  const acceptMemoErase = () => {
    const generation = ++eraseGeneration;
    erasePending = true;
    eraseCommitted = false;
    eraseExitComplete = false;
    phase = 'erase-close';
    onSound('WIPL_SE_BOARD_DUMP');
    const failed = (error) => {
      if (generation !== eraseGeneration || !erasePending) return;
      erasePending = false;
      phase = 'trash-cancel';
      frame = 0;
      onBoardError(error);
    };
    try {
      const pending = onEraseMemo?.(selected.id);
      if (pending && typeof pending.then === 'function') {
        Promise.resolve(pending).then(() => {
          if (generation !== eraseGeneration || !erasePending) return;
          eraseCommitted = true;
          finishMemoErase();
        }, failed);
      } else {
        // Standalone resource fixtures can own an in-memory Board. The app
        // supplies the explicit server commit promise before any card removal.
        eraseCommitted = true;
      }
    } catch (error) {
      failed(error);
    }
  };

  function controls(dialogView = null) {
    if (incoming) return incoming.presentation().controls;
    if (dialog) return (dialogView ?? dialog.presentation()).controls;
    if (!reading())
      return visible().map((record) => ({
        id: `memo-open-${record.id}`,
        pane: 'B_Letter',
        prefix: prefix(record),
        label: record.text || (record.kind === 'letter' ? record.header : text(133, 'Memo')),
        disabled:
          Boolean(drag) || Boolean(pageTransition) ||
          age - (arrival.get(record.id) ?? 0) < duration(cardLayout(record), 'PasteLetter'),
      }));
    return [
      {
        id: 'memo-back',
        pane: 'B_CalExit',
        prefix: FOOTER_PREFIX,
        label: text(35, 'Back'),
        disabled: locked(),
      },
      {
        id: 'memo-trash',
        pane: 'B_Dust',
        prefix: FOOTER_PREFIX,
        label: text(40, 'Trash'),
        disabled: locked(),
      },
      ...readerArrows.controls().map((control) => ({
        ...control,
        id: control.id === 'memo-scroll-up' ? 'memo-up' : 'memo-down',
        prefix: READER_PREFIX,
        label: control.id === 'memo-scroll-up' ? 'Scroll up' : 'Scroll down',
        // Native trigger handling rejects a new scroll while Scroller is
        // active. Keep hit regions alive so its pointer focus does not leave.
        disabled: locked(),
      })),
    ];
  }
  function cardLayer(record, index, offsetX = 0, renderAge = age,
    { settled = false, neutral = false, pageEntry = false } = {}) {
    const id = `memo-open-${record.id}`,
      motion = neutral ? null : focus.get(id);
    // USA 4.3 BoardObject::stt_create selects table entry 1 for ordinary
    // incoming Letters (0x8164B4C8), independently of an attached photo.
    const card = cardLayout(record);
    const pasteFrame = settled
      ? duration(card, 'PasteLetter')
      : renderAge - (arrival.get(record.id) ?? 0);
    const clips = [clip(card, 'PasteLetter', pasteFrame)];
    if (motion) clips.push(clip(card, motion.entering ? 'FocusIn' : 'FocusOut', motion.frame));
    if (pageTransition && !neutral) clips.push(clip(card, 'NextPage', pageTransition.frame));
    const selection = neutral ? null : incoming?.snapshot();
    const cardPhase = selection?.readerPhase ?? phase;
    const cardFrame = selection?.readerFrame ?? frame;
    if (!neutral && selected?.id === record.id) {
      if (cardPhase === 'close' && cardFrame >= duration(card, 'ExitLetter')) {
        // ExitLetter restores the card at its focused 1.1 scale. The common
        // 26-frame reader close leaves time for its authored six-frame
        // FocusOut before BoardObject releases the selected card.
        clips.push(clip(card, 'FocusOut',
          cardFrame - duration(card, 'ExitLetter')));
      } else {
        const exiting = ['close', 'erase-close', 'erase-wait'].includes(cardPhase);
        clips.push(clip(card, exiting ? 'ExitLetter' : 'SelectLetter',
          ['open', 'close', 'erase-close', 'erase-wait'].includes(cardPhase)
            ? cardFrame : duration(card, 'SelectLetter')));
      }
    }
    if (!pinAnimations.has(record.id)) {
      // USA 4.3 BoardObject::stt_create, 0x81394A58–0x81394B0C:
      // choose the pin once when the card is created, only for past timestamps.
      const currentTime = new Date(typeof now === 'function' ? now() : now).getTime();
      const elapsed = currentTime - new Date(record.createdAt).getTime();
      let suffix = null;
      if (elapsed > 0) suffix = elapsed < 21600 * 1000 ? 'NewAnim' : 'DefAnim';
      pinAnimations.set(record.id, suffix);
    }
    const pinAnimation = pinAnimations.get(record.id);
    if (pinAnimation) clips.push(clip(card, pinAnimation, renderAge, 'G_New', true));
    const layout = poseLayout(layouts[card], clips),
      panes = indexLayout(layout).panes;
    // 0x8139476C selects record+0x11C (header) for Letters and +0x120 (body)
    // for Memo before the shared six-unit thumbnail formatter.
    panes.get('T_Letter').text = memoThumbnail(
      record.kind === 'letter' ? record.header : record.text,
    );
    panes.get('Nigaoe').flags &= ~1;
    if (record.kind === 'letter') {
      const thumbnail = record.photo?.thumbnail;
      if (!thumbnail || unavailableThumbnailIds.has(record.photo.id)) {
        panes.get('N_Pic').flags &= ~1;
      } else {
        // 0x81394BBC binds capture texture map 0 before starting PasteLetter.
        // An explicit predecoded fixture preserves the authored photo frame,
        // shadow, UVs and transforms without guessing the GX sampling state.
        const picture = panes.get('LetterPic');
        const material = layout.materials[picture.material];
        const texture = layout.textures.length;
        layout.textures = [...layout.textures,
          { name: `incoming-thumbnail-${record.photo.id}`, format: 4,
            width: 64, height: 48, url: thumbnail.localSrc }];
        material.textureMaps[0] = { ...material.textureMaps[0], texture };
      }
    }
    const position = memoPosition(record);
    if (!neutral && drag?.id === record.id) {
      position[0] += drag.delta.x;
      position[1] += drag.delta.y;
    }
    if (pageTransition && !neutral) {
      // BoardObject::calc (0x81394134 onward) linearly gathers outgoing
      // records at the opposite arrow while the original NextPage clip plays.
      const progress = clamp(pageTransition.frame, duration(card, 'NextPage')) /
        duration(card, 'NextPage');
      const targetX = pageTransition.direction === 'prev' ? 304 : -304;
      position[0] += (targetX - position[0]) * progress;
      position[1] += (53 - position[1]) * progress;
    } else if (pageEntry && pageTransition) {
      const progress = clamp(pageTransition.frame, duration(card, 'NextPage')) /
        duration(card, 'NextPage');
      const startX = pageTransition.direction === 'prev' ? -304 : 304;
      position[0] = startX + (position[0] - startX) * progress;
      position[1] = 53 + (position[1] - 53) * progress;
    }
    layout.root.translation = [position[0] * display.rootScaleX + offsetX, position[1], 0];
    return { layout, prefix: prefix(record) };
  }
  function readerLayer() {
    const suffix = ['close', 'erase-close', 'erase-wait'].includes(phase) ? 'ExitLetter' : 'SelectLetter';
    const clips = [
      clip(
        READER,
        suffix,
        ['open', 'close', 'erase-close', 'erase-wait'].includes(phase) ? frame : duration(READER, suffix),
      ),
      clip(READER, 'Loop', age, 'G_ArwRoop', true),
    ];
    clips.push(...readerArrows.clips());
    const layout = poseLayout(layouts[READER], clips),
      panes = indexLayout(layout).panes;
    for (const pane of panes.values()) if (pane.type === 'txt1') pane.text = '';
    panes.get('T_Header').text = text(133, 'Memo');
    panes.get('T_Letter').text = selected.text;
    panes.get('Nigaoe').flags &= ~1;
    panes.get('B_Nigaoe').flags &= ~1;
    const body = panes.get('N_Body'),
      root = panes.get('N_MemoRoot');
    const strips = Array.from({ length: lineCount - 1 }, (_, index) => {
      const strip = structuredClone(body);
      const rename = (pane) => {
        pane.name = `MemoReadRow${index + 1}-${pane.name}`;
        for (const child of pane.children || []) rename(child);
      };
      rename(strip);
      strip.translation[1] -= body.size[1] * (index + 1);
      return strip;
    });
    root.children.splice(root.children.indexOf(body) + 1, 0, ...strips);
    panes.get('N_Footer').translation[1] -= (lineCount - 1) * body.size[1];
    panes.get('N_Memo').translation[1] = scroll;
    const position = memoPosition(
      selected,
      visible().findIndex((record) => record.id === selected.id),
    );
    // focus_object::mFadeAnim is LinearIntp<VEC3>, independently of BRLAN scale.
    const fraction =
      phase === 'open'
        ? 1 - clamp(frame, 17) / 17
        : ['close', 'erase-close', 'erase-wait'].includes(phase)
          ? clamp(frame, 17) / 17
          : 0;
    layout.root.translation = position.map((value) => value * fraction);
    return { layout, prefix: READER_PREFIX };
  }
  function footerFrame() {
    if (phase === 'open') return frame < 13 ? 3100 + frame : 3600 + clamp(frame - 13, 13);
    if (phase === 'close') return frame < 13 ? 3620 + frame : 3426 + clamp(frame - 13, 13);
    if (phase === 'trash-select') return frame < 20 ? 3613 : 3620 + clamp(frame - 20, 13);
    if (phase === 'erase-dialog') return 3633;
    if (phase === 'trash-cancel') return 3600 + clamp(frame, 13);
    if (['erase-close', 'erase-wait'].includes(phase)) return 3426 + clamp(frame, 13);
    return 3613;
  }
  function footerLayer() {
    const clips = [
      footerClip('G_SeenChange', footerFrame()),
      ...footerArrows.clips(),
    ];
    const backFocus = focus.get('memo-back');
    if (backFocus)
      clips.push(
        footerClip(
          'G_CalExit',
          (backFocus.entering ? 2900 : 2930) + clamp(backFocus.frame, backFocus.entering ? 6 : 8),
        ),
      );
    const trashFocus = focus.get('memo-trash');
    if (trashFocus)
      clips.push(
        footerClip(
          'G_Dust',
          (trashFocus.entering ? 2900 : 2930) +
            clamp(trashFocus.frame, trashFocus.entering ? 9 : 8),
        ),
      );
    if (phase === 'trash-select') clips.push(footerClip('G_Dust', 2800 + clamp(frame, 20)));
    if (phase === 'back-select') clips.push(footerClip('G_CalExit', 3000 + clamp(frame, 20)));
    clips.push(footerClip('G_BbsSignal', 0), footerClip('G_BbsSignal_new', 0));
    const layout = poseLayout(layouts[FOOTER], clips),
      panes = indexLayout(layout).panes;
    for (const pane of panes.values()) if (pane.type === 'txt1') pane.text = '';
    panes.get('T_CalExit').text = text(35, 'Back');
    panes.get('T_Dust').text = text(40, 'Trash');
    return { layout, prefix: FOOTER_PREFIX };
  }
  const api = {
    controls,
    setMemos,
    suspendAudio() {
      // HOME can freeze this controller before its next calc. Release the
      // movement cue now; a later moving update can acquire it again.
      setScrollSound(false);
      incoming?.suspendAudio();
    },
    holdControl(id) {
      if (incoming) return incoming.holdControl(id);
      if (!arrowId(id) || dialog || locked() ||
          !controls().some((control) => control.id === id && !control.disabled)) return false;
      heldArrow = id;
      api.hover(id);
      // Reader event 0x8139B698 uses downTrg, unlike the text editor's held-A
      // repeat. Consume this press even when an active scroll rejects it, so
      // releasing later cannot turn the rejected trigger into a new click.
      api.activate(id);
      return true;
    },
    releaseControl() {
      incoming?.releaseControl();
      heldArrow = null;
    },
    setDate(value) {
      const next = dayKey(value);
      if (!next) throw new RangeError('Memo board date must be valid');
      if (next !== selectedDate) {
        const pending = new Set([...arrival].filter(([, start]) => start === Infinity)
          .map(([id]) => id));
        selectedDate = next;
        page = 0;
        age = 0;
        resetSelection();
        refreshOrder();
        arrival.clear();
        for (const record of records) {
          arrival.set(record.id, pending.has(record.id)
            ? Infinity : -duration(cardLayout(record), 'PasteLetter'));
        }
        pinAnimations.clear();
      }
    },
    settledCardsForDate(value, { offsetX = 0 } = {}) {
      const key = dayKey(value);
      if (!key) throw new RangeError('Memo board date must be valid');
      return records
        .filter((record) => dayKey(record.createdAt) === key)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .slice(0, MEMOS_PER_PAGE)
        .filter((record) => arrival.get(record.id) !== Infinity)
        .map((record, index) => cardLayer(record, index, offsetX, age,
          { settled: true, neutral: true }));
    },
    addMemo(record, { deferAppearance = false } = {}) {
      const normalized = normalize(record, records.length);
      if (!normalized) return false;
      records = [...records.filter((value) => value.id !== normalized.id), normalized];
      if (dayKey(normalized.createdAt) === selectedDate) page = 0;
      arrival.set(normalized.id, deferAppearance ? Infinity : age);
      pinAnimations.delete(normalized.id);
      refreshOrder();
      if (!deferAppearance) onSound('WIPL_SE_MSG_DISP', { pan: normalized.position.x / 304 });
      emit();
      return true;
    },
    revealPendingMemos() {
      for (const record of records)
        if (arrival.get(record.id) === Infinity) {
          arrival.set(record.id, age);
          onSound('WIPL_SE_MSG_DISP', { pan: record.position.x / 304 });
        }
    },
    records: () => structuredClone(records),
    summary: (today = new Date()) => memoSummary(records, today),
    canTurnPage(direction) {
      return direction === 'prev' ? page + 1 < pageCount() : direction === 'next' && page > 0;
    },
    turnPage(direction) {
      if (reading() || drag || pageTransition || !api.canTurnPage(direction)) return false;
      hovered = null;
      focus.clear();
      pageTransition = { direction, frame: 0, target: page + (direction === 'prev' ? 1 : -1) };
      onSound('WIPL_SE_MSG_HOUSE', { pan: direction === 'prev' ? 300 / 304 : -300 / 304 });
      return true;
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0)
        throw new RangeError('Frames must be nonnegative');
      age += frames;
      if (incoming) {
        incoming.advance(frames);
        return;
      }
      if (pageTransition) {
        pageTransition.frame += frames;
        if (pageTransition.frame >= duration(CARD, 'NextPage')) {
          page = pageTransition.target;
          resetSelection();
          refreshOrder();
          pinAnimations.clear();
          for (const record of visible()) {
            if (arrival.get(record.id) !== Infinity) {
              arrival.set(record.id, age - duration(cardLayout(record), 'PasteLetter'));
            }
          }
        }
      }
      if (drag && frames > 0) {
        const speed = Math.hypot(drag.delta.x - drag.last.x, drag.delta.y - drag.last.y) / frames;
        drag.last = { ...drag.delta };
        const record = records.find((record) => record.id === drag.id);
        // USA4.3 holdSEwithPosDis: pan=x/304; volume=min(1,2*speed/304).
        onSound('WIPL_SE_BOARD_DRAG', {
          loop: true,
          gain: Math.min(1, (2 * speed) / 304),
          pan: Math.max(-1, Math.min(1, (record.position.x + drag.delta.x) / 304)),
          speed,
        });
      }
      readerArrows.advance(frames);
      footerArrows.advance(frames);
      for (const motion of focus.values()) motion.frame += frames;
      if (scrollTween) {
        scrollTween.frame += frames;
        scroll = scrollPosition(scrollTween, scrollTween.frame);
        // Scroller::calc (0x81363F6C) holds MESSAGE_SCROLL only when its
        // clamped position changes by more than one unit in an update. Sample
        // the last logical update, not the whole browser batch: a paused or
        // delayed render must not restart sound after movement has finished.
        const movement = Math.abs(scroll - scrollPosition(scrollTween, scrollTween.frame - 1));
        if (frames > 0) setScrollSound(phase === 'read' && movement > 1);
        if (scrollTween.frame >= 20) scrollTween = null;
      } else if (frames > 0) setScrollSound(false);
      if (dialog) {
        dialog.advance(frames);
        updateReaderArrows();
        return;
      }
      let remaining = frames;
      while (locked()) {
        const end = ['open', 'close'].includes(phase)
          ? 26
          : phase === 'erase-wait'
            ? Infinity
            : phase === 'erase-close'
            ? 17
            : phase === 'trash-select'
              ? 33
              : phase === 'trash-cancel'
                ? 13
                : 20;
        const step = Math.min(remaining, end - frame);
        frame += step;
        remaining -= step;
        if (frame < end) break;
        if (phase === 'open') {
          phase = 'read';
          frame = 0;
        } else if (phase === 'trash-select') {
          phase = 'erase-dialog';
          frame = 0;
          dialog = createMemoEraseDialog(layouts[MEMO_DIALOG_LAYOUT], {
            messages,
            onSound,
            onDone: (accepted) => {
              dialog = null;
              frame = 0;
              focus.clear();
              if (accepted) acceptMemoErase();
              else phase = 'trash-cancel';
            },
          });
          if (remaining) dialog.advance(remaining);
          break;
        } else if (phase === 'trash-cancel') {
          phase = 'read';
          frame = 0;
        } else if (phase === 'back-select') {
          phase = 'close';
          frame = 0;
          focus.clear();
        } else if (phase === 'erase-close') {
          eraseExitComplete = true;
          phase = 'erase-wait';
          finishMemoErase();
        } else {
          resetSelection();
          onBack();
        }
        if (!remaining) break;
      }
      updateReaderArrows();
      if (heldArrow && !controls().some((control) => control.id === heldArrow))
        api.releaseControl();
    },
    hover(id) {
      if (incoming) return incoming.hover(id);
      if (heldArrow !== id) api.releaseControl();
      if (dialog) return dialog.hover(id);
      if (drag) return false;
      if (
        locked() ||
        hovered === id ||
        (id && !controls().some((control) => control.id === id && !control.disabled))
      )
        return false;
      readerArrows.hover(arrowId(id));
      if (hovered && !arrowId(hovered)) focus.set(hovered, { entering: false, frame: 0 });
      hovered = id;
      if (id && !arrowId(id)) focus.set(id, { entering: true, frame: 0 });
      if (id?.startsWith('memo-open-')) {
        onSound('WIPL_SE_BOARD_FOCUS');
        const recordId = id.slice(10);
        cardOrder = [...cardOrder.filter((value) => value !== recordId), recordId];
      } else if (arrowId(id)) onSound('WIPL_SE_BT_TARGETTING');
      return true;
    },
    activate(id, triggers) {
      if (incoming) return incoming.activate(id, triggers);
      if (!isPrimaryKeyboardTrigger(triggers)) return false;
      if (dialog) return dialog.activate(id);
      if (drag) return false;
      if (!controls().some((control) => control.id === id && !control.disabled)) return false;
      if (id === 'memo-back') return api.back();
      if (id === 'memo-trash') {
        setScrollSound(false);
        api.releaseControl();
        readerArrows.hover(null);
        phase = 'trash-select';
        frame = 0;
        hovered = null;
        onSound('WIPL_SE_BT_PUSH');
        return true;
      }
      if (id === 'memo-up' || id === 'memo-down') {
        if (scrollTween) return false;
        // Original 43U Scroller::calc at 0x81363CF8 initializes a 20-frame
        // zero-tangent Hermite 0→±300, then clamps the resulting position on
        // every update. The first update initializes without advancing it.
        scrollTween = {
          start: scroll,
          delta: id === 'memo-up' ? -300 : 300,
          frame: -1,
        };
        readerArrows.press(arrowId(id));
        return true;
      }
      selected = visible().find((record) => `memo-open-${record.id}` === id);
      if (!selected.readAt) {
        selected.readAt = new Date(typeof now === 'function' ? now() : now).toISOString();
        emit();
      }
      if (selected.kind === 'letter') {
        phase = 'incoming';
        hovered = null;
        incoming = createIncomingLetterSession(layouts, {
          record: selected, origin: memoPosition(selected), messages, display,
          photoAvailable: !unavailablePhotoIds.has(selected.photo?.id),
          letterService, onLetter, onLetterError, onAction, onSound,
          onErase: onEraseLetter,
          onEraseError: onLetterError,
          onErased(id) {
            records = records.filter((record) => record.id !== id);
            refreshOrder();
            emit();
            resetSelection();
            onBack();
          },
          measureTextLines, measureTextLayout, measureText, predict,
          getKeyboardPreferences, onKeyboardPreferencesChange,
          onBack() {
            resetSelection();
            onBack();
          },
        });
        return true;
      }
      onSound('WIPL_SE_BOARD_SELECT');
      const panes = indexLayout(layouts[READER]).panes;
      lineCount = Math.max(
        1,
        Math.ceil(measureTextLines(selected.text, panes.get('T_Letter'), layouts[READER])),
      );
      scrollLimit = Math.max(
        0,
        160 +
          lineCount * panes.get('N_Body').size[1] +
          panes.get('N_Header').size[1] +
          panes.get('N_Footer').size[1] -
          456,
      );
      scroll = 0;
      scrollTween = null;
      heldArrow = null;
      readerArrows = createMemoScrollArrows(layouts[READER]);
      phase = 'open';
      frame = 0;
      footerArrows.setArrows({ prev: false, next: false });
      hovered = null;
      return true;
    },
    back() {
      if (incoming) return incoming.back();
      if (dialog) return dialog.back();
      if (drag) return api.cancelPointer();
      if (phase !== 'read') return false;
      setScrollSound(false);
      api.releaseControl();
      readerArrows.hover(null);
      onSound('WIPL_SE_BOARD_UNSELECT');
      phase = 'back-select';
      frame = 0;
      footerArrows.setArrows({ prev: true, next: true }, { delay: 20 });
      hovered = null;
      return true;
    },
    pointerDown(id, point) {
      if (
        phase !== 'board' ||
        drag ||
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      )
        return false;
      const record = visible().find((record) => `memo-open-${record.id}` === id);
      if (!record || !controls().some((control) => control.id === id && !control.disabled))
        return false;
      drag = {
        id: record.id,
        origin: { ...point },
        delta: { x: 0, y: 0 },
        last: { x: 0, y: 0 },
      };
      cardOrder = [...cardOrder.filter((value) => value !== record.id), record.id];
      onSound('WIPL_SE_BOARD_HOLD', { pan: record.position.x / 304 });
      return true;
    },
    pointerMove(point) {
      if (!drag || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
      const delta = {
        x: (point.x - drag.origin.x) / display.rootScaleX,
        y: point.y - drag.origin.y,
      };
      drag.delta = delta;
      return true;
    },
    pointerUp(point) {
      if (!drag) return false;
      if (point) api.pointerMove(point);
      const record = records.find((record) => record.id === drag.id);
      const position = memoPosition({
        position: {
          x: record.position.x + drag.delta.x,
          y: record.position.y + drag.delta.y,
        },
      });
      record.position = { x: position[0], y: position[1] };
      drag = null;
      onSound('WIPL_SE_BOARD_DRAG', { loop: false });
      onSound('WIPL_SE_BOARD_RELEASE', { pan: position[0] / 304 });
      emit();
      return true;
    },
    cancelPointer() {
      if (!drag) return false;
      drag = null;
      onSound('WIPL_SE_BOARD_DRAG', { loop: false });
      onSound('WIPL_SE_BOARD_RELEASE');
      return true;
    },
    keyInput(key, modifiers) {
      if (incoming) return incoming.keyInput(key, modifiers);
      if (modifiers?.type === 'blur') {
        api.releaseControl();
        api.hover(null);
        return false;
      }
      if (!reading()) return false;
      if (key === 'Escape') return api.back();
      if (key === 'ArrowUp' || key === 'ArrowDown')
        return api.activate(key === 'ArrowUp' ? 'memo-up' : 'memo-down');
      return false;
    },
    selectTextAt: (point) => incoming?.selectTextAt(point) ?? false,
    snapshot() {
      return {
        scene: 'board-memos',
        phase,
        frame,
        reading: reading(),
        locked: Boolean(drag) || Boolean(pageTransition) ||
          (dialog ? dialog.locked : locked()),
        selectedId: selected?.id ?? null,
        memoCount: visible().length,
        dayMemoCount: dayRecords.length,
        page,
        pageCount: pageCount(),
        pageTransition: pageTransition ? { ...pageTransition } : null,
        draggingMemo: Boolean(drag),
        draggedMemoId: drag?.id ?? null,
        dialog: dialog?.snapshot() ?? null,
        scroll,
        scrollLimit,
        lineCount,
        footerFrame: reading() ? footerFrame() : null,
        ...(incoming ? incoming.snapshot() : {}),
      };
    },
    presentation({ offsetX = 0, settled = false } = {}) {
      const items = visible(),
        order = [...items].sort((a, b) => cardOrder.indexOf(a.id) - cardOrder.indexOf(b.id));
      const renderAge = settled ? 100000 : age;
      const cardLayers = order
        .filter(
          (record) =>
            arrival.get(record.id) !== Infinity
              && !((erasePending || incoming?.snapshot().erasing) && record.id === selected?.id),
        )
        .map((record) => cardLayer(record, items.indexOf(record), offsetX,
          renderAge, { settled }));
      if (pageTransition) {
        const incomingPage = dayRecords.slice(
          pageTransition.target * MEMOS_PER_PAGE,
          (pageTransition.target + 1) * MEMOS_PER_PAGE,
        );
        for (const [index, record] of incomingPage.entries()) {
          if (arrival.get(record.id) === Infinity) continue;
          cardLayers.push(cardLayer(record, index, offsetX, renderAge,
            { settled: true, neutral: true, pageEntry: true }));
        }
      }
      const overlayLayers = [];
      let dialogView = null;
      if (incoming) overlayLayers.push(...incoming.presentation().layers);
      else if (reading()) {
        const suffix = ['close', 'erase-close', 'erase-wait'].includes(phase) ? 'MaskOut' : 'MaskIn';
        overlayLayers.push({
          layout: poseLayout(layouts[MASK], [
            clip(
              MASK,
              suffix,
              ['open', 'close', 'erase-close', 'erase-wait'].includes(phase) ? frame : duration(MASK, suffix),
            ),
          ]),
          prefix: 'memo-mask:',
        });
        if (!['close', 'erase-close', 'erase-wait'].includes(phase) || frame < duration(READER, 'ExitLetter'))
          overlayLayers.push(readerLayer());
        overlayLayers.push(footerLayer());
        if (dialog) {
          dialogView = dialog.presentation();
          overlayLayers.push(...dialogView.layers);
        }
      }
      return {
        ...api.snapshot(),
        cardLayers,
        overlayLayers,
        layers: [...cardLayers, ...overlayLayers],
        controls: controls(dialogView),
      };
    },
  };
  return api;
}
