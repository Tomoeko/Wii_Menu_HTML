import { Renderer } from './renderer.js';
import { BitmapFont } from './font.js';
import { createHostText } from './host-text.js';
import { poseLayout, indexLayout, identity, multiply, transform } from './animation.js';
import { createClock } from './clock.js';
import { poseEmptyDiscBanner } from './disc-animation.js';
import { createMenuState } from './menu-state.js';
import { createAudio } from './audio.js';
import { createMenuAudioSync } from './menu-audio.js';
import {
  previewPresentation,
  previewChangeClip,
  previewStartButtonClip,
  activatePreviewReturn,
} from './preview-transition.js';
import { createChannelFocus } from './channel-focus.js';
import { createChannelBalloon } from './channel-balloon.js';
import { poseChannel } from './channel-animation.js';
import { createHomeOverlay } from './home-overlay.js';
import { readRemoteState, saveRemoteState } from './remote-state.js';
import {
  defaultMessageFixture,
  readLocalLetterOutbox,
  readMessageFixture,
  saveLocalLetter,
} from './message-service.js';
import { createSDButton } from './sd-button.js';
import { languageMask } from './language.js';
import { loadConfig } from './config.js';
import { graphicsDimensions, presentationDimensions } from './graphics.js';
import { createFramePacer } from './frame-pacing.js';
import { createDisplay, prepareAspectLayout, paneForDisplay, screenPoint } from './display.js';
import {
  planChannelSlots,
  readChannelPlacement,
  serializeChannelPlacement,
  saveChannelArrangement,
} from './channel-storage.js';
import { createChannelDrag } from './channel-drag.js';
import { dragAudioParameters } from './drag-audio.js';
import { createHealthScreen } from './health-screen.js';
import { channelZoom, drawChannelZoom, sourceAnchorMatrices } from './channel-zoom.js';
import { createMenuScenes, MENU_SCENE_LAYOUTS } from './menu-scenes.js';
import { menuEntranceSample } from './native-fader.js';
import { createSceneFader } from './scene-fader.js';
import { createHomeUnderlayCache, homeUnderlayEligible } from './home-underlay-cache.js';
import { createSettingsSurface } from './settings-surface.js';
import { settingsSoundSymbol } from './settings-sounds.js';
import { createSettingsKeyboard } from './settings-keyboard.js';
import { createSettingsDialog, SETTINGS_DIALOG_LAYOUTS } from './settings-dialog.js';
import { createFooterController } from './footer-controller.js';
import { createSDMenu, SD_MENU_LAYOUTS } from './sd-menu.js';
import {
  eraseIncomingLetter,
  eraseMemo,
  prepareMessageBoardSave,
  readMessageBoard,
} from './message-board-storage.js';
import { readContacts, saveContacts } from './contact-storage.js';
import { preloadIncomingLetterAssets } from './incoming-letter-assets.js';
import { mergeChannelCatalog, readCustomChannelCatalog } from './channel-catalog.js';
import { selectChannelCatalog } from './channel-selection.js';
import { readDeletedChannelIds } from './channel-recovery.js';
import {
  createNativeDictionaryProvider,
  loadEmbeddedDictionaries,
} from './native-dictionary.js';
import {
  commonArrowDefinitions,
  createArrowInteraction,
  isArrowId,
  isPersistentArrowControl,
  pointerRemainsInPersistentControl,
  resolveDragArrowHover,
  resolvePointerHover,
  shouldActivateArrowPointerDown,
} from './arrow-interaction.js';
import { routeFooterHover } from './hover-routing.js';
import { menuFooterState } from './menu-footer-state.js';
import { normalizeKeyboardPreferences } from './keyboard-preferences.js';
import { createMenuInspection } from './menu-inspection.js';
import { createMenuPointer } from './menu-pointer.js';
import { keyboardSecondaryTarget, routeKeyboardTextPointer } from './keyboard-text-hit.js';
import {
  defaultStorageFixture,
  defaultStorageState,
  readStorageFixture,
  readStorageState,
  resolveStorageFixture,
  saveStorageState,
} from './storage-state.js';
import { advanceHomeBoundary, createMenuRestart } from './menu-restart.js';

const screen = document.querySelector('#screen'),
  canvas = document.querySelector('#menu');
const controls = document.querySelector('#controls'),
  status = document.querySelector('#status');
const assets = '/assets/';
const inspection = createMenuInspection({ screen, canvas });
const layouts = {};
const fonts = new Map();
const sceneFader = createSceneFader();
const shouldRenderFrame = createFramePacer();
let renderer,
  font,
  hostText,
  clock,
  menu,
  audio,
  focus,
  balloon,
  home,
  hover = null,
  hoverAt = 0,
  now = 0,
  notice = '';
let lastRenderTimestamp = 0;
let interactive = [],
  controlKey = '',
  startedAt = 0,
  sceneNow = 0,
  sceneDate = new Date(),
  previewStartedAt = 0,
  homeFadeAlpha = 0;
const controlRectangles = new WeakMap();
const screenState = new Map();

function setScreenState(name, value) {
  const text = String(value);
  if (screenState.get(name) === text) return;
  screenState.set(name, text);
  screen.dataset[name] = text;
}
let previewModuleLead = 0,
  previewArrowsStartedAt = 0,
  previewArrows;
let sdButton, footer, sdMenu;
let config,
  display,
  drag,
  health,
  startupComplete = false,
  audioSync;
let homeUnderlayCache;
const pointerInput = createMenuPointer({ surface: screen, getDisplay: () => display });
const pointer = pointerInput.pointer;
let restart, entranceHealthShown;
let zoomCapture = null,
  pendingZoomCapture = false,
  slotRects = [];
let grabPointerId = null,
  scenes,
  saveQueue = Promise.resolve();
let channelSoundPoint = null;
let memoPointer = null;
let suppressMemoClick = false;
let heldTextArrow = null;
let suppressedArrowClick = null;
let memoSaveQueue = Promise.resolve();

function queueMemoMutation(mutate) {
  // Return the original rejection to the reader while keeping later writes usable.
  const operation = memoSaveQueue.then(mutate);
  memoSaveQueue = operation.catch(() => {});
  return operation;
}
let boardVisited = false;
let channelPlacement = null;
let settingsFrame = null,
  settingsSurface = null,
  settingsRasterReady = null,
  settingsKeyboard = null,
  settingsDialog = null;
let settingsOpenedFromBoard = false;
let homeVolume = 0.7,
  homeRumble = true;
const solidLayout = {
  textures: [],
  materials: [
    {
      name: 'solid',
      colors: [
        [0, 0, 0, 0],
        [255, 255, 255, 255],
        [255, 255, 255, 255],
      ],
      textureMaps: [],
    },
  ],
};

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Missing ${path}`);
  return r.json();
}
function clip(layout, name, frame, group) {
  return { animation: layout.animations[name], frame, group, loop: false };
}
function pose(name, animation = name, frame = 0) {
  return poseLayout(layouts[name], [clip(layouts[name], animation, frame)]);
}
function translation(x, y) {
  return [1, 0, 0, 1, x, y];
}
function drawPointer() {
  if (!pointer.visible) return;
  const grabbed =
    (drag.getState() && ['grab', 'drag'].includes(drag.getState().phase)) ||
    scenes.snapshot().draggingMemo;
  renderer.draw(layouts[grabbed ? 'P1_Cat' : 'P1_Def'], {
    matrix: translation(pointer.x - display.halfWidth, display.halfHeight - pointer.y),
  });
}
function box(x, y, w, h, color) {
  renderer.quad(
    solidLayout,
    { origin: 0, size: [w, h], material: 0, vertexColors: Array.from({ length: 4 }, () => color) },
    translation(x - display.halfWidth, display.halfHeight - y),
    1,
  );
}
function text(value, x, y, size = 22, color = [100, 100, 100, 255], align = 'center') {
  hostText.draw(value, x, y, size, color, align);
}

function textPane(pane, matrix, alpha, labels = {}, layout) {
  if (pane.type !== 'txt1') return;
  const value = Object.hasOwn(labels, pane.name) ? labels[pane.name] : pane.text;
  if (typeof value !== 'string') return;
  const face = fonts.get(layout?.fonts?.[pane.font]) || font;
  face.drawPane(value, pane, matrix, alpha, { material: layout?.materials[pane.material] });
  if (pane.caretVisible) face.drawCaret(value, pane, matrix, alpha);
}

function readLocalValue(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocalValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Could not save ${key}.`, error);
  }
}

function getKeyboardPreferences() {
  return normalizeKeyboardPreferences(readLocalValue('wii-menu.keyboard-preferences', null));
}

function onKeyboardPreferencesChange(value) {
  writeLocalValue('wii-menu.keyboard-preferences', normalizeKeyboardPreferences(value));
}
function action(id, label, rect, run, disabled = false) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return;
  const x = Math.max(0, rect.x),
    y = Math.max(0, rect.y);
  const clipped = {
    x,
    y,
    w: Math.min(display.width, rect.x + rect.w) - x,
    h: Math.min(display.height, rect.y + rect.h) - y,
  };
  if (clipped.w <= 0 || clipped.h <= 0) return;
  interactive.push({ id, label, rect: clipped, run, disabled });
}
function nativeAction(id, label, pane, run, disabled = false) {
  action(id, label, renderer.rect(pane), run, disabled);
}
function playAction(sound, fn) {
  return () => {
    notice = '';
    if (fn()) {
      void audio.play(sound);
    }
  };
}

function channelPose(channel, banner = false, frames) {
  return poseChannel(
    channel,
    banner ? 'banner' : 'icon',
    frames?.module ?? (sceneNow - (banner ? previewStartedAt : startedAt)) * 0.06,
    {
      baseFrame: frames?.base,
      language: 'ENG',
      measureText: (value, pane, layout) =>
        (fonts.get(layout?.fonts?.[pane.font]) || font).width(value, pane.fontSize, pane.charSpace),
    },
  );
}

