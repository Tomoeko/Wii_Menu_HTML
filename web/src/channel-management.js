import { indexLayout, poseLayout, sampleTrack } from './animation.js';
import { createFocusAnimation } from './focus-animation.js';
import { poseStorageThumbnail } from './storage-thumbnail.js';
import { sourceAnchorMatrices } from './channel-zoom.js';
import { paneForDisplay, standardDisplay } from './display.js';
import { defaultStorageFixture, validateStorageFixture, mediaErrorMessage } from './storage-state.js';

const DETAIL = '081210_sys4_mn_DataDetail_a';
const CHANNEL_DETAIL = 'mn_ChannelDetail_a';
const DIALOG = 'my_DialogWindow_b';
const BALLOON = 'balloon/my_IplTopBalloon_a';
// Storage page arrows use the same twenty-update interaction budget as the
// Home Menu page arrows. The source exit/re-entry clips remain intact; their
// playback is rate-scaled rather than truncated.
export const STORAGE_PAGE_TRANSITION_UPDATES = 20;
export const STORAGE_LAYOUTS = [
  'it_ObjChannelEdit_a',
  'it_ObjChannelEdit_b',
  'wiiMem/it_ObjCubeEdit_a',
  'wiiMem/it_ObjDataEdit_b',
  'it_ObjCubeEdit_a',
  'it_ObjCubeEdit_b',
  DETAIL,
  CHANNEL_DETAIL,
  DIALOG,
  BALLOON,
  'it_Button_a',
];
const putText = (layout, values) => {
  for (const pane of indexLayout(layout).panes.values())
    if (pane.type === 'txt1') pane.text = values[pane.name] ?? '';
  return layout;
};
const visible = (layout, name, value) => {
  const pane = indexLayout(layout).panes.get(name);
  if (pane) pane.flags = value ? pane.flags | 1 : pane.flags & ~1;
};

/** NandSDWorker::is_user_nand_app, USA 4.3 0x81349294–0x81349338. */
export function isManageableChannel(channel) {
  if (!channel?.icon || channel.id === 'disc') return false;
  // Authored/local fixture identities do not represent a native title category.
  if (!/^[0-9a-f]{16}$/i.test(channel.id)) return true;
  const category = Number.parseInt(channel.id.slice(0, 8), 16) - 0x10000;
  if (category < 0 || category > 7 || !(0xd3 & (1 << category))) return false;
  const firstCharacter = Number.parseInt(channel.id.slice(8, 10), 16);
  return (firstCharacter >= 0x41 && firstCharacter <= 0x5a)
    || (firstCharacter >= 0x30 && firstCharacter <= 0x39)
    || firstCharacter < 0x20 || firstCharacter > 0x7e;
}

function channelCover(box, name) {
  const cover = poseLayout(box);
  for (const pane of indexLayout(cover).panes.values()) {
    if (pane.material !== undefined) pane.flags &= ~1;
  }
  visible(cover, name, true);
  return cover;
}

function channelArrowOverlay(base) {
  const overlay = poseLayout(base);
  const retainArrows = (pane) => {
    if (pane.name === 'N_ArwR' || pane.name === 'N_ArwL') return true;
    pane.children = (pane.children ?? []).filter(retainArrows);
    return pane.children.length > 0;
  };
  retainArrows(overlay.root);
  return overlay;
}

function channelDetailMask(detail, name) {
  const mask = poseLayout(detail);
  const retainBranch = (pane) => {
    if (pane.name === name) return true;
    pane.children = (pane.children ?? []).filter(retainBranch);
    return pane.children.length > 0;
  };
  retainBranch(mask.root);
  return mask;
}

/** The original Memory / ChannelEdit presentation with a local demonstration save.
 * Storage managers and actual file operations are deliberately replaced; BRLYT,
 * BRLAN, pane bindings and the staged entry/dialog controller remain authored.
 */
