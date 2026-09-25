import { indexLayout, poseLayout } from './animation.js';
import { createFocusAnimation } from './focus-animation.js';
import { isPrimaryKeyboardTrigger } from './keyboard-activation.js';
import { createBoardCreate, CREATE_LAYOUTS } from './board-create.js';
import { createBoardCalendar, CALENDAR_LAYOUTS } from './board-calendar.js';
import { createBoardMemos, MEMO_LAYOUTS } from './board-memos.js';
import { messageBadgePose } from './footer-controller.js';
import { createStorageScene, STORAGE_LAYOUTS } from './channel-management.js';
import { commonArrowDefinitions, createArrowInteraction, isArrowId } from './arrow-interaction.js';
import { validateLocalAttachment } from './message-service.js';

export const MENU_SCENE_LAYOUTS = [
  'it_BgSetUp_a',
  'it_Button_a',
  'it_ObjSetUp_a',
  'wiiMem/it_ObjCubeEdit_a',
  'it_ObjCubeEdit_a',
  'it_ObjDataEdit_a',
  'my_IplTop_c',
  'my_IplTop_e',
  'my_BbsMask_a',
  ...CREATE_LAYOUTS,
  ...CALENDAR_LAYOUTS,
  ...STORAGE_LAYOUTS,
  ...MEMO_LAYOUTS,
];
const BUTTONS = [
  {
    id: 'data',
    pane: 'B_DataManage_00',
    group: 'DataManage',
    stem: 'SetUp',
    label: 'Data Management',
    destination: 'data',
  },
  {
    id: 'system',
    pane: 'B_Setting_00',
    group: 'Setting',
    stem: 'SetUp',
    label: 'Wii Settings',
    destination: 'system-settings',
  },
  {
    id: 'save',
    pane: 'B_SaveData_00',
    group: 'SaveData',
    stem: 'DataChannel',
    label: 'Save Data',
    destination: 'save',
  },
  {
    id: 'channels',
    pane: 'B_Channel_00',
    group: 'Channel',
    stem: 'DataChannel',
    label: 'Channels',
    destination: 'channels',
  },
  {
    id: 'wii',
    pane: 'B_Wii_00',
    group: 'Wii',
    stem: 'SaveData',
    label: 'Wii',
    destination: 'wii',
  },
  {
    id: 'gamecube',
    pane: 'B_Cube_00',
    group: 'Cube',
    stem: 'SaveData',
    label: 'Nintendo GameCube',
    destination: 'gamecube',
  },
];
const LEVEL = { options: [0, 1], data: [2, 3], save: [4, 5] };
const LABELS = {
  T_Datamanage0_00: 'Data Management',
  T_DataManage_01: 'Data Management',
  T_Setting_00: 'Wii Settings',
  T_SaveData_00: 'Save Data',
  T_SaveData_01: 'Save Data',
  T_Channel_00: 'Channels',
  T_Channel_01: 'Channels',
  T_Wii_00: 'Wii',
  T_Wii_01: 'Wii',
  T_Cube_00: 'Nintendo\nGameCube',
  T_Cube_01: 'Nintendo\nGameCube',
  T_Button_00: 'Back',
};
const LABEL_IDS = {
  T_Datamanage0_00: 253,
  T_DataManage_01: 253,
  T_Setting_00: 316,
  T_SaveData_00: 254,
  T_SaveData_01: 254,
  T_Channel_00: 255,
  T_Channel_01: 255,
  T_Wii_00: 256,
  T_Wii_01: 256,
  T_Cube_00: 257,
  T_Cube_01: 257,
  T_Button_00: 315,
};
const labels = (layout, values) => {
  for (const pane of indexLayout(layout).panes.values())
    if (pane.type === 'txt1') pane.text = values[pane.name] ?? '';
  return layout;
};
const dayNumber = (date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

/** Original menu scene navigation with local storage and Message Board models.
 * Retained poses preserve hierarchy headings and footer continuity. */
export function createMenuScenes(
  layouts,
  {
    onNavigate = () => {},
    onAction = () => {},
    messages = {},
    display,
    draft = '',
    onDraft = () => {},
    contacts = [],
    onContacts = () => {},
    onContactsError = () => {},
    memos = [],
    onMemos = () => {},
    onSound = () => {},
    localRegistration = false,
    ownWiiNumber = null,
    letterService = 'offline',
    onLetter,
    onLetterError,
    onEraseLetter,
    onEraseMemo,
    onBoardError,
    onBoardReady = () => {},
    unavailablePhotoIds,
    unavailableThumbnailIds,
    measureTextLines,
    measureTextLayout,
    measureText,
    predict,
    getKeyboardPreferences,
    onKeyboardPreferencesChange,
    channels = [],
    sdChannels = [],
    storageFixture,
    storageTabs = {},
    onStorageTabChange = () => {},
  } = {},
) {
  const messageMap = messages.messages || messages;
  const boardArrows = createArrowInteraction(commonArrowDefinitions(layouts.my_IplTop_e));
  const boardPageIndicators = new Map();
  const localizedLabels = Object.fromEntries(
    Object.entries(LABELS).map(([name, text]) => [name, messageMap[LABEL_IDS[name]] ?? text]),
  );
  let scene = 'options',
    phase = null,
    age = 0,
    focus = null,
    selectedTab = 'wii',
    boardTransition = null;
  let boardReadyNotified = false;
  let bases = {},
    history = [];
  let boardChild = null,
    boardDate = null,
    currentDate = new Date(),
    boardMask = null,
    maskAge = 0;
  let boardScroll = null,
    storage = null,
    memoDraft = draft,
    memoReturnLayers = [];
  const boardArrowAtLimit = (id, value = boardDate || currentDate) =>
    memoBoard.canTurnPage(id) ? false : id === 'prev'
      ? value.getFullYear() === 2000 && value.getMonth() === 0 && value.getDate() === 1
      : value.getFullYear() === 2035 && value.getMonth() === 11 && value.getDate() === 31;
  const memoBoard = createBoardMemos(layouts, {
    memos,
    messages,
    display,
    measureTextLines,
    onSound,
    letterService, onLetter, onLetterError, onEraseLetter, onEraseMemo, onBoardError,
    onAction, unavailablePhotoIds, unavailableThumbnailIds,
    measureTextLayout, measureText, predict,
    getKeyboardPreferences, onKeyboardPreferencesChange,
    onMemos: (value) => {
      memos = value;
      boardChild?.setMemos?.(value);
      onMemos(value);
    },
  });
  // Persist sampled native positions once, including legacy browser records.
  const normalizedMemos = memoBoard.records();
  if (JSON.stringify(normalizedMemos) !== JSON.stringify(memos)) {
    memos = normalizedMemos;
    onMemos(memos);
  }
  const source = (key) => layouts[key];
  const make = (key, name, group, offset = 0, end) => ({
    key,
    animation: source(key)?.animations[name],
    group,
    offset,
    end,
  });
  const option = (button, suffix, extra = false) =>
    make(
      'it_ObjSetUp_a',
      `it_ObjSetUp_a_${button.stem}${suffix}`,
      `G_${button.group}_${extra ? '01' : '00'}`,
    );
  const backClip = (name, group) => make('it_Button_a', `it_Button_a_${name}`, group);
  const duration = (clips) =>
    Math.max(0, ...clips.map((item) => (item.end ?? item.animation?.frames ?? 0) - item.offset));
  // Native Animator uses GetFrameSize()-1 for non-loop resources. Its parent
  // scene observes completion on the following update, retained by duration().
  const at = (item, frame) => ({
    animation: item.animation,
    group: item.group,
    frame: Math.min(
      item.end ?? Math.max(0, (item.animation?.frames ?? 0) - (item.animation?.loop ? 0 : 1)),
      item.offset + frame,
    ),
    loop: false,
  });
  const commit = (clips, frame) => {
    for (const key of new Set(clips.map((item) => item.key)))
      if (bases[key])
        bases[key] = poseLayout(
          bases[key],
          clips.filter((item) => item.key === key).map((item) => at(item, frame)),
        );
  };
  const start = (clips, done, frames = duration(clips)) => {
    focus = null;
    focusAnimations.reset();
    phase = { clips, frame: 0, frames, done };
  };
  const enterButtons = () =>
    start(
      LEVEL[scene].map((index) => option(BUTTONS[index], 'In')),
      () => {},
    );
  const reset = () => {
    boardArrows.reset();
    bases = Object.fromEntries(
      MENU_SCENE_LAYOUTS.filter((key) => source(key)).map((key) => [key, poseLayout(source(key))]),
    );
    commit(
      BUTTONS.map((button) => option(button, 'In')),
      0,
    );
    commit(
      [
        backClip('SeenIn', 'G_BarIn'),
        backClip('AlphOut', 'G_FocusBtnA'),
        backClip('WiiLost', 'G_Wii'),
      ],
      0,
    );
    focus = null;
    focusAnimations.reset();
    history = [];
    selectedTab = 'wii';
    age = 0;
    boardTransition = null;
    boardReadyNotified = false;
    boardChild?.dispose?.();
    boardChild = null;
    boardDate = null;
    boardMask = null;
    maskAge = 0;
    boardScroll = null;
    boardPageIndicators.clear();
    storage = null;
    memoReturnLayers = [];
    memoBoard.setDate(currentDate);
    memoBoard.setMemos(memos, { settled: true });
    memoReturnLayers = memoBoard.presentation({ settled: true }).cardLayers;
    commit([make('my_IplTop_c', 'my_IplTop_c', undefined, 0, 0)], 0);
  };
  const finishBoardChild = () => {
    boardChild?.dispose?.();
    boardChild = null;
    memoBoard.revealPendingMemos();
    boardMask = 'out';
    // The mask clock also poses the Board arrows' original inward return.
    maskAge = 0;
    focus = null;
    focusAnimations.reset();
    // Child button queues arrive at the same original board footer pose.
    commit([make('my_IplTop_e', 'my_IplTop_e', 'G_SeenChange', 1040, 1040)], 0);
  };
  const leaveStorage = () => {
    storage = null;
    const previous = history.pop();
    scene = previous.scene;
    start([option(previous.button, 'Back'), option(previous.sibling, 'In')], () => {});
  };
  const enterMemory = () => {
    storage = createStorageScene(layouts, {
      kind: scene,
      channels,
      sdChannels,
      storageFixture,
      initialTab: storageTabs[scene] ?? 'wii',
      onTabChange: (tab) => {
        storageTabs = { ...storageTabs, [scene]: tab };
        onStorageTabChange(scene, tab);
      },
      display,
      messages,
      measureText,
      onSound,
      onBack: leaveStorage,
      onAction,
    });
  };
  const controls = (memoView = null) => {
    if (storage) return storage.presentation().controls;
    const result = [];
    if (LEVEL[scene])
      for (const index of LEVEL[scene])
        result.push({ ...BUTTONS[index], prefix: 'scene-options:' });
    else if (['wii', 'gamecube', 'channels'].includes(scene)) {
      result.push(
        {
          id: 'storage-wii',
          pane: 'B_SelectWii_00',
          prefix: 'scene-storage:',
          label: scene === 'gamecube' ? 'Slot A' : 'Wii',
        },
        {
          id: 'storage-sd',
          pane: 'B_SelectSd_00',
          prefix: 'scene-storage:',
          label: scene === 'gamecube' ? 'Slot B' : 'SD Card',
        },
      );
    } else if (scene === 'board') {
      const memoState = memoView ?? memoBoard.snapshot();
      const memoControls = memoView?.controls ?? memoBoard.controls();
      if (memoState.reading || memoState.draggingMemo) return memoControls;
      return [
        ...memoControls,
        {
          id: 'back',
          pane: 'B_Ch',
          prefix: 'scene-board-buttons:',
          label: 'Wii Menu',
        },
        {
          id: 'calendar',
          pane: 'B_Cal',
          prefix: 'scene-board-buttons:',
          label: 'Calendar',
        },
        {
          id: 'create',
          pane: 'B_Add',
          prefix: 'scene-board-buttons:',
          label: 'Create Message',
        },
        {
          id: 'prev',
          pane: 'B_ArwL',
          prefix: 'scene-board-buttons:',
          label: memoBoard.canTurnPage('prev') ? 'Older messages' : 'Previous day',
          disabled: boardArrowAtLimit('prev'),
        },
        {
          id: 'next',
          pane: 'B_ArwR',
          prefix: 'scene-board-buttons:',
          label: memoBoard.canTurnPage('next') ? 'Newer messages' : 'Next day',
          disabled: boardArrowAtLimit('next'),
        },
      ];
    }
    if (scene !== 'system-settings' && scene !== 'closed')
      result.push({
        id: 'back',
        pane: 'B_Button_00',
        prefix: 'scene-back:',
        label: 'Back',
      });
    return result;
  };
  const hoverClips = (id, entering) => {
    const button = BUTTONS.find((button) => button.id === id);
    if (button) return [option(button, `Foucus${entering ? 'In' : 'Out'}`)];
    if (scene === 'board') {
      const values = {
        back: ['G_Ch', 5900, 5930, 6, 8],
        calendar: ['G_Cal', 1900, 1930, 6, 8],
        create: ['G_Add', 3900, 3930, 6, 8],
      }[id];
      if (!values) return [];
      return [
        make(
          'my_IplTop_e',
          'my_IplTop_e',
          values[0],
          values[entering ? 1 : 2],
          values[entering ? 1 : 2] + values[entering ? 3 : 4],
        ),
      ];
    }
    if (id === 'back') return [backClip(`BtnFoucus${entering ? 'In' : 'Out'}`, 'G_FocusBtnA')];
    return [];
  };
  const focusAnimations = createFocusAnimation(hoverClips, duration);
  const neutralBoardFocus = () => {
    boardArrows.reset();
    commit(
      ['back', 'calendar', 'create', 'prev', 'next'].flatMap((id) => hoverClips(id, false)),
      15,
    );
    focus = null;
    focusAnimations.reset();
  };
  const api = {
    suspendAudio() {
      memoBoard.suspendAudio();
    },
    open(next = 'options', date) {
      if (!['options', 'board'].includes(next)) throw new RangeError('Unknown scene entry point');
      if (date !== undefined &&
          (!(date instanceof Date) || Number.isNaN(date.getTime()))) {
        throw new RangeError('Menu scene date must be valid.');
      }
      if (date !== undefined) currentDate = new Date(date.getTime());
      reset();
      scene = next;
      if (scene === 'options') start([backClip('SeenIn', 'G_BarIn')], enterButtons);
      else {
        boardTransition = 'enter';
        boardReadyNotified = false;
        start([make('my_IplTop_e', 'my_IplTop_e', 'G_SeenChange', 1000, 1040)], () => {
          boardTransition = null;
        });
      }
      return true;
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0)
        throw new RangeError('Frames must be nonnegative');
      age += frames;
      boardArrows.advance(frames);
      focusAnimations.advance(frames);
      maskAge += frames;
      if (scene === 'board') memoBoard.advance(frames);
      if (boardChild) {
        boardChild.advance(frames);
        return;
      }
      if (storage) {
        storage.advance(frames);
        return;
      }
      let remaining = frames;
      while (phase && remaining >= 0) {
        // ChannelSelect retires after its 70→90 grid animation, independently
        // of the footer's forty-frame transition. Board then owns the footer
        // and stops its new-arrival timer (0x813AD980, 0x813907A0).
        const notifyBoardReady = boardTransition === 'enter' && !boardReadyNotified;
        const boundary = notifyBoardReady ? Math.min(20, phase.frames) : phase.frames;
        const amount = Math.min(remaining, boundary - phase.frame);
        phase.frame += amount;
        remaining -= amount;
        if (notifyBoardReady && phase.frame >= 20) {
          boardReadyNotified = true;
          onBoardReady();
        }
        if (phase.frame < phase.frames) {
          if (notifyBoardReady && boardReadyNotified && remaining > 0) continue;
          break;
        }
        const completed = phase;
        commit(completed.clips, completed.frames);
        phase = null;
        completed.done?.();
        if (storage) {
          if (remaining) storage.advance(remaining);
          break;
        }
        if (!remaining && (!phase || phase.frames > 0)) break;
      }
    },
    hover(id) {
      if (boardChild) return boardChild.hover(id);
      if (storage) return storage.hover(id);
      if (scene === 'board' && memoBoard.snapshot().draggingMemo) return false;
      if (scene === 'board' && boardScroll) {
        return boardArrows.hover(
          isArrowId(id) && !boardArrowAtLimit(id, boardScroll.to) ? id : null,
        );
      }
      if (scene === 'board' && !phase) {
        if (id?.startsWith('memo-') || memoBoard.snapshot().reading) {
          neutralBoardFocus();
          return memoBoard.hover(id);
        }
        memoBoard.hover(null);
      }
      if (phase || focus === id || (id && !controls().some((control) => control.id === id)))
        return false;
      if (scene === 'board') boardArrows.hover(isArrowId(id) && !boardArrowAtLimit(id) ? id : null);
      focusAnimations.hover(id);
      focus = id;
      return true;
    },
    activate(id, triggers) {
      if (boardChild) {
        if (!isPrimaryKeyboardTrigger(triggers) && boardChild.snapshot().scene !== 'create')
          return false;
        return boardChild.activate(id, triggers);
      }
      if (!isPrimaryKeyboardTrigger(triggers)) {
        if (scene === 'board' && !phase && memoBoard.snapshot().reading)
          return memoBoard.activate(id, triggers);
        return false;
      }
      if (storage) return storage.activate(id);
      if (scene === 'board' && memoBoard.snapshot().draggingMemo) return false;
      if (scene === 'board' && !phase &&
          (id.startsWith('memo-') || memoBoard.snapshot().reading)) {
        neutralBoardFocus();
        return memoBoard.activate(id, triggers);
      }
      if (phase || (scene === 'board' && memoBoard.snapshot().pageTransition) ||
          !controls().some((control) => control.id === id && !control.disabled)) return false;
      if (id === 'back') return api.back();
      if (scene === 'board') {
        if (id === 'prev' || id === 'next') {
          if (memoBoard.canTurnPage(id)) {
            boardArrows.press(id);
            return memoBoard.turnPage(id);
          }
          const from = boardDate || currentDate;
          const to = new Date(
            from.getFullYear(),
            from.getMonth(),
            from.getDate() + (id === 'next' ? 1 : -1),
            12,
          );
          if (to.getFullYear() < 2000 || to.getFullYear() > 2035) return false;
          // Both pointer and remote date arrows call this cue in the original
          // Board (0x813935D4 / 0x81390ADC), without an extra confirm sound.
          onSound('WSD_SELECT');
          boardScroll = { from, to, direction: id };
          boardArrows.press(id);
          if (boardArrows.hovered && boardArrowAtLimit(boardArrows.hovered, to))
            boardArrows.hover(null);
          start(
            [
              make(
                'my_IplTop_c',
                'my_IplTop_c',
                undefined,
                id === 'next' ? 30 : 0,
                id === 'next' ? 50 : 20,
              ),
            ],
            () => {
              boardDate = to;
              boardScroll = null;
              commit([make('my_IplTop_c', 'my_IplTop_c', undefined, 0, 0)], 0);
            },
            20,
          );
          return true;
        }
        neutralBoardFocus();
        if (id === 'create')
          boardChild = createBoardCreate(layouts, {
            messages,
            attachments: memos.flatMap((record) => {
              if (!record?.photo) return [];
              try {
                const photo = validateLocalAttachment(record.photo);
                return photo ? [photo] : [];
              } catch {
                return [];
              }
            }),
            onBack: finishBoardChild,
            draft: memoDraft,
            onDraft: (value) => {
              memoDraft = value;
              onDraft(value);
            },
            contacts,
            localRegistration,
            ownWiiNumber,
            letterService,
            onLetter,
            onLetterError,
            measureTextLines,
            measureTextLayout,
            measureText,
            predict,
            getKeyboardPreferences,
            onKeyboardPreferencesChange,
            display,
            onSound,
            onContacts: (value) => {
              const result = onContacts(value);
              if (result && typeof result.then === 'function') {
                return result.then(() => { contacts = structuredClone(value); });
              }
              contacts = structuredClone(value);
              return result;
            },
            onContactsError,
            onAction: (action, payload) => {
              if (action !== 'post-memo') {
                onAction(action, payload);
                return;
              }
              const record = {
                id: globalThis.crypto?.randomUUID?.() ?? `memo-${Date.now()}-${memos.length}`,
                text: payload.text,
                createdAt: currentDate.toISOString(),
              };
              // Native Memo posts to the actual current day, regardless of the
              // date that was selected when Create was opened.
              boardDate = new Date(record.createdAt);
              memoBoard.setDate(boardDate);
              memoBoard.addMemo(record, { deferAppearance: true });
            },
          });
        else if (id === 'calendar') {
          boardChild = createBoardCalendar(layouts, {
            memos,
            messages,
            display,
            onBack: finishBoardChild,
            onSelectDate: (date) => {
              boardDate = date;
            },
            onSound,
          });
          boardChild.open(boardDate || currentDate);
        } else {
          onAction(id);
          return true;
        }
        // Board's shared child transition, 0x81392E94, owns this sound for
        // Create, Calendar, and the return to ChannelSelect.
        onSound('WIPL_SE_DECIDE');
        boardMask = 'in';
        maskAge = 0;
        focus = null;
        focusAnimations.reset();
        return true;
      }
      for (const { clip, frame } of focusAnimations.samples()) commit([clip], frame);
      const button = BUTTONS.find((button) => button.id === id),
        sibling = BUTTONS[LEVEL[scene].find((index) => BUTTONS[index] !== button)];
      history.push({ scene, button, sibling });
      start(
        [
          option(button, 'FoucusFlash'),
          option(button, 'FoucusFlash', true),
          option(sibling, 'Out'),
        ],
        () => {
          scene = button.destination;
          if (LEVEL[scene]) enterButtons();
          else if (scene === 'system-settings') onNavigate(scene);
          else enterMemory();
        },
      );
      return true;
    },
    back() {
      if (scene === 'board' && memoBoard.snapshot().pageTransition) return false;
      if (boardChild) return boardChild.back();
      if (storage) return storage.back();
      if (scene === 'board' && memoBoard.snapshot().reading) return memoBoard.back();
      if (memoBoard.snapshot().draggingMemo) return memoBoard.cancelPointer();
      if (phase || scene === 'closed') return false;
      if (scene === 'board') {
        const selectedDate = boardDate || currentDate;
        const selectedDay = dayNumber(selectedDate);
        const today = dayNumber(currentDate);
        let returnDirection = null;
        if (selectedDay > today) returnDirection = 'prev';
        else if (selectedDay < today) returnDirection = 'next';
        boardScroll = returnDirection ? {
          from: new Date(selectedDate.getTime()),
          to: new Date(currentDate.getTime()),
          direction: returnDirection,
          returning: true,
        } : null;
        onSound('WIPL_SE_DECIDE');
        neutralBoardFocus();
        boardTransition = 'exit';
        const dateFrame = returnDirection === 'next' ? 30 : 0;
        const dateClip = boardScroll
          ? [make('my_IplTop_c', 'my_IplTop_c', undefined, dateFrame, dateFrame + 20)]
          : [];
        start([
          ...dateClip,
          make('my_IplTop_e', 'my_IplTop_e', 'G_SeenChange', 6000, 6040),
        ], () => {
          // The Board slides its selected day's cards away. The Home underlay
          // resumes with today's records when the grid takes ownership.
          memoBoard.setDate(currentDate);
          memoReturnLayers = memoBoard.presentation({ settled: true }).cardLayers;
          scene = 'closed';
          boardTransition = null;
          boardScroll = null;
          boardDate = null;
          onNavigate('grid');
        });
        return true;
      }
      const leave = () => {
        const previous = history.pop();
        if (!previous) {
          // The root fader owns the handoff. Keep the outgoing Options layout
          // visible underneath black until it replaces the scene with the grid.
          start([], undefined, Infinity);
          onNavigate('grid');
          return;
        }
        const clips = [];
        if (LEVEL[scene]) clips.push(...LEVEL[scene].map((index) => option(BUTTONS[index], 'Out')));
        scene = previous.scene;
        clips.push(option(previous.button, 'Back'), option(previous.sibling, 'In'));
        start(clips, () => {});
      };
      if (scene === 'system-settings') leave();
      else
        start([backClip('BtnFlash', 'G_SelectBtnA')], () => {
          leave();
        });
      return true;
    },
    messageSummary: (date = currentDate) => memoBoard.summary(date),
    getMemos: () => memoBoard.records(),
    memoReturnLayers: () => memoReturnLayers,
    refreshMemoReturnLayers(value = currentDate) {
      currentDate = value;
      memoBoard.setDate(value);
      memoReturnLayers = memoBoard.presentation({ settled: true }).cardLayers;
    },
    setMemos(value) {
      memoReturnLayers = [];
      memoBoard.setMemos(value, { settled: true });
      memos = memoBoard.records();
      boardChild?.setMemos?.(memos);
      if (scene !== 'board')
        memoReturnLayers = memoBoard.presentation({ settled: true }).cardLayers;
    },
    pointerDown(id, point) {
      if (scene !== 'board' || phase || boardChild) return false;
      neutralBoardFocus();
      return memoBoard.pointerDown(id, point);
    },
    pointerMove: (point) => memoBoard.pointerMove(point),
    pointerUp: (point) => memoBoard.pointerUp(point),
    cancelPointer: () => memoBoard.cancelPointer(),
    selectTextAt: (point) => boardChild?.selectTextAt?.(point) ??
      (scene === 'board' && !phase ? memoBoard.selectTextAt(point) : false),
    holdControl(id) {
      if (boardChild) return boardChild.holdControl?.(id) ?? false;
      return scene === 'board' && !phase ? memoBoard.holdControl?.(id) ?? false : false;
    },
    releaseControl() {
      boardChild?.releaseControl?.();
      memoBoard.releaseControl?.();
    },
    keyInput(key, modifiers) {
      return (
        boardChild?.keyInput?.(key, modifiers) ??
        (scene === 'board' && (memoBoard.snapshot().composing || modifiers?.type !== 'keyup')
          ? memoBoard.keyInput(key, modifiers) : false)
      );
    },
    snapshot() {
      const boardChildState = boardChild?.snapshot();
      const storageState = storage?.snapshot();
      const memoState = scene === 'board' ? memoBoard.snapshot() : null;
      const child =
        boardChildState ||
        storageState ||
        (memoState && (memoState.reading || memoState.draggingMemo)
          ? memoState
          : null);
      return {
        scene,
        editing: Boolean(child?.editing),
        locked: child?.locked ?? (Boolean(phase) ||
          Boolean(memoState?.pageTransition)),
        frame: phase?.frame ?? 0,
        duration: phase?.frames ?? 0,
        selectedTab: child?.selectedTab ?? selectedTab,
        storagePage: storageState?.page ?? null,
        readingMemo: memoState?.reading ?? false,
        draggingMemo: memoState?.draggingMemo ?? false,
        draggedMemoId: memoState?.draggedMemoId ?? null,
        memoCount: memoState?.memoCount ?? 0,
        messagePage: memoState?.page ?? 0,
        messagePageCount: memoState?.pageCount ?? 1,
        depth: history.length,
        boardChild: boardChildState?.scene ?? null,
        childPage: child?.page ?? null,
        transition: boardTransition,
        gridFrame: boardTransition
          ? (boardTransition === 'enter' ? 70 : 100) + Math.min(20, phase?.frame ?? 0)
          : null,
        drawGridUntil: boardTransition === 'enter' ? 20 : boardTransition === 'exit' ? 40 : 0,
      };
    },
    presentation(options = {}) {
      let date = options instanceof Date ? options : options?.date ?? currentDate;
      currentDate = date;
      const working = (key) =>
        poseLayout(bases[key], [
          ...(phase?.clips || [])
            .filter((item) => item.key === key)
            .map((item) => at(item, phase.frame)),
          ...focusAnimations.samples()
            .filter(({ clip }) => clip.key === key)
            .map(({ clip, frame }) => at(clip, frame)),
        ]);
      let layers = [];
      let childView = null;
      let memoView = null;
      if (scene === 'board') {
        date = boardScroll?.from || boardDate || date;
        const dateText = (date) => {
          const weekday =
            messageMap[[116, 110, 111, 112, 113, 114, 115][date.getDay()]] ??
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
          return `${weekday} ${date.getMonth() + 1}/${date.getDate()}`;
        };
        const adjacent = (offset) => {
          if (boardScroll?.returning &&
              offset === (boardScroll.direction === 'prev' ? -1 : 1))
            return boardScroll.to;
          return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12);
        };
        const boardLayout = working('my_IplTop_c');
        layers = [
          {
            layout: labels(boardLayout, {
              T_Day_a: dateText(adjacent(-1)),
              T_Day_b: dateText(date),
              T_Day_c: dateText(adjacent(1)),
            }),
            prefix: 'scene-board:',
          },
        ];
        memoBoard.setDate(date);
        const offsetX = boardScroll
          ? indexLayout(boardLayout).panes.get('N_TopBack').translation[0] *
            (display?.rootScaleX ?? 1)
          : 0;
        memoView = memoBoard.presentation({ offsetX });
        layers.push(...memoView.cardLayers);
        if (boardScroll) {
          const pageWidth = 608 * (display?.rootScaleX ?? 1);
          const incomingOffset = offsetX +
            (boardScroll.direction === 'prev' ? -pageWidth : pageWidth);
          layers.push(...memoBoard.settledCardsForDate(boardScroll.to, {
            offsetX: incomingOffset,
          }));
        }
        // Main places the ChannelSelect overlay after these native Board layers.
        layers.at(-1).gridOverlayAfter = true;
        if (boardMask) {
          const animation =
            source('my_BbsMask_a').animations[
              `my_BbsMask_a_Mask${boardMask === 'in' ? 'In' : 'Out'}`
            ];
          layers.push({
            layout: poseLayout(source('my_BbsMask_a'), [
              {
                animation,
                frame: Math.min(maskAge, animation.frames - 1),
                loop: false,
              },
            ]),
            prefix: 'scene-board-mask:',
          });
        }
        childView = boardChild?.presentation();
        if (childView) layers.push(...childView.layers);
        else if (memoView.reading) {
          childView = memoView;
          layers.push(...memoView.overlayLayers);
        } else {
          const footer = poseLayout(working('my_IplTop_e'), [
            at(make('my_IplTop_e', 'my_IplTop_e', 'G_ArwRoop', 10000, 10055), age % 55),
            ...['L', 'R'].map((side) => {
              const id = side === 'L' ? 'prev' : 'next';
              const hidden = boardArrowAtLimit(id, boardScroll?.to);
              const exiting = boardTransition === 'exit';
              const offset = exiting || hidden ? 10100 : 10150;
              let frame = 10;
              if (exiting) frame = phase?.frame || 0;
              else if (boardTransition === 'enter')
                frame = hidden ? 10 : Math.max(0, (phase?.frame || 0) - 30);
              else if (boardScroll && boardArrowAtLimit(id, boardScroll.from) !== hidden)
                frame = phase?.frame || 0;
              else if (boardMask === 'out')
                frame = maskAge;
              return at(
                make('my_IplTop_e', 'my_IplTop_e', `G_Arw${side}_End`, offset, offset + 10),
                frame,
              );
            }),
            ...boardArrows.clips(),
            ...['L', 'R'].map((side) => {
              const enabled = !boardTransition && memoBoard.canTurnPage(side === 'L' ? 'prev' : 'next');
              let indicator = boardPageIndicators.get(side);
              if (!indicator || indicator.enabled !== enabled) {
                indicator = { enabled, startedAt: !indicator && !enabled ? age - 10 : age };
                boardPageIndicators.set(side, indicator);
              }
              return at(
                make('my_IplTop_e', 'my_IplTop_e', `G_Taba${side}`,
                  enabled ? 0 : 30, enabled ? 10 : 40),
                age - indicator.startedAt,
              );
            }),
            ...(options.gridArrowClips ?? []),
          ]);
          const badge = messageBadgePose(labels(footer, {}), {
            count: memoBoard.summary(currentDate).count,
            age,
          });
          layers.push({ layout: badge, prefix: 'scene-board-buttons:' });
        }
      } else if (scene !== 'closed') {
        layers.push({ layout: working('it_BgSetUp_a'), prefix: 'scene-bg:' });
        if (LEVEL[scene])
          layers.push({
            layout: labels(working('it_ObjSetUp_a'), localizedLabels),
            prefix: 'scene-options:',
          });
        else {
          // SettingSelect::draw remains active while a storage child is open.
          // Its completed Flash poses contain the selected hierarchy headings.
          layers.push({
            layout: labels(working('it_ObjSetUp_a'), localizedLabels),
            prefix: 'scene-options:',
          });
          childView = storage?.presentation();
          if (childView) {
            const back = childView.layers.find((layer) => layer.prefix === 'storage-back:');
            if (back) layers.splice(1, 0, back);
            layers.push(...childView.layers.filter((layer) => layer !== back));
          }
        }
        if (!storage)
          layers.splice(1, 0, {
            layout: labels(working('it_Button_a'), localizedLabels),
            prefix: 'scene-back:',
          });
      }
      const state = api.snapshot();
      return {
        ...state,
        layers,
        controls:
          childView?.controls ??
          controls(memoView).map((control) => ({
            ...control,
            disabled: Boolean(phase) || Boolean(control.disabled) ||
              Boolean(memoView?.pageTransition),
          })),
      };
    },
  };
  api.open('options');
  return api;
}