function authoredLabels(layout) {
  return Object.fromEntries(
    [...indexLayout(layout).panes]
      .filter(([, pane]) => pane.type === 'txt1' && pane.text && !/^i+$/.test(pane.text))
      .map(([name, pane]) => [name, pane.text]),
  );
}

function drawBackground(matrix = identity) {
  const layout = pose('my_IplTop_c');
  const date = sceneDate;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  renderer.draw(layout, {
    matrix,
    onPane: (p, m, a) =>
      textPane(
        p,
        m,
        a,
        {
          T_Day_a: `${day} ${date.getMonth() + 1}/${date.getDate()}`,
          T_Day_b: `${day} ${date.getMonth() + 1}/${date.getDate()}`,
          T_Day_c: `${day} ${date.getMonth() + 1}/${date.getDate()}`,
        },
        layout,
      ),
  });
}
function drawSDButton(visible, input = false, locked = false, matrix = identity) {
  renderer.draw(
    sdButton.pose({ frame: (sceneNow - startedAt) * 0.06, hovered: hover === 'sd', visible }),
    { prefix: 'sd/', matrix },
  );
  if (input)
    nativeAction(
      'sd',
      'SD Card Menu',
      'sd/Ac',
      () => {
        if (
          sceneFader.start(() => {
            if (menu.openSD()) sdMenu.open();
          })
        ) {
          sdButton.select((sceneNow - startedAt) * 0.06);
          footer.clear();
          void audio.play('confirm');
        }
      },
      locked,
    );
}

function drawFooterBalloons() {
  const anchors = {};
  for (const [id, name] of Object.entries({
    settings: 'B_Set',
    board: 'B_Bbs',
    sd: 'sd/Ac',
    'board-back': 'scene-board-buttons:B_Ch',
    calendar: 'scene-board-buttons:B_Cal',
    create: 'scene-board-buttons:B_Add',
  })) {
    const bound = renderer.bounds.get(name);
    if (bound) {
      const [x, y] = transform(bound.matrix, 0, 0);
      anchors[id] = { x, y };
    }
  }
  for (const item of footer.balloons(anchors))
    renderer.draw(item.layout, {
      onPane: (pane, matrix, alpha) =>
        textPane(pane, matrix, alpha, { T_Balloon: item.title }, item.layout),
    });
}

function drawFooter(state, matrix = identity) {
  footer.setArrows(menuFooterState(state).arrows);
  drawSDButton(true, true, state.locked, matrix);
  const summary = scenes?.messageSummary(sceneDate) ?? { count: 0, unreadCount: 0 };
  const layout = footer.pose({
    messageCount: summary.count,
    newMail: !boardVisited && summary.unreadCount > 0,
  });
  renderer.draw(layout, {
    matrix,
    onPane: (pane, matrix, alpha) => textPane(pane, matrix, alpha, {}, layout),
  });
  nativeAction(
    'settings',
    'Wii Options',
    'B_Set',
    playAction('confirm', () =>
      sceneFader.start(() => {
        if (menu.openSettings()) scenes.open('options');
      }),
    ),
    state.locked,
  );
  nativeAction(
    'board',
    'Wii Message Board',
    'B_Bbs',
    playAction('confirm', () => {
      if (menu.openBoard()) {
        boardVisited = true;
        scenes.open('board');
        return true;
      }
      return false;
    }),
    state.locked,
  );
  if (state.page > 0)
    nativeAction(
      'prev',
      'Previous page',
      'B_ArwL',
      playAction('page', () => {
        footer.press('prev');
        return menu.changePage(-1);
      }),
      state.locked,
    );
  if (state.page < 3)
    nativeAction(
      'next',
      'Next page',
      'B_ArwR',
      playAction('page', () => {
        footer.press('next');
        return menu.changePage(1);
      }),
      state.locked,
    );
}

function drawGrid(state, { layoutFrame, footer = true, input = true, background = true } = {}) {
  const transition = state.transition;
  const scrolling = transition?.kind === 'page';
  const zooming = transition && ['select', 'back'].includes(transition.kind);
  const dragState = drag.getState();
  let sourceFrame = 0;
  let page = state.page;
  let matrix = identity;
  let zoom;
  slotRects = [];

  if (scrolling) {
    page = transition.from.page;
    sourceFrame = (transition.to.page > page ? 40 : 0) + transition.progress * 20;
  }
  if (layoutFrame !== undefined) sourceFrame = layoutFrame;
  if (zooming) {
    const index = transition.to.selectedIndex ?? transition.from.selectedIndex;
    const anchorName = `N_Ch_c${String((index % 12) + 1).padStart(2, '0')}`;
    const [anchor] = sourceAnchorMatrices(pose('my_IplTop_a'), [anchorName], {
      mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
    });
    zoom = channelZoom({
      frame: transition.progress * 28,
      direction: transition.kind === 'select' ? 'in' : 'out',
      center: transform(anchor.matrix, 0, 0),
      wide: display.wide,
      projection: display.projection,
    });
    matrix = zoom.cameraMatrix;
    sourceFrame = zoom.layoutFrame;
    if (pendingZoomCapture || !zoomCapture || transition.kind === 'back') {
      const savedControls = interactive;
      zoomCapture = renderer.capture(
        () => {
          drawBackground();
          drawPreview(
            { ...state, selectedIndex: index, transition: null, locked: true },
            { capture: true, initial: transition.kind === 'select' },
          );
        },
        { reuse: zoomCapture },
      );
      interactive = savedControls;
      pendingZoomCapture = false;
    }
  }
  if (background) drawBackground(matrix);
  const layout = pose('my_IplTop_a', 'my_IplTop_a', sourceFrame);
  const layoutPanes = indexLayout(layout).panes;
  for (let relative = -2; relative <= 2; relative++) {
    if (page + relative < 0 || page + relative >= 4) {
      const edge = layoutPanes.get('Edge' + (relative + 2));
      if (edge) edge.flags &= ~1;
    }
  }
  const masks = new Set(Array.from({ length: 5 }, (_, i) => 'BaseMask' + i));
  renderer.draw(layout, { matrix, onPane: (pane) => pane.type !== 'pic1' || masks.has(pane.name) });
  const anchors = new Map(renderer.bounds);
  for (const [name, bound] of anchors) {
    const match = /^N_Ch_([a-e])(\d\d)$/.exec(name);
    if (!match) continue;
    const relative = 'abcde'.indexOf(match[1]) - 2;
    const index = Number(match[2]) - 1;
    const absolute = (page + relative) * 12 + index;
    if (absolute < 0 || absolute >= 48) continue;
    const rect = renderer.rect(name);
    if (!rect || rect.x + rect.w < 0 || rect.x > display.width || rect.y > display.height) continue;
    const [x, y] = transform(bound.matrix, 0, 0);
    const width = display.thumbnailHalfWidth * 2 * (zoom?.cameraMatrix[0] ?? 1);
    const height = 96 * (zoom?.cameraMatrix[3] ?? 1);
    renderer.clip({
      x: x + display.halfWidth - width / 2,
      y: display.halfHeight - y - height / 2,
      w: width,
      h: height,
    });
    const channel = state.channels[absolute];
    const movingOrigin =
      dragState &&
      absolute === dragState.source &&
      ['grab', 'drag', 'drop-in'].includes(dragState.phase);
    let thumbnail;
    if (movingOrigin || !channel)
      thumbnail = pose(
        'my_IplTop_b',
        'my_IplTop_b',
        ((sceneNow - startedAt) * 0.06 + index * 83) % 1999,
      );
    else if (channel.id === 'disc')
      thumbnail = pose(
        'my_DiskCh_b',
        'my_DiskCh_b',
        ((sceneNow - startedAt) * 0.06) % layouts.my_DiskCh_b.animations.my_DiskCh_b.frames,
      );
    else thumbnail = channelPose(channel);
    if (thumbnail) {
      const labels = authoredLabels(thumbnail);
      renderer.draw(thumbnail, {
        matrix: bound.matrix,
        layoutMode: 'embedded',
        exclude: languageMask(thumbnail),
        prefix: `slot${absolute}/`,
        onPane: (pane, m, alpha) => textPane(pane, m, alpha, labels, thumbnail),
      });
    }
    if (dragState && channel && absolute !== dragState.source) {
      renderer.draw(drag.maskPose(), { matrix: translation(x, y) });
    }
    if (dragState?.target === absolute && drag.dropPose())
      renderer.draw(drag.dropPose(), { matrix: translation(x, y) });
    renderer.clip(null);
    if (relative === 0 && !zooming && input) {
      slotRects.push({ index: absolute, rect });
      if (channel)
        action(
          'channel-' + absolute,
          channel.title,
          rect,
          () => {
            if (drag.getState()) return;
            notice = '';
            if (menu.selectChannel(absolute)) {
              void audio.play('click');
              void audio.play('select');
            }
          },
          state.locked || Boolean(dragState),
        );
    }
  }
  renderer.draw(layout, { matrix, exclude: new Set([...masks, 'ChMask']) });
  const clockLayout = clock.pose(sceneDate, (sceneNow - startedAt) * 0.06);
  const clockAnchors = sourceAnchorMatrices(layout, undefined, {
    mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
  });
  for (const anchor of clockAnchors) {
    // clock::draw copies the global anchor into N_WiiMenu while retaining its
    // original parent root's widescreen scale.
    const clockMatrix = [...anchor.matrix];
    clockMatrix[4] *= display.rootScaleX;
    renderer.draw(clockLayout, {
      matrix: multiply(matrix, clockMatrix),
      onPane: (pane, m, alpha) => textPane(pane, m, alpha, { T_WiiMenu: 'Wii Menu' }, clockLayout),
    });
  }
  const selection =
    transition?.kind === 'select'
      ? focus.selectPose(state.selectedIndex, transition.progress * 28)
      : null;
  if (!state.locked || selection) {
    for (const item of selection ? [selection] : focus.poses()) {
      const anchor = anchors.get(`N_Ch_c${String((item.index % 12) + 1).padStart(2, '0')}`);
      if (anchor) renderer.draw(item.layout, { matrix: anchor.matrix, layoutMode: 'embedded' });
    }
  }
  // Button::setCamera retains ChannelSelect's global ortho transform. Native
  // captures show its buttons moving with the grid beneath ChannelTitle's fade.
  if (footer) drawFooter({ ...state, locked: state.locked || Boolean(dragState) }, matrix);
  if (zoom) {
    drawChannelZoom(renderer, layout, zoom, zoomCapture, (rect, alpha) => {
      box(rect.x, rect.y, rect.w, rect.h, [0, 0, 0, Math.round(alpha * 255)]);
    });
  }
  if (!state.locked && !dragState)
    for (const item of balloon.poses(state.channels)) {
      renderer.draw(item.layout, {
        onPane: (pane, m, alpha) =>
          textPane(pane, m, alpha, { T_Balloon: item.title }, item.layout),
      });
    }
  if (dragState)
    renderer.draw(drag.shadePose(), {
      matrix: translation(
        dragState.point.x - display.halfWidth,
        display.halfHeight - dragState.point.y,
      ),
    });
}