export function createStorageScene(
  layouts,
  {
    kind = 'wii',
    display = standardDisplay,
    messages = {},
    language = 'ENG',
    virtualBlocks = 905,
    channels = [],
    sdChannels = [],
    storageFixture = defaultStorageFixture(),
    initialTab = 'wii',
    onTabChange = () => {},
    onBack = () => {},
    onAction = () => {},
    onSound = () => {},
    measureText = (value) => value.length * 10,
  } = {},
) {
  const strings = messages.messages || messages;
  const fixture = validateStorageFixture(storageFixture);
  if (!['wii', 'sd'].includes(initialTab)) throw new Error('Invalid initial storage tab.');
  const baseKey =
    kind === 'channels'
      ? 'it_ObjChannelEdit_a'
      : kind === 'gamecube'
        ? 'it_ObjCubeEdit_a'
        : 'wiiMem/it_ObjCubeEdit_a';
  const boxKey =
    kind === 'channels'
      ? 'it_ObjChannelEdit_b'
      : kind === 'gamecube'
        ? 'it_ObjCubeEdit_b'
        : 'wiiMem/it_ObjDataEdit_b';
  const baseStem = layouts[baseKey].name;
  // Wii's Memory scene intentionally binds CubeEdit BRLAN to DataEdit BRLYT.
  const boxStem = kind === 'channels' ? 'it_ObjChannelEdit_b' : 'it_ObjCubeEdit_b';
  const keys = {
    base: baseKey,
    box: boxKey,
    ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`slot${index}`, boxKey])),
    detail: kind === 'channels' ? CHANNEL_DETAIL : DETAIL,
    dialog: DIALOG,
    back: 'it_Button_a',
  };
  let bases,
    phase,
    focus,
    selectedTab = initialTab;
  let page = 'grid',
    boxShown = false,
    action = null,
    detailOrigin = [0, 0, 0];
  let channelPage = 0;
  let channelAge = 0;
  let detailRecord = null;
  let detailAge = 0;
  let backCaption = 315;
  const backCaptionChanges = [];
  let backFade = null;
  let balloonSlot = 0;
  const storageChannels = Object.fromEntries(
    Object.entries({ wii: channels, sd: sdChannels }).map(([tab, records]) => [
      tab,
      records.filter(isManageableChannel),
    ]),
  );
  // The native worker preserves ES title enumeration, independently of HOME
  // Menu placement. The reference Dolphin NAND enumerates installed title IDs
  // in ascending order. Authored local channels follow those imported titles.
  storageChannels.wii.sort((first, second) => {
    const firstNative = /^[0-9a-f]{16}$/i.test(first.id);
    const secondNative = /^[0-9a-f]{16}$/i.test(second.id);
    if (firstNative !== secondNative) return firstNative ? -1 : 1;
    if (!firstNative) return 0;
    return first.id.toLowerCase().localeCompare(second.id.toLowerCase());
  });
  const channelRecords = () => storageChannels[selectedTab];
  const medium = () => {
    if (kind === 'gamecube') return fixture.gamecube[selectedTab === 'wii' ? 'a' : 'b'];
    if (kind === 'channels') return selectedTab === 'sd' ? fixture.sd : { status: 'ready' };
    return selectedTab === 'sd' ? fixture.sdSaves : fixture.wiiSaves;
  };
  const records = () => medium().status === 'ready'
    ? kind === 'channels' ? channelRecords() : medium().records
    : [];
  const recordAt = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= 15) return null;
    return records()[channelPage * 15 + index] ?? null;
  };
  let balloonFrame = 0;
  let balloonWait = 0;
  const slotIndex = (id) => {
    if (id === 'storage-save') return 0;
    const match = /^storage-(?:block|channel|save)-(\d+)$/.exec(id ?? '');
    return match ? Number(match[1]) : null;
  };
  const dummyAvailable = () => kind === 'wii' && selectedTab === 'wii'
    && recordAt(0)?.id === 'dummy-save';
  const clip = (target, suffix, group, reverse = false) => {
    const stem =
      target === 'base'
        ? baseStem
        : target === 'box' || target.startsWith('slot')
          ? boxStem
          : keys[target];
    let animation = layouts[keys[target]].animations[`${stem}_${suffix}`];
    if (target === 'base' && suffix === 'SelectIn' && initialTab === 'sd') {
      // SelectIn contains a hard-coded Wii selection. For a restored local tab,
      // retain its parent entry motion and use the source switch endpoint only
      // on the six selection children. Do not reveal the parent early.
      const selection = layouts[baseKey].animations[`${baseStem}_SelectWiiFlash`];
      const selected = new Map(selection.targets.filter((item) =>
        /^N_Select(?:Wii|Sd)(?:_00|Anim|Next)$/.test(item.name))
        .map((item) => [item.name, item]));
      animation = { ...animation, targets: animation.targets.map((item) => {
        const endpoint = selected.get(item.name);
        return endpoint ? { ...endpoint, tracks: endpoint.tracks.map((track) => ({
          ...track, keys: [{ frame: 0, value: sampleTrack(track, selection.frames - 1) }],
        })) } : item;
      }) };
    }
    if (!animation) throw new Error(`Missing ${stem}_${suffix}`);
    return { target, animation, group, reverse };
  };
  const sample = (item, frame) => ({
    animation: item.animation,
    group: item.group,
    loop: false,
    frame: item.reverse
      ? Math.max(0, item.animation.frames - 1 - frame)
      : Math.min(frame, item.animation.frames - 1),
  });
  const pose = (
    target,
    clips = phase?.clips || [],
    frame = phase?.frame || 0,
    base = bases[target],
  ) =>
    poseLayout(
      base,
      clips
        .filter(
          (item) => item.target === target || (target.startsWith('slot') && item.target === 'box'),
        )
        .map((item) => sample(item, frame)),
    );
  const isPageArrow = (id) => id === 'storage-prev' || id === 'storage-next';
  const focusAnimations = createFocusAnimation(
    (id, entering) => [hoverClip(id, entering)].filter(Boolean),
    (clips) => Math.max(0, ...clips.map((item) => item.animation.frames)),
  );
  const arrowFocusAnimations = createFocusAnimation(
    (id, entering) => [hoverClip(id, entering)].filter(Boolean),
    (clips) => Math.max(0, ...clips.map((item) => item.animation.frames)),
  );
  const working = (target) => poseLayout(
    pose(target),
    [...focusAnimations.samples(), ...arrowFocusAnimations.samples()]
      .filter(({ clip }) => clip.target === target)
      .map(({ clip, frame }) => sample(clip, frame)),
  );

  const commit = (clips, frame) => {
    // The native Memory scene owns a separate layout per slot. Shared entry /
    // exit clips affect every slot; focus clips belong only to the individual slot.
    if (clips.some((item) => item.target === 'box')) {
      for (let index = 0; index < 15; index++) {
        const target = `slot${index}`;
        bases[target] = pose(target, clips, frame);
      }
    }
    for (const target of new Set(clips.map((item) => item.target)))
      bases[target] = pose(target, clips, frame);
  };
  const changeBackCaption = (caption, initialFrame = 0) => {
    if (kind === 'channels') backCaptionChanges.push({ caption, frame: initialFrame });
  };
  const advanceBackCaption = (frames) => {
    if (!backCaptionChanges.length) return;
    const outgoing = clip('back', 'AlphOut', 'G_FocusBtnA');
    const incoming = clip('back', 'AlphIn', 'G_FocusBtnA');
    const textFrame = outgoing.animation.frames + 1;
    const duration = outgoing.animation.frames + incoming.animation.frames;
    while (backCaptionChanges.length && frames > 0) {
      const change = backCaptionChanges[0];
      const step = Math.min(frames, duration - change.frame);
      change.frame += step;
      frames -= step;
      if (change.frame >= textFrame) backCaption = change.caption;
      if (change.frame < duration) break;
      commit([incoming], incoming.animation.frames - 1);
      backCaptionChanges.shift();
    }
  };
  const startBackFade = (show) => {
    if (kind !== 'channels') return;
    backFade = { clip: clip('back', show ? 'AlphIn' : 'AlphOut', 'G_FocusBtnA'), frame: 0 };
  };
  const advanceBackFade = (frames) => {
    if (!backFade) return;
    backFade.frame = Math.min(backFade.clip.animation.frames, backFade.frame + frames);
    if (backFade.frame < backFade.clip.animation.frames) return;
    commit([backFade.clip], backFade.clip.animation.frames - 1);
    backFade = null;
  };
  const start = (name, clips, done, {
    frames,
    initialFrame = 0,
    preserveArrowFocus = false,
    rate = 1,
  } = {}) => {
    if (!preserveArrowFocus) arrowFocusAnimations.reset();
    if (!preserveArrowFocus || !isPageArrow(focus)) focus = null;
    focusAnimations.reset();
    balloonFrame = 0;
    balloonWait = 0;
    phase = {
      name,
      clips,
      frame: initialFrame,
      frames: frames ?? Math.max(0, ...clips.map((item) => item.animation.frames)),
      rate,
      preserveArrowFocus,
      done,
    };
  };
  const boxIn = (preserveArrowFocus = false, rate = 1) => {
    if (medium().status !== 'ready') {
      boxShown = false;
      start('media-error', [clip('base', 'ErrorTxtIn', 'G_ErrorTxt')], () => {});
      return;
    }
    commit([clip('base', 'ErrorTxtOut', 'G_ErrorTxt')], 100);
    boxShown = true;
    start('boxes-in', [clip('box', 'SaveDataIn', 'G_Data')], () => {}, {
      preserveArrowFocus, rate,
    });
  };
  const reset = () => {
    bases = Object.fromEntries(
      Object.entries(keys).map(([target, key]) => [target, poseLayout(layouts[key])]),
    );
    for (const name of ['N_ArwR', 'N_ArwL', 'N_Capa_00', 'T_Capa_00'])
      visible(bases.base, name, false);
    for (const name of [
      'N_Wait',
      'T_Block_01',
      'T_Block_03',
      'Banner_01',
      'BaseMove_off',
      'BaseMove_off_00',
      'T_Move_off',
      'T_Move_off_00',
    ])
      visible(bases.detail, name, false);
    if (kind === 'channels') {
      visible(bases.detail, 'N_Mask4x3', !display.wide);
      visible(bases.detail, 'N_Mask16x9', display.wide);
    }
    commit(
      [
        clip('base', 'DataIn', 'G_DataAll'),
        clip('base', 'SelectIn', 'G_Select'),
        clip('box', 'SaveDataIn', 'G_Data'),
      ],
      0,
    );
    if (kind !== 'channels')
      commit([clip('base', kind === 'gamecube' ? 'CubeSwitch' : 'WiiSwitch', 'G_Switch')], 1);
    commit([clip('back', 'SeenIn', 'G_BarIn'), clip('back', 'WiiLost', 'G_Wii')], 100);
    commit([clip('back', 'AlphOut', 'G_FocusBtnA')], 0);
    selectedTab = initialTab;
    channelPage = 0;
    channelAge = 0;
    detailRecord = null;
    detailAge = 0;
    backCaption = 315;
    backCaptionChanges.length = 0;
    backFade = null;
    page = 'grid';
    boxShown = false;
    focus = null;
    focusAnimations.reset();
    start('data-in', [clip('base', 'DataIn', 'G_DataAll')], () => {
      if (kind === 'gamecube' && medium().status === 'ready') {
        // MemoryCard::on_fadein1st (4.3U 0x813CA980) starts SelectIn
        // and every save's fade-in together, then waits for both to finish.
        boxShown = true;
        start('tabs-and-boxes-in', [
          clip('base', 'SelectIn', 'G_Select'),
          clip('box', 'SaveDataIn', 'G_Data'),
        ], () => {});
      } else start('tabs-in', [clip('base', 'SelectIn', 'G_Select')], boxIn);
    });
  };
  const controls = () => {
    const disabled = Boolean(phase);
    if (page === 'dialog')
      return ['no', 'yes'].map((id, i) => ({
        id: `storage-${id}`,
        label: strings[i ? 321 : 322] ?? (i ? 'Yes' : 'No'),
        pane: i ? 'B_BtnA' : 'B_BtnB',
        prefix: 'storage-dialog:',
        disabled,
      }));
    if (page === 'detail')
      return [
        ...['move', 'copy', 'erase'].map((id, i) => ({
          id: `storage-${id}`,
          label: ['Move', 'Copy', 'Erase'][i],
          pane: `B_${['Move', 'Copy', 'Del'][i]}_00`,
          prefix: 'storage-detail:',
          disabled,
        })),
        { id: 'back', label: 'Back', pane: 'B_Button_00', prefix: 'storage-back:',
          disabled: disabled || backCaptionChanges.length > 0 },
      ];
    return [
      {
        id: 'storage-wii',
        label: kind === 'gamecube' ? 'Slot A' : 'Wii',
        pane: 'B_SelectWii_00',
        prefix: 'scene-storage:',
        disabled,
      },
      {
        id: 'storage-sd',
        label: kind === 'gamecube' ? 'Slot B' : 'SD Card',
        pane: 'B_SelectSd_00',
        prefix: 'scene-storage:',
        disabled,
      },
      ...(boxShown
        ? Array.from({ length: 15 }, (_, index) => ({
            id: kind === 'channels' && recordAt(index) ? `storage-channel-${index}`
              : index === 0 && dummyAvailable() ? 'storage-save'
              : recordAt(index) ? `storage-save-${index}` : `storage-block-${index}`,
            label: recordAt(index)?.title ?? `Empty block ${index + 1}`,
            pane: kind === 'channels' && display.wide ? 'B_Data_01' : 'B_Data_00',
            prefix: `storage-box-${index}:`,
            disabled,
          }))
        : []),
      ...['prev', 'next'].filter((id) => id === 'prev'
        ? channelPage > 0 : (channelPage + 1) * 15 < records().length).map((id) => ({
          id: `storage-${id}`,
          label: id === 'prev' ? 'Previous entries' : 'Next entries',
          pane: id === 'prev' ? 'B_ArwL' : 'B_ArwR',
          prefix: kind === 'channels' ? 'storage-arrows:' : 'scene-storage:',
          disabled,
        })),
      { id: 'back', label: 'Back', pane: 'B_Button_00', prefix: 'storage-back:',
        disabled: disabled || backCaptionChanges.length > 0 },
    ];
  };
  const hoverClip = (id, enter) => {
    if (id === 'back') return clip('back', `BtnFoucus${enter ? 'In' : 'Out'}`, 'G_FocusBtnA');
    if (id === 'storage-prev' || id === 'storage-next') {
      return clip('base', enter ? 'FocusOn' : 'FocusOff',
        `G_Arw${id === 'storage-prev' ? 'L' : 'R'}_Focus`);
    }
    const index = slotIndex(id);
    if (index !== null)
      return clip(`slot${index}`, `SaveDataFoucus${enter ? 'In' : 'Out'}`, 'G_Data');
    if (['storage-move', 'storage-copy', 'storage-erase'].includes(id)) {
      const stem = { 'storage-move': 'Move', 'storage-copy': 'Copy', 'storage-erase': 'Del' }[id];
      return clip('detail', `${stem}Foucus${enter ? 'In' : 'Out'}`, `G_${stem}`);
    }
    if (id === 'storage-no' || id === 'storage-yes')
      return clip(
        'dialog',
        `FocusBtn_${enter ? 'on' : 'off'}`,
        `G_FocusBtn${id === 'storage-no' ? 'B' : 'A'}`,
      );
    const tab = id === 'storage-wii' ? 'Wii' : id === 'storage-sd' ? 'Sd' : null;
    return (
      tab &&
      clip(
        'base',
        `Select${tab}${tab === 'Wii' ? 'Foucus' : ''}${enter ? 'In' : 'Out'}`,
        `G_Select${tab}`,
        // Both tab resources contain ascending scale keys. Native constructors
        // mark the Out controller as reverse (4.3U 0x813A3864, 0x813C6E84,
        // 0x813C9F68); the filename alone does not establish playback direction.
        !enter,
      )
    );
  };
  const closeDialog = (result) => {
    start(
      'dialog-select',
      [clip('dialog', 'SelectBtn_Ac', `G_SelectBtn${result ? 'A' : 'B'}`)],
      () => {
        start('dialog-out', [clip('dialog', 'DialogOut', 'G_InOut')], () => {
          page = 'detail';
          startBackFade(true);
          if (result) onAction(detailRecord?.id ?? 'dummy-save', { operation: action, changed: false });
          // The demonstration keeps its fixture intact, so the original reverse
          // SelectOut restores the three operation buttons after either answer.
          start('detail-buttons-in', [clip('detail', 'SelectOut', 'G_Select', true)], () => {});
        });
      },
    );
  };
  const api = {
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0)
        throw new RangeError('Frames must be nonnegative');
      focusAnimations.advance(frames);
      arrowFocusAnimations.advance(frames);
      channelAge += frames;
      if (page === 'detail' || page === 'dialog') detailAge += frames;
      if (recordAt(slotIndex(focus)) && !phase && focus !== null) {
        const before = balloonWait;
        balloonWait += frames;
        if (before < 17 && balloonWait >= 17) onSound('WIPL_SE_BALLOON');
        balloonFrame = Math.min(6, Math.max(0, balloonWait - 17));
      } else balloonFrame = Math.max(0, balloonFrame - frames);
      let remaining = frames;
      while (phase) {
        const rate = phase.rate ?? 1;
        const logicalStep = Math.min(remaining, (phase.frames - phase.frame) / rate);
        const step = logicalStep * rate;
        advanceBackCaption(step);
        advanceBackFade(logicalStep);
        phase.frame += step;
        remaining -= logicalStep;
        if (phase.frame < phase.frames) break;
        const completed = phase;
        commit(completed.clips, completed.frames);
        phase = null;
        completed.done?.();
        if (!remaining) break;
      }
      advanceBackCaption(remaining);
      advanceBackFade(remaining);
    },
    hover(id) {
      if (id === `storage-${selectedTab}`) id = null;
      // Page activation is gated independently of native arrow focus: Channels
      // 0x813A18D0/0x813A1990, Wii 0x813C504C/0x813C510C and GameCube
      // 0x813CBC20/0x813CBD20 still receive pointer departure during paging.
      if (phase && !phase.preserveArrowFocus) return false;
      if (phase && !isPageArrow(id)) id = null;
      if (
        id === focus ||
        (id && !controls().some((control) => control.id === id &&
          (!control.disabled || phase?.preserveArrowFocus)))
      )
        return false;
      focusAnimations.hover(isPageArrow(id) ? null : id);
      arrowFocusAnimations.hover(isPageArrow(id) ? id : null);
      focus = id;
      if (id && recordAt(slotIndex(id))) {
        balloonSlot = slotIndex(id);
        balloonWait = 0;
      }
      if (id) onSound('WIPL_SE_BT_TARGETTING');
      return true;
    },
    activate(id) {
      if (!controls().some((control) => control.id === id && !control.disabled)) return false;
      if (id.startsWith('storage-block-')) return false;
      if (id === 'back') return api.back();
      if (id === 'storage-prev' || id === 'storage-next') {
        onSound('WSD_SELECT');
        start('page-out', [clip('box', 'SaveDataOut', 'G_Data')], () => {
          channelPage += id === 'storage-next' ? 1 : -1;
          if (isPageArrow(focus) && !controls().some((control) => control.id === focus)) {
            arrowFocusAnimations.hover(null);
            focus = null;
          }
          boxIn(true, (21 + 26) / STORAGE_PAGE_TRANSITION_UPDATES);
        }, {
          preserveArrowFocus: true,
          rate: (21 + 26) / STORAGE_PAGE_TRANSITION_UPDATES,
        });
        return true;
      }
      if (id === 'storage-no' || id === 'storage-yes') {
        onSound(id === 'storage-yes' ? 'WIPL_SE_DECIDE' : 'WIPL_SE_CANCEL');
        closeDialog(id === 'storage-yes');
        return true;
      }
      if (id === 'storage-wii' || id === 'storage-sd') {
        const next = id === 'storage-wii' ? 'wii' : 'sd';
        if (next === selectedTab) return false;
        onSound('WIPL_SE_BT_PUSH');
        start(
          'tab-change',
          [
            clip('base', `Select${next === 'wii' ? 'Sd' : 'Wii'}Flash`, 'G_Select'),
            clip('box', 'SaveDataOut', 'G_Data'),
            ...(medium().status === 'ready'
              ? [] : [clip('base', 'ErrorTxtOut', 'G_ErrorTxt')]),
          ],
          () => {
            selectedTab = next;
            onTabChange(next);
            channelPage = 0;
            for (let index = 0; index < 15; index++)
              bases[`slot${index}`] = poseLayout(layouts[boxKey]);
            if (medium().status !== 'ready') {
              boxShown = false;
              start('slot-empty', [clip('base', 'ErrorTxtIn', 'G_ErrorTxt')], () => {});
            } else {
              commit([clip('base', 'ErrorTxtOut', 'G_ErrorTxt')], 100);
              boxIn();
            }
          },
        );
        return true;
      }
      if (id === 'storage-save' || id.startsWith('storage-channel-')
          || id.startsWith('storage-save-')) {
        const selectedSlot = slotIndex(id);
        detailRecord = recordAt(selectedSlot);
        detailAge = 0;
        onSound(kind === 'channels' ? 'WIPL_SE_DECIDE' : 'WIPL_SE_BT_PUSH');
        const anchor = sourceAnchorMatrices(working('base'), [
          `N_Data_b_${String(selectedSlot).padStart(2, '0')}`,
        ], {
          mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
        })[0];
        detailOrigin = [anchor.matrix[4], anchor.matrix[5], 0];
        page = 'detail';
        action = null;
        bases.detail = poseLayout(layouts[keys.detail]);
        for (const name of [
          'N_Wait',
          'T_Block_01',
          'T_Block_03',
          'Banner_01',
          'BaseMove_off',
          'BaseMove_off_00',
          'T_Move_off',
          'T_Move_off_00',
        ])
          visible(bases.detail, name, false);
        for (const name of ['Mask_00', 'N_Window', 'Banner_00', 'BlockLine'])
          visible(bases.detail, name, true);
        if (kind === 'channels') {
          visible(bases.detail, 'N_Mask4x3', !display.wide);
          visible(bases.detail, 'N_Mask16x9', display.wide);
          visible(bases.detail, 'BlockLine', !display.wide);
          visible(bases.detail, 'BlockLine01', display.wide);
          visible(bases.detail, 'Cover_4x3_del', false);
          visible(bases.detail, 'Cover_16x9_del', false);
        }
        changeBackCaption(252);
        start('detail-in', [clip('detail', 'SeenIn', 'G_Mask')], () => {});
        return true;
      }
      onSound(kind === 'channels' ? 'WIPL_SE_DECIDE' : 'WIPL_SE_BT_PUSH');
      action = id.slice(8);
      const stem = { move: 'Move', copy: 'Copy', erase: 'Del' }[action];
      start('operation-select', [clip('detail', `${stem}Flash`, `G_${stem}Flash`)], () => {
        start('detail-buttons-out', [clip('detail', 'SelectOut', 'G_Select')], () => {
          page = 'dialog';
          startBackFade(false);
          bases.dialog = poseLayout(layouts[DIALOG]);
          start('dialog-in', [clip('dialog', 'DialogIn', 'G_InOut')], () => {});
        });
      });
      return true;
    },
    back() {
      if (phase || backCaptionChanges.length) return false;
      onSound('WIPL_SE_CANCEL');
      if (page === 'dialog') {
        closeDialog(false);
        return true;
      }
      start('back-select', [clip('back', 'BtnFlash', 'G_SelectBtnA')], () => {
        if (page === 'detail') {
          // Button calculated the completed press before Channels observed it.
          // Its next calcNormal consumes Hide before calcCommon advances alpha
          // (0x8140B254 / 0x814072F0 / 0x81407414), without an extra idle pose.
          changeBackCaption(315, 1);
          const outgoing = clip('detail', 'SeenOut', 'G_Mask');
          // ChanAppEdit::anmFadeout (0x813A6418) deletes the independent
          // thumbnail, then immediately calculates SeenOut through 0x813A7100.
          // AnmPane::calc advances before posing: the first drawn frame is 1,
          // where the original gray cover is opaque. Nonloop playback stops
          // at resource frameCount - 1 (0x81369ABC / 0x81362890).
          const timing = kind === 'channels'
            ? { initialFrame: 1, frames: outgoing.animation.frames - 1 }
            : {};
          start('detail-out', [outgoing], () => {
            page = 'grid';
            action = null;
          }, timing);
        } else {
          const exitClips = [
            clip('base', 'DataOut', 'G_DataAll'),
            clip('box', 'SaveDataOut', 'G_Data'),
          ];
          if (medium().status !== 'ready') {
            exitClips.push(clip('base', 'ErrorTxtOut', 'G_ErrorTxt'));
          }
          if (kind === 'channels') {
            exitClips.push(
              clip('base', 'Lost', 'G_ArwL_End'),
              clip('base', 'Lost', 'G_ArwR_End'),
            );
          }
          start('data-out', exitClips, onBack);
        }
      });
      return true;
    },
    snapshot() {
      return {
        scene: kind,
        page,
        phase: phase?.name ?? null,
        locked: Boolean(phase),
        frame: phase?.frame ?? 0,
        selectedTab,
        channelPage,
        channelCount: kind === 'channels' ? channelRecords().length : 0,
        recordCount: records().length,
        mediaStatus: medium().status,
        dummyAvailable: dummyAvailable(),
        operation: action,
      };
    },
    presentation() {
      const base = working('base');
      const a = kind === 'gamecube' ? 'Slot A' : 'Wii',
        b = kind === 'gamecube' ? 'Slot B' : 'SD Card';
      putText(base, {
        T_SelectWii_00: a,
        T_SelectWii_01: a,
        T_SelectSd_00: b,
        T_SelectSd_01: b,
        T_Capa_00: `${strings[156] ?? 'Blocks Open: '}${
          fixture.freeBlocks?.[selectedTab] ?? virtualBlocks
        }${strings[242] ?? ''}`,
        T_Error_00: mediaErrorMessage(medium().status, { kind, tab: selectedTab, messages }),
      });
      // Native update_nand_free / update_sd_free show both panes for a ready
      // medium and concatenate messages 156, decimal digits and 242. These
      // counts are explicit local fixtures, never measurements of free space.
      const showCapacity = boxShown && medium().status === 'ready' && kind !== 'gamecube';
      visible(base, 'N_Capa_00', showCapacity);
      visible(base, 'T_Capa_00', showCapacity);
      if (page === 'grid') {
        visible(base, 'N_ArwL', channelPage > 0);
        visible(base, 'N_ArwR', (channelPage + 1) * 15 < records().length);
      }
      const layers = [{ layout: base, prefix: 'scene-storage:' }];
      if (boxShown) {
        const names = Array.from(
          { length: 15 },
          (_, i) => `N_Data_b_${String(i).padStart(2, '0')}`,
        );
        const anchors = sourceAnchorMatrices(base, names, {
          mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
        });
        for (let i = 0; i < 15; i++) {
          const box = working(`slot${i}`);
          const panes = indexLayout(box).panes;
          const position = panes.get(kind === 'channels' ? 'N_All' : 'N_Data_00');
          position.translation = [anchors[i].matrix[4], anchors[i].matrix[5], 0];
          if (kind === 'channels') {
            visible(box, 'N_Data16x9', display.wide);
            visible(box, 'N_Data4x3', !display.wide);
            visible(box, 'DataBaseCover_00', false);
            visible(box, 'DataBaseCover_01', false);
          } else {
            visible(box, 'N_Data_00', true);
            visible(box, 'DataBanner_00', Boolean(recordAt(i)));
          }
          layers.push({ layout: box, prefix: `storage-box-${i}:` });
          const channel = kind === 'channels' ? recordAt(i) : null;
          // ChanAppBox::draw (0x813A4D1C) suppresses its thumbnail during
          // the box's own entry/exit and page scrolling. Detail, button and
          // dialog transitions leave the underlying channel grid visible.
          const boxTransition = phase?.clips.some((item) => item.target === 'box');
          if (channel && !boxTransition) {
            const thumbnail = poseStorageThumbnail(channel, channelAge, { language });
            const scale = panes.get(display.wide ? 'N_Atari16x9' : 'N_Atari4x3').scale[0]
              * panes.get(display.wide ? 'N_Data_01' : 'N_Data_00').scale[0];
            // ChanAppBox::calc (0x813A4BB4) multiplies the independent
            // thumbnail translation by the widescreen projection ratio.
            // The box already receives that ratio through its layout root.
            const [sourceX, y] = position.translation;
            const x = sourceX * display.rootScaleX;
            const halfWidth = display.wide ? 51 : 38.4;
            layers.push({
              layout: thumbnail,
              prefix: `storage-channel-${i}:`,
              matrix: [scale, 0, 0, scale, x, y],
              clip: {
                x: display.halfWidth + x - halfWidth,
                y: display.halfHeight - y - 28.8,
                w: halfWidth * 2,
                h: 57.6,
              },
            });
            // ChanAppBox::draw restores this original rounded border after
            // drawing the clipped icon. It is not part of the empty-cell pass.
            layers.push({
              layout: channelCover(box, display.wide ? 'DataBaseCover_01' : 'DataBaseCover_00'),
              prefix: `storage-cover-${i}:`,
            });
          }
        }
      }
      if (balloonFrame > 0 && page === 'grid' && recordAt(balloonSlot)) {
        const source = layouts[BALLOON];
        const layout = poseLayout(source, [
          {
            animation: source.animations.my_IplTopBalloon_a_BalloonInOut,
            frame: balloonFrame,
            loop: false,
          },
        ]);
        const panes = indexLayout(layout).panes;
        const title = panes.get('T_Balloon');
        title.text = recordAt(balloonSlot).title;
        const width = Math.max(
          160 * display.rootScaleX,
          measureText(title.text, title, layout) + 40,
        );
        panes.get('W_Base').size[0] = width;
        panes.get('W_Shade').size[0] = width;
        const anchor = sourceAnchorMatrices(base, [
          `N_Data_b_${String(balloonSlot).padStart(2, '0')}`,
        ], {
          mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
        })[0].matrix;
        const margin = display.wide ? 90 : 60;
        const x = Math.max(
          -display.halfWidth + margin + width / 2,
          Math.min(display.halfWidth - margin - width / 2, anchor[4]),
        );
        panes.get('N_Balloon').translation = [x, anchor[5] - 55, 0];
        panes.get('N_Balloon').flags |= 1;
        layers.push({ layout, prefix: 'storage-balloon:' });
      }
      if (kind === 'channels') {
        // ChannelEdit::draw (0x813A1880–0x813A189C) redraws these original
        // subtrees after every box and title balloon, before the detail dialog.
        layers.push({ layout: channelArrowOverlay(base), prefix: 'storage-arrows:' });
      }
      if (page === 'detail' || page === 'dialog') {
        const detail = working('detail');
        if (phase?.name === 'detail-in') {
          // ChanAppEdit::calc (0x813A5AD8) calculates layout matrices before
          // on_fadein (0x813A6BEC) writes the interpolated local translation.
          // The retained native entry shows this translation two updates
          // behind SeenIn's scale; it reaches the center at update 14.
          const frame = kind === 'channels' ? Math.max(0, phase.frame - 2) : phase.frame;
          const t = Math.min(1, frame / 12);
          const window = indexLayout(detail).panes.get('N_Window');
          window.translation = detailOrigin.map(
            (value) => value * (1 - t),
          );
          // The trigger precedes the first layout calculation; its previous
          // invisible window matrix is still the one drawn on update zero.
          if (kind === 'channels' && phase.frame === 0) window.alpha = 0;
        }
        const [channelTitle, channelSubtitle = ''] = detailRecord?.titleLines?.[language]
          ?? (detailRecord?.titles?.[language] || detailRecord?.title || '').split('\n');
        const titlePane = kind === 'channels' && display.wide ? 'T_Title_02' : 'T_Title_00';
        const subtitlePane = kind === 'channels' && display.wide ? 'T_Title_03' : 'T_Title_01';
        const importedChannel = kind === 'channels' && /^[0-9a-f]{16}$/i.test(detailRecord?.id);
        const blockCount = detailRecord?.blocks ?? (importedChannel ? '-' : 1);
        putText(detail, {
          T_Move_00: strings[167] ?? 'Move',
          T_Copy_00: strings[178] ?? 'Copy',
          T_Del_00: strings[189] ?? 'Erase',
          T_Block_00: String(blockCount),
          T_Block_02: String(blockCount),
          [titlePane]: kind === 'channels' ? channelTitle : detailRecord?.title ?? 'Dummy Save',
          [subtitlePane]: kind === 'channels' ? channelSubtitle : 'Local save fixture',
          T_Message_00: action
            ? `${action === 'erase' ? 'Erase' : action === 'copy' ? 'Copy' : 'Move'} this ${kind === 'channels' ? 'channel' : 'save data'}?`
            : '',
        });
        layers.push({ layout: detail, prefix: 'storage-detail:' });
        if (kind === 'channels' && detailRecord?.icon && phase?.name !== 'detail-out'
            && !(phase?.name === 'detail-in' && phase.frame <= 15)) {
          // ChanAppEdit::draw (0x813A5C5C) adds an independent thumbnail only
          // after SeenIn frame 15, then redraws the selected mask subtree.
          // anmFadein (0x813A5EB8) copies N_Atari's local translation, not its
          // inherited/window matrix, into the thumbnail's root pane.
          const anchor = indexLayout(detail).panes.get(display.wide ? 'N_Atari16x9' : 'N_Atari4x3');
          const [x, y] = anchor.translation;
          const thumbnail = poseStorageThumbnail(detailRecord, detailAge, { language });
          thumbnail.root.translation = [0, 0, 0];
          const halfWidth = display.thumbnailHalfWidth;
          const halfHeight = display.thumbnailHalfHeight;
          layers.push({
            layout: thumbnail,
            prefix: 'storage-detail-thumbnail:',
            matrix: [1, 0, 0, 1, x, y],
            clip: {
              x: display.halfWidth + x - halfWidth,
              y: display.halfHeight - y - halfHeight,
              w: halfWidth * 2,
              h: halfHeight * 2,
            },
          });
          layers.push({
            layout: channelDetailMask(detail, display.wide ? 'N_Mask16x9' : 'N_Mask4x3'),
            prefix: 'storage-detail-mask:',
          });
        }
      }
      let back = working('back');
      const captionChange = backCaptionChanges[0];
      if (captionChange) {
        // change_button_text (0x813A6B40) queues Hide, SetText, Show. The
        // SettingButton owns this queue independently of the detail animation.
        const outgoing = clip('back', 'AlphOut', 'G_FocusBtnA');
        const textFrame = outgoing.animation.frames + 1;
        const hiding = captionChange.frame < textFrame;
        const animation = hiding ? outgoing : clip('back', 'AlphIn', 'G_FocusBtnA');
        const frame = hiding ? Math.max(0, captionChange.frame - 1)
          : captionChange.frame - textFrame;
        back = poseLayout(back, [sample(animation, frame)]);
      }
      if (backFade) back = poseLayout(back, [sample(backFade.clip, backFade.frame)]);
      putText(back, { T_Button_00: strings[backCaption] ?? 'Back' });
      if (page === 'dialog' && kind !== 'channels') visible(back, 'N_Button', false);
      layers.unshift({ layout: back, prefix: 'storage-back:' });
      if (page === 'dialog') {
        const dialog = putText(working('dialog'), {
          T_BtnA: strings[321] ?? 'Yes',
          T_BtnB: strings[322] ?? 'No',
        });
        // callS2Btn2 uses only the native bottom button strip. Its prompt is
        // the existing SavedataEdit T_Message pane, not a second dialog body.
        visible(dialog, 'N_Top', false);
        layers.push({ layout: dialog, prefix: 'storage-dialog:' });
      }
      return { ...api.snapshot(), layers, controls: controls() };
    },
  };
  reset();
  return api;
}