function drawPreview(state, { capture = false, initial = false } = {}) {
  const presentation = previewPresentation(state),
    channel = state.channels[presentation.index];
  // Base banner animations start after ChangeOut; native channel modules begin
  // when the destination layout is created, ten frames earlier.
  const baseFrame =
    initial || presentation.phase === 'out' ? 0 : (sceneNow - previewStartedAt) * 0.06;
  const moduleFrame = initial
    ? 0
    : presentation.phase === 'out'
      ? presentation.frame
      : baseFrame + previewModuleLead;
  const banner =
    channel.id === 'disc'
      ? poseEmptyDiscBanner(layouts.my_DiskCh_a, baseFrame)
      : channelPose(channel, true, { base: baseFrame, module: moduleFrame });
  const labels =
    channel.id === 'disc' ? { T_Bar: 'Disc Channel', T_Comment0: 'Please insert a disc.' } : {};
  if (banner)
    renderer.draw(banner, {
      exclude: languageMask(banner),
      onPane: (p, m, a) => textPane(p, m, a, labels, banner),
    });
  const source = layouts.my_ChTop_a;
  const startEnabled = channel.id !== 'disc';
  // ChannelTitle binds the disabled Start button at OnBtn frame zero.
  const clips = [
    previewStartButtonClip(source, state, presentation),
    clip(source, 'my_ChTop_a_OnBtn', 10, 'G_OnOffBtnA'),
  ];
  const change = previewChangeClip(source, presentation);
  if (change) clips.push(change);
  for (const [id, group] of [
    ['back', 'G_FocusBtnA'],
    ['start', 'G_FocusBtnB'],
  ]) {
    if (id === 'start' && !startEnabled) continue;
    clips.push(
      clip(
        source,
        hover === id ? 'my_ChTop_a_FocusBtn_on' : 'my_ChTop_a_FocusBtnA_off',
        hover === id ? (now - hoverAt) * 0.06 : 10,
        group,
      ),
    );
  }
  const layout = poseLayout(source, clips);
  renderer.draw(layout, {
    onPane: (p, m, a) => textPane(p, m, a, { T_BtnA: 'Wii Menu', T_BtnB: 'Start' }, layout),
  });
  if (capture) return;
  nativeAction(
    'back',
    'Wii Menu',
    'B_BtnA',
    () => activatePreviewReturn(menu, (symbol) => void audio.play(symbol)),
    state.locked,
  );
  nativeAction(
    'start',
    'Start ' + channel.title,
    'B_BtnB',
    () => {
      notice = `${channel.title}\nChannel preview`;
      void audio.play('confirm');
    },
    state.locked || !startEnabled,
  );
  const arrows = layouts.my_IplTop_e,
    arrowClips = [
      clip(arrows, 'my_IplTop_e', 0),
      clip(arrows, 'my_IplTop_e', 10000 + (((sceneNow - startedAt) * 0.06) % 55), 'G_ArwRoop'),
    ];
  const exclude = new Set(
    [...indexLayout(arrows).panes.keys()].filter(
      (name) => /^N_Btn[RL]_a/.test(name) || name === 'N_Dust',
    ),
  );
  for (const [direction, id, suffix] of [
    [-1, 'prev', 'L'],
    [1, 'next', 'R'],
  ]) {
    if (menu.previewNeighbor(direction) === null) exclude.add('N_Arw' + suffix);
    arrowClips.push(
      clip(
        arrows,
        'my_IplTop_e',
        10150 + Math.min(10, (sceneNow - previewArrowsStartedAt) * 0.06),
        'G_Arw' + suffix + '_End',
      ),
    );
  }
  arrowClips.push(...previewArrows.clips());
  renderer.draw(poseLayout(arrows, arrowClips), { exclude });
  for (const [direction, id, suffix] of [
    [-1, 'prev', 'L'],
    [1, 'next', 'R'],
  ])
    if (menu.previewNeighbor(direction) !== null)
      nativeAction(
        id,
        direction < 0 ? 'Previous channel' : 'Next channel',
        'B_Arw' + suffix,
        playAction('page', () => menu.changePreview(direction)),
        state.locked,
      );
}

function dummyButton(id, label, x, y, w, run) {
  const active = hover === id;
  box(x - 2, y - 2, w + 4, 54, active ? [0, 182, 229, 255] : [178, 192, 199, 255]);
  box(x, y, w, 50, [249, 249, 249, 255]);
  text(label, x + w / 2, y + 13, 23);
  action(id, label, { x, y, w, h: 50 }, run, menu.getState().locked);
}
function drawSDMenu() {
  const presentation = sdMenu.presentation();
  for (const { layout, clip, ...drawOptions } of presentation.layers) {
    renderer.clip(clip ?? null);
    renderer.draw(layout, {
      ...drawOptions,
      onPane: (pane, matrix, alpha) => textPane(pane, matrix, alpha, {}, layout),
    });
  }
  renderer.clip(null);
  for (const control of presentation.controls)
    nativeAction(
      'sd-menu-' + control.id,
      control.label,
      control.prefix + control.pane,
      () => sdMenu.activate(control.id),
      presentation.locked || control.disabled,
    );
}

function drawSettings() {
  const footerState = menuFooterState(menu.getState(), scenes.snapshot());
  const presentation = scenes.presentation({
    date: sceneDate,
    gridArrowClips: footerState.useGridArrowClips ? footer.arrowClips() : [],
  });
  for (const layer of presentation.layers) {
    const { layout, clip, ...drawOptions } = layer;
    renderer.clip(clip ?? null);
    renderer.draw(layout, {
      ...drawOptions,
      onPane: (pane, matrix, alpha) => textPane(pane, matrix, alpha, {}, layer.layout),
    });
    if (
      layer.gridOverlayAfter &&
      presentation.gridFrame !== null &&
      presentation.frame < presentation.drawGridUntil
    ) {
      drawGrid(
        { ...menu.getState(), transition: null, locked: true },
        {
          layoutFrame: presentation.gridFrame,
          footer: false,
          input: false,
          background: false,
        },
      );
    }
  }
  renderer.clip(null);
  if (presentation.scene === 'board') drawSDButton(footerState.sdVisible);
  for (const control of presentation.controls) {
    nativeAction(
      'scene-' + control.id,
      control.label,
      control.prefix + control.pane,
      () => {
        const sceneState = scenes.snapshot();
        const ownsSound =
          (sceneState.scene === 'board' && !sceneState.boardChild) ||
          sceneState.boardChild === 'create' ||
          sceneState.storagePage ||
          control.id.startsWith('memo-');
        if (scenes.activate(control.id) && !ownsSound)
          void audio.play(control.id === 'back' ? 'cancel' : 'confirm');
      },
      control.disabled,
    );
  }
}

function drawSettingsOverlay(controller, controlPrefix) {
  const presentation = controller.presentation();
  interactive = [];
  for (const { layout, clip, ...options } of presentation.layers) {
    renderer.clip(clip ?? null);
    renderer.draw(layout, {
      ...options,
      onPane: (pane, matrix, alpha) => textPane(pane, matrix, alpha, {}, layout),
    });
  }
  renderer.clip(null);
  for (const control of presentation.controls)
    nativeAction(
      controlPrefix + control.id,
      control.label,
      control.prefix + control.pane,
      () => controller.activate(control.id),
      control.disabled,
    );
}

async function openSystemSettings(
  settings,
  entryPoint = settings?.defaultEntryPoint,
  fromBoard = false,
) {
  if (!settings?.defaultEntryPoint) {
    notice = 'System Settings resources are missing.\nRe-run WAD preparation.';
    return;
  }
  try {
    if (!settingsSurface) {
      settingsSurface = await createSettingsSurface({
        container: screen,
        display,
        graphics: config.graphics,
        homeKeys: config.input.homeKeys,
        settings,
        externalClock: true,
        onEvent: (data) => {
          if (data.action === 'raster-ready') {
            settingsRasterReady?.();
            settingsRasterReady = null;
          } else if (data.action === 'exit') {
            closeSystemSettings();
          } else if (data.action === 'keyboard-request') {
            if (!settingsKeyboard.open(data))
              settingsSurface.completeKeyboard({
                requestId: data.requestId,
                text: data.text,
                accepted: false,
              });
          } else if (data.action === 'validation-request') {
            settingsDialog.open(data);
          } else if (data.action === 'sound') {
            void audio.unlock();
            const symbol = settingsSoundSymbol(data.value);
            if (symbol) void audio.play(symbol);
          } else if (data.action === 'gesture') void audio.unlock();
          else if (data.action === 'home' && !menu.getState().overlay) {
            openHomeMenu();
          } else if (data.action === 'pointer') {
            pointer.visible = data.visible !== false;
            if (Number.isFinite(data.x) && Number.isFinite(data.y)) {
              pointer.x = data.x;
              pointer.y = data.y;
            }
          } else if (data.action === 'error') {
            notice = data.message;
            settingsRasterReady?.();
            settingsRasterReady = null;
          }
        },
      });
      settingsFrame = settingsSurface.element;
    }
    const ready = new Promise((resolve) => {
      settingsRasterReady = resolve;
    });
    settingsOpenedFromBoard = fromBoard;
    settingsSurface.open(assets + entryPoint);
    await ready;
  } catch (error) {
    notice = 'System Settings could not render.\n' + error.message;
    console.error(error);
  }
}

function closeSystemSettings() {
  return sceneFader.start(() => {
    settingsKeyboard?.reset();
    settingsDialog?.reset();
    settingsSurface.close();
    if (!settingsOpenedFromBoard) scenes.open('options');
    settingsOpenedFromBoard = false;
  });
}

function openHomeMenu() {
  if (!menu.openHome()) return false;
  scenes.suspendAudio();
  home.open({ volume: homeVolume, rumble: homeRumble });
  setHover(null);
  return true;
}

function drawHome() {
  const result = home.presentation();
  homeFadeAlpha = Math.round((result.fadeAlpha ?? 0) * 255);
  renderer.draw(result.layout, {
    onPane: (pane, matrix, alpha) => textPane(pane, matrix, alpha, {}, result.layout),
  });
  for (const item of result.controls) {
    nativeAction(item.id, item.label, item.pane, () => home.activate(item.id), !result.ready);
  }
}

function syncControls(state) {
  const key = JSON.stringify(interactive.map(({ id, label, disabled }) => [id, label, disabled]));
  if (key !== controlKey) {
    controlKey = key;
    const focused = document.activeElement?.dataset.control;
    const existing = new Map(
      [...controls.children].map((button) => [button.dataset.control, button]),
    );
    const buttons = interactive.map((item) => {
      if (existing.has(item.id)) {
        const button = existing.get(item.id);
        button.ariaLabel = button.textContent = item.label;
        button.disabled = item.disabled;
        return button;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.control = item.id;
      b.ariaLabel = item.label;
      b.textContent = item.label;
      b.disabled = item.disabled;
      b.addEventListener('pointerenter', () => setPointerHover(item.id));
      b.addEventListener('pointerleave', () => {
        if (
          (isPersistentArrowControl(item.id) || heldTextArrow?.controlId === item.id) &&
          pointInside(pointer, interactive.find((entry) => entry.id === item.id)?.rect)
        )
          return;
        setPointerHover(null);
      });
      b.addEventListener('pointerdown', (event) => {
        if (!shouldActivateArrowPointerDown({
          id: item.id,
          button: event.button,
          disabled: b.disabled,
          suppressed: suppressedArrowClick,
        }))
          return;
        const current = interactive.find((entry) => entry.id === item.id);
        if (!current || current.disabled) return;
        suppressedArrowClick = item.id;
        event.preventDefault();
        current.run();
      });
      b.addEventListener('mousedown', (event) => {
        // Some WebKit builds still focus a button after a prevented
        // pointerdown. Keep pointer activation from producing a native focus
        // ring or selecting the transparent button label.
        if (event.button === 0 && isPersistentArrowControl(item.id))
          event.preventDefault();
      });
      b.addEventListener('focus', () => setHover(item.id));
      b.addEventListener('click', () => {
        if (suppressedArrowClick === item.id) {
          suppressedArrowClick = null;
          return;
        }
        if (suppressMemoClick && item.id.startsWith('scene-memo-open-')) {
          suppressMemoClick = false;
          return;
        }
        interactive.find((x) => x.id === item.id)?.run();
      });
      return b;
    });
    for (const button of [...controls.children]) {
      if (!buttons.includes(button)) button.remove();
    }
    buttons.forEach((button, index) => {
      if (controls.children[index] !== button)
        controls.insertBefore(button, controls.children[index] ?? null);
    });
    if (focused)
      controls.querySelector(`[data-control="${focused}"]`)?.focus({ preventScroll: true });
  }
  for (const [i, item] of interactive.entries()) {
    const b = controls.children[i];
    const previous = controlRectangles.get(b);
    const rectangle = item.rect;
    if (previous && previous.x === rectangle.x && previous.y === rectangle.y &&
        previous.w === rectangle.w && previous.h === rectangle.h &&
        previous.displayWidth === display.width && previous.displayHeight === display.height) {
      continue;
    }
    Object.assign(b.style, {
      left: (item.rect.x / display.width) * 100 + '%',
      top: (item.rect.y / display.height) * 100 + '%',
      width: (item.rect.w / display.width) * 100 + '%',
      height: (item.rect.h / display.height) * 100 + '%',
    });
    controlRectangles.set(b, {
      ...rectangle,
      displayWidth: display.width,
      displayHeight: display.height,
    });
  }
  setScreenState('screen', state.screen);
  setScreenState('page', state.page);
  setScreenState('locked', state.locked);
}

function pointInside(point, rect) {
  return (
    rect &&
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

function releaseTextArrow() {
  if (!heldTextArrow) return;
  heldTextArrow.owner.releaseControl();
  if (screen.hasPointerCapture(heldTextArrow.pointerId))
    screen.releasePointerCapture(heldTextArrow.pointerId);
  heldTextArrow = null;
}

function updateArrowHover(state = menu.getState()) {
  if (!pointer.visible || state.overlay) return;
  const dragState = drag.getState();
  const dragging = dragState && ['grab', 'drag'].includes(dragState.phase);
  if (dragging) {
    const dragArrow = resolveDragArrowHover(interactive, pointer);
    if (dragArrow) {
      setHover(dragArrow);
      return;
    }
    // A drag owns the normal channel controls. Once the pointer leaves an
    // arrow, release its held bubble immediately and wait for a new arrow
    // hit instead of allowing a disabled channel button to reacquire hover.
    if (isPersistentArrowControl(hover)) {
      if (pointerRemainsInPersistentControl(interactive, pointer, hover)) return;
      setHover(null);
    }
    return;
  }
  const target = resolvePointerHover(interactive, pointer);
  if (target) setHover(target);
  else if (pointerRemainsInPersistentControl(interactive, pointer, hover)) return;
  else if (isPersistentArrowControl(hover)) setHover(null);
}

function setPointerHover(requested) {
  const target = menu.getState().overlay
    ? requested : resolvePointerHover(interactive, pointer, requested);
  if (!target && requested === null &&
      pointerRemainsInPersistentControl(interactive, pointer, hover)) return;
  setHover(target);
}

function centeredPoint(point) {
  return { x: point.x - display.halfWidth, y: display.halfHeight - point.y };
}

function playSceneSound(name, options = {}) {
  if (options.loop === false) return audio.stopLoop(name);
  if (options.loop) {
    if (options.speed > 30) options = { ...options, pitch: options.speed / 30 };
    void audio.startLoop(name, options);
    audio.setLoop(name, options);
  } else void audio.play(name, options);
}
function setHover(value) {
  if (menu?.getState().overlay) {
    home.hover(value);
    hover = value;
    hoverAt = now;
    return;
  }
  if (settingsDialog?.active) return;
  if (settingsKeyboard?.active) {
    settingsKeyboard.hover(value?.startsWith('settings-keyboard-') ? value.slice(18) : null);
    hover = value;
    hoverAt = now;
    return;
  }
  if (scenes) scenes.hover(value?.startsWith('scene-') ? value.slice(6) : null);
  if (sdMenu) sdMenu.hover(value?.startsWith('sd-menu-') ? value.slice(8) : null);
  previewArrows?.hover(menu.getState().screen === 'preview' ? value : null);
  const state = menu.getState();
  const draggingChannel = state.screen === 'grid' &&
    ['grab', 'drag'].includes(drag?.getState()?.phase);
  const footerOwnsSound = draggingChannel && isArrowId(value)
    ? (footer.hover(value), true)
    : routeFooterHover(footer, value, state, scenes?.snapshot(), sceneFader.active);
  if (hover === value) return;
  hover = value;
  hoverAt = now;
  const index = value?.startsWith('channel-') ? Number(value.slice(8)) : null;
  focus.target(index);
  balloon.target(index);
  const activeScene = value?.startsWith('scene-') ? scenes.snapshot() : null;
  const sceneOwnsSound = activeScene &&
    (activeScene.boardChild === 'create' || activeScene.readingMemo ||
      activeScene.storagePage ||
      value.startsWith('scene-memo-'));
  if (value && !value.startsWith('sd-menu-') && !footerOwnsSound && !sceneOwnsSound)
    void audio.play(value.startsWith('channel-') ? 'hover' : 'buttonHover');
}

function finishStartup(allowSilent = false) {
  if (startupComplete) return;
  const sound = audio.getStatus();
  if (!allowSilent && sound.supported && !sound.unlocked && !config.audio.muted) {
    if (status.hidden) {
      const button = document.createElement('button');
      button.textContent = 'Start Wii Menu';
      button.addEventListener('click', beginFromGesture);
      status.replaceChildren(button);
      status.hidden = false;
    }
    return;
  }
  startupComplete = true;
  entranceHealthShown = config.startup.healthSafety;
  status.hidden = true;
  startedAt = sceneNow = 0;
  audioSync(menu.getState());
}

function beginFromGesture() {
  const unlocking = audio.unlock();
  if (health.active) {
    if (health.accept()) void audio.play('click');
  } else void unlocking.then(() => finishStartup(true));
}

function updateDragTarget() {
  if (!drag.getState() || !['grab', 'drag'].includes(drag.getState().phase)) return;
  const hit = slotRects.find(
    ({ rect }) =>
      pointer.x >= rect.x &&
      pointer.x <= rect.x + rect.w &&
      pointer.y >= rect.y &&
      pointer.y <= rect.y + rect.h,
  );
  const state = menu.getState();
  // Native drag paging listens to the same expanding B_Arw hit pane as
  // ordinary pointer focus, including its held +/− bubble.
  const arrow = resolveDragArrowHover(interactive, pointer);
  const edge = arrow === 'prev' ? -1 : arrow === 'next' ? 1 : 0;
  drag.point(pointer, hit?.index ?? null, edge);
  const valid = hit && (hit.index === drag.getState().source || !state.channels[hit.index]);
  focus.target(valid ? hit.index : null);
}

function recordInspectionFrame(state = menu.getState()) {
  if (!inspection) return;
  inspection?.rendered({
    display,
    graphics: renderer.getGraphicsStatus(),
    maximumFrameRate: 60,
    date: sceneDate.toISOString(),
    sceneFrames: (sceneNow - startedAt) * 0.06,
    health: { active: health.active, ready: health.ready, startupComplete },
    restart: restart.sample(),
    audio: audio.getStatus(),
    menu: {
      screen: state.screen,
      page: state.page,
      selectedIndex: state.selectedIndex,
      transition: state.transition,
      locked: state.locked,
    },
    scene: scenes.snapshot(),
    drag: drag.getState(),
    arrows: footer.arrowClips().map(({ group, frame }) => ({ group, frame })),
    sd: sdButton.getState((sceneNow - startedAt) * 0.06),
    homeUnderlay: homeUnderlayCache?.status() ?? null,
  });
}

function finishFrame(state) {
  renderer.present({
    background: settingsFrame && !settingsFrame.hidden ? settingsSurface.raster : null,
  });
  inspection?.finishFrame();
  recordInspectionFrame(state);
  requestAnimationFrame(render);
}

function render(timestamp) {
  const renderFrame = shouldRenderFrame(timestamp);
  inspection?.frameCandidate(timestamp, renderFrame);
  if (!renderFrame) {
    requestAnimationFrame(render);
    return;
  }
  inspection?.beginFrame(timestamp);
  const measuredDelta = lastRenderTimestamp
    ? Math.max(0, Math.min(timestamp - lastRenderTimestamp, 100))
    : 0;
  lastRenderTimestamp = timestamp;
  const delta = inspection?.delta(measuredDelta) ?? measuredDelta;
  const frameDate = inspection?.date(delta) ?? new Date();
  now += delta;
  let systemSettingsVisible = settingsFrame && !settingsFrame.hidden;
  renderer.clear({ transparent: Boolean(systemSettingsVisible) });
  interactive = [];
  if (!startupComplete) {
    if (health.active) {
      health.advance(delta * 0.06);
      box(0, 0, display.width, display.height, [0, 0, 0, 255]);
      renderer.draw(health.pose());
      action(
        'health-continue',
        'Press A to continue',
        { x: 0, y: 0, w: display.width, h: display.height },
        beginFromGesture,
        !health.ready,
      );
      if (!health.active) finishStartup();
    } else if (audio.getStatus().unlocked) finishStartup();
    syncControls(menu.getState());
    finishFrame();
    return;
  }
  const previousState = menu.getState();
  if (previousState.overlay || previousState.transition || sceneFader.active || restart.active || notice)
    releaseTextArrow();
  const restartFrames = advanceHomeBoundary(home, restart, delta * 0.06);
  if (restartFrames !== null) {
    const previousRestart = restart.sample();
    sceneNow += restartFrames / 0.06;
    sceneDate = frameDate;
    restart.advance(restartFrames);
    const sample = restart.sample();
    if (sample.phase === 'grid' || sample.complete) {
      const gridAge = (sceneNow - startedAt) * 0.06;
      footer.advance(gridAge - (previousRestart.phase === 'grid' ? previousRestart.frame : 0));
      drawGrid({ ...menu.getState(), locked: true }, { input: false });
      drawPointer();
    } else {
      box(0, 0, display.width, display.height, [0, 0, 0, 255]);
      const loadingLayout = restart.pose();
      if (loadingLayout) renderer.draw(loadingLayout);
    }
    box(0, 0, display.width, display.height, [0, 0, 0, sample.alpha]);
    interactive = [];
    setScreenState('restart', sample.phase);
    syncControls({ ...menu.getState(), locked: true });
    finishFrame();
    return;
  }
  setScreenState('restart', 'complete');
  const frozen = previousState.overlay || previousState.transition?.kind === 'home';
  if (!frozen) {
    sceneNow += delta;
    sceneDate = frameDate;
    focus.advance(delta * 0.06);
    balloon.advance(delta * 0.06);
    previewArrows.advance(delta * 0.06);
    if (
      !sceneFader.active &&
      !systemSettingsVisible &&
      ['settings', 'board'].includes(previousState.screen)
    )
      scenes.advance(delta * 0.06);
    // Board can retire the new-mail timer when its grid child finishes.
    // Apply that lifecycle event before the footer advances its next cue.
    footer.advance(delta * 0.06);
    if ((!sceneFader.active || sceneFader.revealing) && previousState.screen === 'sd')
      sdMenu.advance(delta * 0.06, { revealing: sceneFader.revealing });
    if (systemSettingsVisible) settingsSurface?.advance(delta * 0.06);
    settingsKeyboard?.advance(delta * 0.06);
    settingsDialog?.advance(delta * 0.06);
    sceneFader.advance(delta * 0.06);
    const events = drag.advance(delta * 0.06, previousState.channels, {
      scrolling: previousState.locked,
    });
    if (grabPointerId !== null) {
      const point = { x: pointer.x - display.halfWidth, y: display.halfHeight - pointer.y };
      audio.setLoop('drag', dragAudioParameters(point, channelSoundPoint, delta * 0.06));
      channelSoundPoint = point;
    }
    if (events.sound) {
      focus.clear();
      void audio.play(events.sound);
    }
    if (events.page && menu.changePage(events.page)) {
      // Pointer capture keeps the transparent button from receiving a DOM
      // click. The drag page event is the native arrow activation, so pose its
      // authored pressed bubble at the same instant as the page transition.
      footer.press(events.page < 0 ? 'prev' : 'next');
      void audio.play('page');
    }
    if (events.move && menu.moveChannel(...events.move) && config.channels.persistLayout) {
      const arrangement = menu.getState().channels;
      saveQueue = saveQueue
        .then(async () => {
          channelPlacement = await saveChannelArrangement(arrangement, channelPlacement);
        })
        .catch((error) => {
          notice = error.message;
        });
    }
  }
  menu.advance(delta);
  const state = menu.getState();
  footer.setArrows(menuFooterState(state, scenes.snapshot()).arrows);
  const entrance = menuEntranceSample((sceneNow - startedAt) * 0.06, {
    healthShown: entranceHealthShown,
  });
  if (settingsFrame)
    settingsFrame.inert = Boolean(
      state.overlay ||
      state.transition?.kind === 'home' ||
      notice ||
      sceneFader.active ||
      settingsKeyboard?.active ||
      settingsDialog?.active,
    );
  if (!['select', 'back'].includes(state.transition?.kind) && zoomCapture) {
    renderer.releaseCapture(zoomCapture);
    zoomCapture = null;
  }
  if (state.locked || sceneFader.active || scenes.snapshot().transition) {
    balloon.clear();
    // A page scroll locks activation, but the original arrow hover remains
    // bound until the pointer leaves its expanded hit area.
    if (state.transition?.kind !== 'page') footer.clear();
  }
  const viewState =
    state.transition?.kind === 'home' && !state.overlay
      ? { ...state, ...state.transition.from, transition: state.transition, locked: true }
      : state;
  if (systemSettingsVisible && state.screen === 'grid' && !state.transition) {
    settingsKeyboard?.reset();
    settingsDialog?.reset();
    settingsSurface.close();
    systemSettingsVisible = false;
    renderer.clear();
  }
  if (!systemSettingsVisible) {
    const drawUnderlay = () => {
      if (viewState.screen === 'grid' || ['select', 'back'].includes(viewState.transition?.kind))
        drawGrid({ ...viewState, locked: viewState.locked || !entrance.complete });
      else if (viewState.screen === 'preview') {
        drawBackground();
        drawPreview(viewState);
      }
      else if (viewState.screen === 'sd') drawSDMenu();
      else drawSettings();
    };
    const sceneSnapshot = scenes.snapshot();
    const homeActive = Boolean(
      state.overlay ||
      (state.transition?.kind === 'home' && state.transition.from.overlay),
    );
    const eligible = homeUnderlayEligible({
      state,
      homeActive,
      startupComplete,
      entranceComplete: entrance.complete,
      settingsVisible: systemSettingsVisible,
      dragging: Boolean(drag.getState()) || Boolean(sceneSnapshot.draggingMemo),
      sceneTransition: Boolean(sceneSnapshot.transition),
      sceneFaderActive: sceneFader.active,
      restartActive: restart.active,
      notice: Boolean(notice),
      keyboardActive: Boolean(settingsKeyboard?.active),
      dialogActive: Boolean(settingsDialog?.active),
    });
    if (eligible) {
      const sceneKey = [
        viewState.screen,
        viewState.page,
        viewState.selectedIndex,
        ...viewState.channels.map((channel) => channel?.id ?? null),
      ];
      homeUnderlayCache.draw(sceneKey, drawUnderlay);
    } else {
      homeUnderlayCache.draw(null, drawUnderlay);
    }
  } else {
    homeUnderlayCache.reset();
  }
  if (
    !sceneFader.active &&
    !state.locked &&
    !state.overlay &&
    ['grid', 'board'].includes(state.screen)
  )
    drawFooterBalloons();
  if (systemSettingsVisible && settingsKeyboard?.active)
    drawSettingsOverlay(settingsKeyboard, 'settings-keyboard-');
  if (systemSettingsVisible && settingsDialog?.active)
    drawSettingsOverlay(settingsDialog, 'settings-validation-');
  if (state.overlay || (state.transition?.kind === 'home' && state.transition.from.overlay)) {
    interactive = [];
    drawHome(state);
  }
  if (notice) {
    interactive = [];
    box(0, 0, display.width, display.height, [255, 255, 255, 225]);
    notice
      .split('\n')
      .forEach((line, index) => text(line, display.halfWidth, 170 + index * 32, 25));
    dummyButton('dismiss', 'Back', display.halfWidth - 95, 282, 190, () => {
      notice = '';
      void audio.play('back');
    });
  }
  if (drag.getState()) updateDragTarget();
  drawPointer();
  if (homeFadeAlpha > 0 && state.overlay) {
    box(0, 0, display.width, display.height, [0, 0, 0, homeFadeAlpha]);
  }
  if (!entrance.complete) {
    interactive = [];
    box(0, 0, display.width, display.height, [0, 0, 0, entrance.alpha]);
  }
  if (sceneFader.active) {
    interactive = [];
    box(0, 0, display.width, display.height, [0, 0, 0, sceneFader.sample().alpha]);
  }
  syncControls(state);
  updateArrowHover(state);
  const audioStatus = audio.getStatus();
  setScreenState('channelAudio', audioStatus.channelId ?? '');
  setScreenState('audio', audioStatus.unlocked ? 'running' : 'suspended');
  setScreenState('backgroundAudio', audioStatus.backgroundPlaying);
  finishFrame(state);
}

async function init() {
  config = await loadConfig();
  display = createDisplay(config.display.aspectRatio);
  screen.style.width = `min(100vw, ${display.outputAspect * 100}vh)`;
  screen.style.height = `min(100vh, ${100 / display.outputAspect}vw)`;
  inspection?.setDisplay(display);
  const dimensions = graphicsDimensions(display, config.graphics);
  const screenBounds = screen.getBoundingClientRect();
  const surfaceWidth = screenBounds.width ||
    Math.min(window.innerWidth, window.innerHeight * display.outputAspect);
  const surfaceHeight = screenBounds.height ||
    Math.min(window.innerHeight, window.innerWidth / display.outputAspect);
  const output = presentationDimensions(
    surfaceWidth,
    surfaceHeight,
    window.devicePixelRatio,
    dimensions,
  );
  canvas.width = output.width;
  canvas.height = output.height;
  pointer.x = display.halfWidth;
  pointer.y = display.halfHeight;
  pointerInput.refresh();
  const manifest = await json(assets + 'manifest.json');
  const dictionaries = await loadEmbeddedDictionaries({
    manifestUrl: assets + 'keyboard-dictionary.json',
  });
  const dictionaryProvider = createNativeDictionaryProvider({
    fallbackDictionaries: dictionaries,
  });
  inspection?.setSource({
    preparation: manifest.preparation,
    resourceContent: manifest.source,
  });
  renderer = new Renderer(canvas, {
    display,
    graphics: config.graphics,
    sceneDimensions: dimensions,
    // Only the inspector reads this canvas after the frame has completed.
    // Channel transitions use their own retained offscreen capture texture.
    preserveDrawingBuffer: Boolean(inspection),
  });
  homeUnderlayCache = createHomeUnderlayCache(renderer);
  const names = new Set([
    'my_IplTop_a',
    'my_BackToWiiMenu',
    'my_IplTop_b',
    'my_IplTop_d',
    'my_IplTop_e',
    'my_IplTop_c',
    'my_IplTopBalloon_a',
    'my_ChTop_a',
    'my_DiskCh_a',
    'my_DiskCh_b',
    'my_Clock_a',
    'P1_Def',
    'P1_Cat',
    'th_HomeBtn_d',
    'mn_Sdcard_Btn',
    'it_Has_a',
    'my_TVMask_a',
    'my_TVShade_a',
    'my_TVApear_a',
    ...MENU_SCENE_LAYOUTS,
    ...SETTINGS_DIALOG_LAYOUTS,
    ...SD_MENU_LAYOUTS,
  ]);
  await Promise.all(
    [...names].map(async (name) => {
      const descriptor = manifest.layouts[name];
      if (!descriptor) throw new Error(`Missing menu layout: ${name}. Re-run preparation.`);
      layouts[name] = prepareAspectLayout(await json(assets + descriptor.url), display);
      await renderer.load(layouts[name]);
    }),
  );
  const loadedFonts = new Map();
  for (const [name, descriptor] of Object.entries(manifest.fonts)) {
    let face = loadedFonts.get(descriptor.url);
    if (!face) {
      face = new BitmapFont(await json(assets + descriptor.url), renderer);
      await face.load();
      loadedFonts.set(descriptor.url, face);
    }
    fonts.set(name, face);
  }
  font = fonts.get('RevoIpl_RodinNTLGPro_DB_48_IA4.brfnt');
  hostText = createHostText(renderer, display, fonts);
  clock = createClock(layouts.my_Clock_a, { region: 'USA', showIntro: true });
  focus = createChannelFocus(layouts.my_IplTop_d);
  balloon = createChannelBalloon(
    layouts.my_IplTopBalloon_a,
    (value, pane) => font.width(value, pane.fontSize, pane.charSpace),
    {
      display,
      onAppear: () => {
        void audio.play('balloon');
      },
    },
  );
  sdButton = createSDButton(layouts.mn_Sdcard_Btn, {
    enabled: config.sdCard.enabled,
    x: display.sdX,
  });
  health = createHealthScreen(layouts.it_Has_a, { enabled: config.startup.healthSafety });
  drag = createChannelDrag(
    { mask: layouts.my_TVMask_a, shade: layouts.my_TVShade_a, drop: layouts.my_TVApear_a },
    { wide: display.wide },
  );
  const catalog = mergeChannelCatalog(
    await json(assets + 'channels.json'),
    await readCustomChannelCatalog(assets),
  );
  const channels = [{ id: 'disc', title: 'Disc Channel' }];
  const selected = selectChannelCatalog(catalog, config.channels.enabled, {
    deletedIds: await readDeletedChannelIds(),
  });
  const channelWarnings = [];
  for (const descriptor of selected.channels) {
    const channel = { ...descriptor };
    try {
      if (!channel.iconLayout || !channel.bannerLayout)
        throw new Error('icon or preview layout is missing');
      channel.icon = prepareAspectLayout(await json(assets + channel.iconLayout), display);
      channel.banner = prepareAspectLayout(await json(assets + channel.bannerLayout), display);
      await Promise.all([renderer.load(channel.icon), renderer.load(channel.banner)]);
      channels.push(channel);
    } catch (error) {
      channelWarnings.push(`${channel.id}: ${error.message}`);
    }
  }
  channelPlacement = config.channels.persistLayout ? await readChannelPlacement() : null;
  const defaultIds = catalog.savedLayout?.slots?.map((slot) => slot.id) ?? [
    'disc',
    ...selected.defaultOrder,
  ];
  const placement = planChannelSlots(channels, channelPlacement, defaultIds);
  channelPlacement = serializeChannelPlacement(placement.slots, {
    ...channelPlacement,
    positions: placement.positions,
  });
  if (selected.unknownIds.length)
    channelWarnings.push(`Unknown configured channels: ${selected.unknownIds.join(', ')}`);
  if (placement.overflow.length)
    channelWarnings.push(`No free slots: ${placement.overflow.join(', ')}`);
  if (channelWarnings.length) notice = channelWarnings.join('\n');
  menu = createMenuState({
    channels: placement.slots,
    timing: { settings: 0 },
  });
  const audioManifest = await json(assets + 'audio.json').catch(() => ({}));
  audio = createAudio({
    backgroundMode: config.audio.backgroundMode,
    manifest: { ...manifest.audio, ...audioManifest },
    baseUrl: new URL(assets, location.href),
    onRequest: inspection?.soundRequest,
    onError: (name, error) => console.warn(name, error),
  });
  const remoteState = await readRemoteState(config.wiiRemote);
  homeVolume = remoteState.volume;
  homeRumble = remoteState.rumble;
  audio.setVolume(config.audio.volume);
  audio.setMuted(config.audio.muted);
  const messages = manifest.messages?.ENG
    ? await json(assets + manifest.messages.ENG.url)
    : undefined;
  home = createHomeOverlay(layouts.th_HomeBtn_d, {
    remoteState,
    reconnectFixture: config.wiiRemote.reconnect,
    onStateChange: (value) => {
      void saveRemoteState(value).catch((error) => {
        notice = error.message;
      });
    },
    messages: manifest.homeMessages,
    reconnectDelay: config.wiiRemote.reconnectDelayMs * 0.06,
    onSoundInitialize: () => audioSync(menu.getState(), { homeSoundInitialized: true }),
    onSound: (symbol) => void audio.play(symbol),
    onSpeaker: (name, { volume }) =>
      void audio.play(`HOME_SPEAKER_${name.toUpperCase()}`, { gain: volume }),
    onVolume: (value) => {
      homeVolume = value;
    },
    onRumble: (value) => {
      homeRumble = value;
    },
    onClose: () => {
      menu.finishHome();
      homeFadeAlpha = 0;
    },
    onReturn: () => {
      // The native action reboots into BackMenu, not directly into ChannelSelect.
      // Renderer resources are cached; the promise remains an explicit browser
      // readiness boundary instead of pretending to reboot IOS/NAND services.
      restart.start({ ready: renderer.load(layouts.my_BackToWiiMenu) });
      // HOME's native BEGIN_BLACKOUT callback retires every active sound handle.
      audio.resetAllSound();
      audioSync({ ...menu.getState(), screen: 'restarting', overlay: null, transition: null });
      footer.clear();
      focus.clear();
      balloon.clear();
      hover = null;
      settingsKeyboard?.reset();
      settingsDialog?.reset();
      settingsSurface?.close();
      homeFadeAlpha = 0;
    },
  });
  restart = createMenuRestart(layouts.my_BackToWiiMenu, {
    readyFrames: config.startup.restartServiceReadyFrames,
    blackFrames: config.startup.restartBlackFrames,
    onGrid: ({ remainingFrames }) => {
      startedAt = sceneNow - remainingFrames / 0.06;
      entranceHealthShown = false;
      clock = createClock(layouts.my_Clock_a, { region: 'USA', showIntro: true });
      sdButton.reset();
      footer.reset();
      menu.finishHome({ returnToMenu: true });
      audioSync(menu.getState());
    },
    onError: (error) => console.error('Menu restart resource loading failed', error),
  });
  settingsKeyboard = createSettingsKeyboard(layouts, {
    getKeyboardPreferences,
    onKeyboardPreferencesChange,
    messages,
    display,
    predict: dictionaryProvider,
    measureTextLayout: (value, pane, layout) =>
      (fonts.get(layout?.fonts?.[pane.font]) || font).layoutPaneText(value, pane),
    measureText: (value, pane, layout) =>
      (fonts.get(layout?.fonts?.[pane.font]) || font).width(value, pane.fontSize, pane.charSpace),
    onSound: (symbol) => void audio.play(symbol),
    onResult: (result) => settingsSurface?.completeKeyboard(result),
  });
  channels[0].audio = audio.asset('discPreview');
  settingsDialog = createSettingsDialog(layouts, {
    messages,
    onSound: (symbol) => void audio.play(symbol),
    onComplete: (requestId) => settingsSurface?.completeValidation(requestId),
  });
  previewArrows = createArrowInteraction(commonArrowDefinitions(layouts.my_IplTop_e));
  footer = createFooterController(
    layouts.my_IplTop_e,
    layouts.my_IplTopBalloon_a,
    (value, pane) =>
      (fonts.get(layouts.my_IplTopBalloon_a.fonts[pane.font]) || font).width(
        value,
        pane.fontSize,
        pane.charSpace,
      ),
    {
      display,
      messages,
      onSound: (sound) => {
        void audio.play(sound);
      },
    },
  );
  const localStateReads = await Promise.allSettled([
    readStorageState(), readStorageFixture(), readMessageFixture(), readLocalLetterOutbox(),
  ]);
  let storageState = localStateReads[0].status === 'fulfilled'
    ? localStateReads[0].value : defaultStorageState();
  const storageFixture = resolveStorageFixture(localStateReads[1].status === 'fulfilled'
    ? localStateReads[1].value : defaultStorageFixture(), channels);
  const messageFixture = localStateReads[2].status === 'fulfilled'
    ? localStateReads[2].value : defaultMessageFixture();
  const localOutbox = localStateReads[3].status === 'fulfilled'
    ? localStateReads[3].value : [];
  const localStateWarnings = localStateReads.filter((result) => result.status === 'rejected')
    .map((result) => result.reason.message);
  if (storageFixture.missingChannelIds.length) {
    localStateWarnings.push(`Unavailable local SD channel mappings: ${storageFixture.missingChannelIds.join(', ')}`);
  }
  if (localStateWarnings.length) notice = localStateWarnings.join('\n');
  let storageSaveQueue = Promise.resolve();
  function persistStorageState() {
    const snapshot = structuredClone(storageState);
    storageSaveQueue = storageSaveQueue.then(() => saveStorageState(snapshot)).catch((error) => {
      notice = error.message;
    });
  }
  sdMenu = createSDMenu(layouts, {
    display,
    messages,
    state: storageState.sd,
    channels: storageFixture.sdSlots,
    mediaStatus: storageFixture.sd.status,
    onStateChange(sd) {
      storageState = { ...storageState, sd };
      persistStorageState();
    },
    onAction(action) {
      if (action === 'sd-channel-selected')
        notice = 'SD channel launching is unavailable.\nYou can preview its icon here.';
    },
    measure: (value, pane) =>
      (fonts.get(layouts['balloon/my_IplTopBalloon_a'].fonts[pane.font]) || font).width(
        value,
        pane.fontSize,
        pane.charSpace,
      ),
    onNavigate: () =>
      sceneFader.start(() => {
        menu.back();
        sdButton.reset();
      }),
    onSound: (sound) => {
      void audio.play(sound);
    },
  });
  let memos = [...await readMessageBoard(), ...localOutbox];
  if (!memos.length && !readLocalValue('wii-menu.memo-file-migrated', false)) {
    memos = readLocalValue('wii-menu.memos', []);
  }
  const { unavailablePhotoIds, unavailableThumbnailIds } = await preloadIncomingLetterAssets(
    memos,
    (src) => renderer.loadTexture(src),
  );
  if (unavailablePhotoIds.size || unavailableThumbnailIds.size) {
    notice = 'Some local Letter photos could not be loaded. Reimport their verified local assets.';
  }
  let contacts = [];
  try {
    contacts = readContacts();
  } catch (error) {
    // The contact store remains unwritable until a valid read establishes its baseline.
    notice = error.message;
  }
  scenes = createMenuScenes(layouts, {
    getKeyboardPreferences,
    onKeyboardPreferencesChange,
    channels,
    storageFixture,
    localRegistration: messageFixture.localRegistration,
    ownWiiNumber: messageFixture.ownWiiNumber,
    letterService: messageFixture.letterService,
    unavailablePhotoIds,
    unavailableThumbnailIds,
    onLetter: saveLocalLetter,
    onEraseLetter(id) {
      return queueMemoMutation(() => eraseIncomingLetter(id));
    },
    onEraseMemo(id) {
      return queueMemoMutation(() => eraseMemo(id));
    },
    onBoardError(error) {
      notice = error.message;
    },
    onBoardReady() {
      footer.stopNewMail();
    },
    onLetterError(error) {
      notice = error.message;
    },
    sdChannels: storageFixture.sdChannels,
    storageTabs: storageState.tabs,
    onStorageTabChange(kind, tab) {
      storageState = { ...storageState, tabs: { ...storageState.tabs, [kind]: tab } };
      persistStorageState();
    },
    display,
    messages,
    predict: dictionaryProvider,
    draft: String(readLocalValue('wii-menu.memo-draft', '')),
    onDraft: (value) => writeLocalValue('wii-menu.memo-draft', value),
    contacts,
    onContacts: saveContacts,
    onContactsError(error) {
      notice = error.message;
    },
    memos,
    onMemos: (value) => {
      const save = prepareMessageBoardSave(value);
      void queueMemoMutation(save)
        .then((saved) => writeLocalValue('wii-menu.memos', saved))
        .catch((error) => {
          notice = error.message;
        });
    },
    onSound: playSceneSound,
    measureText: (value, pane, layout) =>
      (fonts.get(layout?.fonts?.[pane.font]) || font).width(value, pane.fontSize, pane.charSpace),
    measureTextLines: (value, pane, layout) =>
      (fonts.get(layout?.fonts?.[pane.font]) || font).layoutPaneText(value, pane).lines.length,
    measureTextLayout: (value, pane, layout) =>
      (fonts.get(layout?.fonts?.[pane.font]) || font).layoutPaneText(value, pane),
    onNavigate: (destination) => {
      if (destination === 'grid') {
        if (menu.getState().screen === 'settings') sceneFader.start(() => menu.back());
        else menu.back();
      } else if (destination === 'system-settings')
        sceneFader.start(() => openSystemSettings(manifest.settings));
    },
    onAction: (action) => {
      if (action === 'network-settings' || action === 'wc24-settings') {
        const directory = manifest.settings.defaultEntryPoint.replace(/[^/]+$/, '');
        const page =
          action === 'network-settings' ? 'Internet/Internet_index.html' : 'index02.html';
        sceneFader.start(() => openSystemSettings(manifest.settings, directory + page, true));
      }
    },
  });
  if (!readLocalValue('wii-menu.memo-file-migrated', false)) {
    const saved = await queueMemoMutation(prepareMessageBoardSave(scenes.getMemos()));
    writeLocalValue('wii-menu.memos', saved);
    writeLocalValue('wii-menu.memo-file-migrated', true);
  }
  audioSync = createMenuAudioSync(audio, {
    onPreviewStart: (_index, { navigated, moduleLeadFrames }) => {
      previewStartedAt = sceneNow;
      previewModuleLead = moduleLeadFrames;
      if (!navigated) {
        previewArrowsStartedAt = sceneNow;
        previewArrows.reset();
      }
    },
  });
  let wasLocked = false;
  menu.subscribe((state) => {
    if (['select', 'back'].includes(state.transition?.kind) && state.transition.elapsed === 0)
      pendingZoomCapture = true;
    if (state.transition?.kind === 'preview' && state.transition.elapsed === 0) {
      previewArrows.press(state.transition.direction < 0 ? 'prev' : 'next');
    } else if (state.screen !== 'preview') previewArrows.reset();
    if (state.locked) {
      focus.clear();
      balloon.clear();
    } else if (wasLocked && state.screen === 'grid' && hover?.startsWith('channel-')) {
      const index = Number(hover.slice(8));
      focus.target(index);
      balloon.target(index);
    }
    wasLocked = state.locked;
    if (startupComplete && !restart?.active) audioSync(state);
  });
  installInput();
  const autoplay = audio.attemptAutoplay();
  for (const channel of channels)
    if (channel.audio) void audio.preloadChannel(channel.id, channel.audio);
  status.hidden = true;
  if (!health.active) {
    if (autoplay || !audio.getStatus().supported || config.audio.muted) finishStartup();
    else {
      const button = document.createElement('button');
      button.textContent = 'Start Wii Menu';
      button.addEventListener('click', beginFromGesture);
      status.replaceChildren(button);
      status.hidden = false;
    }
  }
  now = startedAt = sceneNow = 0;
  requestAnimationFrame(render);
}

function installInput() {
  screen.addEventListener('pointermove', (event) => {
    if (restart.active) return;
    if (heldTextArrow) {
      const target = interactive.find((item) => item.id === heldTextArrow.controlId);
      if (!pointInside(pointer, target?.rect)) {
        releaseTextArrow();
        setHover(null);
      }
    }
    if (memoPointer && !menu.getState().overlay) {
      if (
        !memoPointer.active &&
        Math.hypot(pointer.x - memoPointer.start.x, pointer.y - memoPointer.start.y) > 3
      ) {
        memoPointer.active = scenes.pointerDown(memoPointer.id, centeredPoint(memoPointer.start));
        if (memoPointer.active) screen.setPointerCapture(event.pointerId);
      }
      if (memoPointer.active) scenes.pointerMove(centeredPoint(pointer));
    }
    updateArrowHover();
    updateDragTarget();
  });
  screen.addEventListener('pointerleave', () => {
    releaseTextArrow();
    if (grabPointerId !== null || memoPointer?.active) return;
    pointer.visible = false;
    setHover(null);
  });
  screen.addEventListener('contextmenu', (event) => event.preventDefault());
  screen.addEventListener('auxclick', (event) => event.preventDefault());
  screen.addEventListener(
    'pointerdown',
    (event) => {
      releaseTextArrow();
      suppressedArrowClick = null;
      void audio.unlock();
      if (!startupComplete) {
        beginFromGesture();
        return;
      }
      const state = menu.getState();
      if (sceneFader.active || restart.active) return;
      if (event.button === 2 && !state.overlay && !notice) {
        const point = screenPoint(
          display,
          screen.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        );
        const target = keyboardSecondaryTarget(point, interactive);
        const owner = target?.prefix === 'settings-keyboard-' ? settingsKeyboard : scenes;
        if (target && owner.activate(target.id, { secondary: true })) {
          event.preventDefault();
          return;
        }
      }
      if (event.button === 0 && !state.overlay && !notice) {
        const point = screenPoint(
          display,
          screen.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        );
        const { control, selected } = routeKeyboardTextPointer(point, interactive, (location) =>
          settingsKeyboard.active
            ? settingsKeyboard.selectTextAt(location)
            : state.screen === 'board' && scenes.selectTextAt(location),
        );
        if (selected) {
          event.preventDefault();
          return;
        }
        const owner = settingsKeyboard.active ? settingsKeyboard : scenes;
        const prefix = settingsKeyboard.active ? 'settings-keyboard-' : 'scene-';
        if (control && !control.disabled && control.id.startsWith(prefix) &&
            owner.holdControl(control.id.slice(prefix.length))) {
          heldTextArrow = { owner, pointerId: event.pointerId, controlId: control.id };
          suppressedArrowClick = control.id;
          screen.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }
      }
      if (
        state.screen === 'board' &&
        !state.overlay &&
        !state.locked &&
        !notice &&
        (event.button === 0 || config.input.grabButtons.includes(event.button))
      ) {
        const point = screenPoint(
          display,
          screen.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        );
        const card = interactive.find(
          (item) => item.id.startsWith('scene-memo-open-') && pointInside(point, item.rect),
        );
        if (card) {
          suppressMemoClick = false;
          memoPointer = {
            id: card.id.slice(6),
            pointerId: event.pointerId,
            start: point,
            active: false,
          };
          if (event.button !== 0) {
            memoPointer.active = scenes.pointerDown(memoPointer.id, centeredPoint(point));
            if (memoPointer.active) screen.setPointerCapture(event.pointerId);
            event.preventDefault();
          }
        }
      }
      if (
        !menuEntranceSample((sceneNow - startedAt) * 0.06, {
          healthShown: entranceHealthShown,
        }).complete
      )
        return;
      if (
        !config.input.grabButtons.includes(event.button) ||
        state.screen !== 'grid' ||
        state.locked ||
        state.overlay ||
        notice
      )
        return;
      const point = screenPoint(
        display,
        screen.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      const target = slotRects.find(
        ({ rect }) =>
          point.x >= rect.x &&
          point.x <= rect.x + rect.w &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.h,
      );
      if (target && drag.start(target.index, state.channels, point)) {
        event.preventDefault();
        grabPointerId = event.pointerId;
        screen.setPointerCapture(event.pointerId);
        focus.clear();
        balloon.clear();
        void audio.play('grab');
        channelSoundPoint = null;
        void audio.startLoop('drag', { gain: 0 });
      }
    },
    { capture: true },
  );
  screen.addEventListener('pointerup', (event) => {
    if (heldTextArrow?.pointerId === event.pointerId) {
      releaseTextArrow();
      event.preventDefault();
      return;
    }
    if (memoPointer?.pointerId === event.pointerId) {
      if (memoPointer.active) {
        const point = screenPoint(
          display,
          screen.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        );
        scenes.pointerUp(centeredPoint(point));
        suppressMemoClick = true;
        if (screen.hasPointerCapture(event.pointerId))
          screen.releasePointerCapture(event.pointerId);
        event.preventDefault();
      }
      memoPointer = null;
    }
    if (event.pointerId !== grabPointerId) return;
    audio.stopLoop('drag');
    updateDragTarget();
    const sound = drag.release(menu.getState().channels, { scrolling: menu.getState().locked });
    focus.clear();
    if (sound) void audio.play(sound);
    if (screen.hasPointerCapture(event.pointerId)) screen.releasePointerCapture(event.pointerId);
    grabPointerId = null;
    event.preventDefault();
  });
  screen.addEventListener('pointercancel', () => {
    releaseTextArrow();
    scenes.cancelPointer();
    memoPointer = null;
    drag.cancel();
    audio.stopLoop('drag');
    grabPointerId = null;
  });
  window.addEventListener('blur', () => {
    releaseTextArrow();
    scenes.suspendAudio();
    settingsKeyboard?.keyInput('', { type: 'blur' });
    scenes.keyInput('', { type: 'blur' });
    scenes.cancelPointer();
    memoPointer = null;
    if (grabPointerId !== null) {
      drag.cancel();
      audio.stopLoop('drag');
      grabPointerId = null;
    }
  });
  window.addEventListener('keydown', (event) => {
    void audio.unlock();
    if (!startupComplete) {
      if (['Enter', ' ', 'a', 'A', 'Escape'].includes(event.key)) {
        event.preventDefault();
        beginFromGesture();
      }
      return;
    }
    const state = menu.getState();
    if (sceneFader.active || restart.active) return;
    if (state.overlay && home.keyInput(event.key, { type: 'keydown' })) {
      event.preventDefault();
      return;
    }
    const isHomeKey = config.input.homeKeys.some(
      (key) => key.toLowerCase() === event.key.toLowerCase(),
    );
    if (settingsDialog?.active && !state.overlay && !isHomeKey) {
      event.preventDefault();
      return;
    }
    if (settingsKeyboard?.active && !state.overlay && !notice) {
      const handled = settingsKeyboard.keyInput(event.key, {
        type: 'keydown',
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        capsLock: event.getModifierState?.('CapsLock'),
        repeat: event.repeat,
      });
      if (handled) event.preventDefault();
      if (handled || event.key !== 'Home') return;
    }
    if (
      state.screen === 'board' &&
      !state.overlay &&
      !notice &&
      (!settingsFrame || settingsFrame.hidden) &&
      scenes.keyInput(event.key, {
        type: 'keydown',
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        capsLock: event.getModifierState?.('CapsLock'),
        repeat: event.repeat,
      })
    ) {
      event.preventDefault();
      return;
    }
    if (
      !menuEntranceSample((sceneNow - startedAt) * 0.06, {
        healthShown: entranceHealthShown,
      }).complete
    )
      return;
    const homeBack = () => home.back();
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      if (event.repeat) return;
      if (memoPointer) {
        scenes.cancelPointer();
        if (screen.hasPointerCapture(memoPointer.pointerId))
          screen.releasePointerCapture(memoPointer.pointerId);
        memoPointer = null;
      } else if (drag.getState()) {
        drag.cancel();
        audio.stopLoop('drag');
      } else if (notice) notice = '';
      else if (state.overlay) homeBack();
      else if (state.screen === 'sd') sdMenu.back();
      else if (['settings', 'board'].includes(state.screen)) {
        const ownsSound = state.screen === 'board' && !scenes.snapshot().boardChild;
        const wentBack =
          settingsFrame && !settingsFrame.hidden ? closeSystemSettings() : scenes.back();
        if (wentBack && !ownsSound) void audio.play('cancel');
      } else if (menu.back()) void audio.play('back');
    } else if (config.input.homeKeys.some((key) => key.toLowerCase() === event.key.toLowerCase())) {
      event.preventDefault();
      if (event.repeat || drag.getState() || memoPointer?.active) return;
      if (state.overlay) homeBack();
      else {
        openHomeMenu();
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (state.overlay || (settingsFrame && !settingsFrame.hidden)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      if (state.screen === 'sd') {
        sdMenu.activate(direction < 0 ? 'prev' : 'next');
        return;
      }
      if (state.screen === 'board') {
        const ownsSound = !scenes.snapshot().boardChild;
        if (scenes.activate(direction < 0 ? 'prev' : 'next') && !ownsSound) void audio.play('page');
        return;
      }
      const moved =
        state.screen === 'preview' ? menu.changePreview(direction) : menu.changePage(direction);
      if (moved) void audio.play('page');
    } else if (event.key.toLowerCase() === 'm') audio.setMuted(!audio.getStatus().muted);
  });
  window.addEventListener('keyup', (event) => {
    const state = menu.getState();
    if (state.overlay && home.keyInput(event.key, { type: 'keyup' })) {
      event.preventDefault();
      return;
    }
    if (settingsKeyboard?.active && !state.overlay) {
      settingsKeyboard.keyInput(event.key, {
        type: 'keyup',
        code: event.code,
        shiftKey: event.shiftKey,
        capsLock: event.getModifierState?.('CapsLock'),
      });
      return;
    }
    if (state.screen === 'board' && !state.overlay && (!settingsFrame || settingsFrame.hidden))
      scenes.keyInput(event.key, {
        type: 'keyup',
        code: event.code,
        shiftKey: event.shiftKey,
        capsLock: event.getModifierState?.('CapsLock'),
      });
  });
}

init().catch((error) => {
  console.error(error);
  status.hidden = false;
  status.textContent =
    'Wii Menu could not start.\nPrepare your WAD and check config.json, then reload.\n\n' +
    error.message;
});
