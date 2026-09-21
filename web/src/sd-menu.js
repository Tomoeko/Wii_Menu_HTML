import { indexLayout, poseLayout } from './animation.js';
import { sourceAnchorMatrices } from './channel-zoom.js';
import { paneForDisplay, standardDisplay } from './display.js';
import { createFooterBalloons } from './footer-controller.js';
import { createSDHelp, SD_HELP_LAYOUTS } from './sd-help.js';
import { createSDLoading, SD_LOADING_LAYOUTS } from './sd-loading.js';
import { ARROW_IDS, arrowClip, createArrowInteraction, isArrowId } from './arrow-interaction.js';
import { poseChannel } from './channel-animation.js';
import { createChannelFocus } from './channel-focus.js';
import {
  defaultStorageState, validateStorageState, mediaErrorMessage, MEDIA_STATUSES, SD_SLOT_COUNT,
} from './storage-state.js';

export const SD_MENU_LAYOUTS = [
  'mn_SdcardMenu_a',
  'mn_SdcardMenu_b',
  'mn_SdcardMenu_d',
  'mn_SdcardMenu_Page',
  'my_IplTop_d',
  'balloon/my_IplTopBalloon_a',
  ...SD_HELP_LAYOUTS,
  ...SD_LOADING_LAYOUTS,
];
const FOOTER = {
  back: { pane: 'B_Wiimenu', group: 'G_BL', stem: 'Btn_Wiimenu', label: 'Wii Menu' },
  help: { pane: 'B_Help', group: 'G_BR', stem: 'Btn_Help', label: 'SD Card Menu Help' },
  prev: { pane: 'B_ArwL', group: 'G_ArwL_Focus', stem: 'ArwL', label: 'Previous page' },
  next: { pane: 'B_ArwR', group: 'G_ArwR_Focus', stem: 'ArwR', label: 'Next page' },
};
const MASKS = new Set(Array.from({ length: 5 }, (_, i) => `BaseMask${i}`));
export const SD_VISITED_KEY = 'wii-menu.sd-help-seen';
function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

// SDChannelSelect::createLayout at USA4.3 0x813DE9FC performs these exact
// texture substitutions; the donor panes remain outside the visible scene.
function prepareGrid(source, display) {
  if (!display.wide) return source;
  const layout = poseLayout(source);
  const { panes } = indexLayout(layout);
  for (const [donor, targets] of [
    ['ChangeTex16x9', ['Picture_00', 'Picture_01', 'Picture_02', 'Picture_03', 'Picture_04']],
    ['Picture_16', ['Edge0', 'Edge1', 'Edge2', 'Edge3', 'Edge4']],
  ]) {
    const mapping = layout.materials[panes.get(donor).material].textureMaps[0];
    for (const name of targets)
      layout.materials[panes.get(name).material].textureMaps[0] = { ...mapping };
  }
  return layout;
}

/** Explicit local SD fixture using SDChannelSelect's own resources and twenty
 * pages. The application owns the shared black fader. Call open at its black
 * handoff and onNavigate('grid') starts the source return fade immediately.
 * Storage import and launching are extension
 * points; this controller never pretends to access an actual SD device.
 */
export function createSDMenu(
  layouts,
  {
    display = standardDisplay,
    messages = {},
    measure = (text) => text.length * 12,
    onNavigate = () => {},
    onAction = () => {},
    onSound = () => {},
    storage = browserStorage(),
    firstVisit,
    isCardReady = () => true,
    channels = [],
    mediaStatus = 'ready',
    state = defaultStorageState().sd,
    onStateChange = () => {},
  } = {},
) {
  const source = prepareGrid(layouts.mn_SdcardMenu_a, display);
  const footerSource = layouts.mn_SdcardMenu_b;
  const messageMap = messages.messages || messages;
  const initialState = validateStorageState({ ...defaultStorageState(), sd: state }).sd;
  if (!MEDIA_STATUSES.includes(mediaStatus) || !Array.isArray(channels)
      || channels.length > SD_SLOT_COUNT) throw new Error('Invalid local SD fixture.');
  const slots = Array.from({ length: SD_SLOT_COUNT }, (_, index) => channels[index] ?? null);
  const populated = slots.some((channel) => channel?.icon);
  const ready = mediaStatus === 'ready';
  const slotIndex = (id) => {
    const match = /^channel-(\d+)$/.exec(id ?? '');
    return match && Number(match[1]) < 12 ? Number(match[1]) : null;
  };
  const channelAt = (id) => {
    const index = slotIndex(id);
    return ready && index !== null ? slots[page * 12 + index] : null;
  };
  const tileFocus = createChannelFocus(layouts.my_IplTop_d);
  let visited = !storage;
  try {
    if (storage) visited = storage.getItem(SD_VISITED_KEY) === 'true';
  } catch {
    visited = false;
  }
  if (initialState.helpSeen !== null) visited = initialState.helpSeen;
  if (firstVisit !== undefined) visited = !firstVisit;
  const saveState = () => onStateChange({ page, helpSeen: visited });
  let welcomePending = false,
    welcomeActive = false;
  const balloons = createFooterBalloons(layouts['balloon/my_IplTopBalloon_a'], measure, {
    display,
    messages,
    onSound,
  });
  let page = initialState.page,
    age = 0,
    hovered = null,
    scroll = null,
    leaving = false,
    helpAge = null,
    help = null,
    loading = null;
  const focus = new Map();
  const arrowAge = { prev: Infinity, next: Infinity };
  const arrowVisible = { prev: ready && page > 0, next: ready && page < 19 };
  const beginLoading = () => createSDLoading(layouts, {
    messages, isReady: isCardReady, hasChannels: ready && populated,
  });
  const arrows = createArrowInteraction(
    Object.fromEntries(
      ARROW_IDS.map((id) => {
        const side = id === 'prev' ? 'L' : 'R';
        const resource = (suffix, group) =>
          arrowClip(footerSource.animations[`mn_SdcardMenu_b_Arw${side}_${suffix}`], group);
        return [
          id,
          {
            focusIn: resource('rollover', `G_Arw${side}_Focus`),
            focusOut: resource('rollout', `G_Arw${side}_Focus`),
            press: resource('on', `G_Arw${side}_Ac`),
          },
        ];
      }),
    ),
  );
  const clip = (stem, suffix, frame, group, loop = false) => {
    const animation = footerSource.animations[`mn_SdcardMenu_b_${stem}_${suffix}`];
    return { animation, frame: loop ? frame : Math.min(frame, animation.frames - 1), group, loop };
  };
  const api = {
    open() {
      age = 0;
      hovered = null;
      scroll = null;
      leaving = false;
      helpAge = null;
      help = null;
      welcomePending = !visited;
      welcomeActive = false;
      loading = visited ? beginLoading() : null;
      focus.clear();
      tileFocus.clear();
      balloons.clear();
      arrows.reset();
      arrowAge.prev = arrowAge.next = Infinity;
      arrowVisible.prev = ready && page > 0;
      arrowVisible.next = ready && page < 19;
    },
    back() {
      return api.activate(help ? 'help-back' : 'back');
    },
    hover(id) {
      if (help) {
        help.hover(id);
        return;
      }
      if ((!FOOTER[id] && !channelAt(id)) || leaving || loading
          || (scroll && !isArrowId(id))) id = null;
      if (isArrowId(id) && !arrowVisible[id]) id = null;
      if (id === hovered) return;
      if (hovered && !isArrowId(hovered)) focus.set(hovered, { entering: false, frame: 0 });
      hovered = id;
      tileFocus.target(channelAt(id) ? page * 12 + slotIndex(id) : null);
      arrows.hover(isArrowId(id) ? id : null);
      if (id) {
        if (!isArrowId(id)) focus.set(id, { entering: true, frame: 0 });
        onSound('buttonHover');
      }
      balloons.target(id === 'back' ? 'sd-back' : id === 'help' ? 'sd-help' : null);
    },
    activate(id) {
      if (help) return help.activate(id);
      if (leaving || scroll || welcomePending || loading) return false;
      if (channelAt(id)) {
        onSound('confirm');
        onAction('sd-channel-selected', { id: channelAt(id).id, changed: false, fixture: true });
        return true;
      }
      if (id === 'back') {
        leaving = true;
        api.hover(null);
        onSound('confirm');
        onNavigate('grid');
        return true;
      }
      if (id === 'help') {
        helpAge = 0;
        api.hover(null);
        balloons.clear();
        onSound('confirm');
        help = createSDHelp(layouts, { messages, onSound });
        onAction('sd-help-open');
        return true;
      }
      const direction = id === 'prev' ? -1 : id === 'next' ? 1 : 0;
      if (!ready || !direction || page + direction < 0 || page + direction >= 20) return false;
      scroll = { direction, frame: 0 };
      tileFocus.target(null);
      arrows.press(id);
      onSound('page');
      return true;
    },
    advance(frames, { revealing = false } = {}) {
      age += frames;
      if (loading) {
        loading.advance(frames);
        if (!loading.active) loading = null;
      }
      if (help) {
        help.advance(frames);
        if (!help.active) {
          help = null;
          if (welcomeActive) {
            visited = true;
            welcomeActive = false;
            try {
              storage?.setItem(SD_VISITED_KEY, 'true');
            } catch {
              /* Keep this visit in memory. */
            }
            saveState();
            // 0x813DDCD8 starts the card worker only after first welcome.
            loading = beginLoading();
          }
          onAction('sd-help-close');
        }
      }
      if (welcomePending && !revealing) {
        welcomePending = false;
        welcomeActive = true;
        help = createSDHelp(layouts, { messages, onSound, firstVisit: true });
        onAction('sd-help-open');
      }
      for (const item of focus.values()) item.frame += frames;
      for (const id of ['prev', 'next']) arrowAge[id] += frames;
      arrows.advance(frames);
      tileFocus.advance(frames);
      if (helpAge !== null) {
        helpAge += frames;
        if (helpAge >= 21) {
          helpAge = null;
          api.hover(null);
        }
      }
      if (scroll) {
        scroll.frame += frames;
        if (scroll.frame >= 20) {
          page += scroll.direction;
          scroll = null;
          saveState();
          for (const id of ['prev', 'next']) {
            const show = id === 'prev' ? page > 0 : page < 19;
            if (show !== arrowVisible[id]) {
              arrowVisible[id] = show;
              arrowAge[id] = 0;
              if (!show && hovered === id) api.hover(null);
            }
          }
        }
      }
      balloons.advance(frames);
    },
    presentation() {
      const frame = scroll ? (scroll.direction > 0 ? 40 : 0) + scroll.frame : 0;
      const grid = poseLayout(source, [
        { animation: source.animations.mn_SdcardMenu_a, frame, loop: false },
      ]);
      const { panes } = indexLayout(grid);
      for (let relative = -2; relative <= 2; relative++) {
        if (page + relative < 0 || page + relative >= 20)
          panes.get(`Edge${relative + 2}`).flags &= ~1;
      }
      const base = poseLayout(grid);
      for (const pane of indexLayout(base).panes.values())
        if (pane.type === 'pic1' && !MASKS.has(pane.name)) pane.flags &= ~1;
      const background = poseLayout(footerSource);
      for (const child of background.root.children)
        if (child.name !== 'background') child.flags &= ~1;
      const layers = [
        { layout: background, prefix: 'sd-background:' },
        { layout: base, prefix: 'sd-grid-base:' },
      ];
      const names = [...panes.keys()].filter((name) => /^N_Ch_[a-e]\d\d$/.test(name));
      const anchors = sourceAnchorMatrices(grid, names, {
        mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
      });
      const tilePositions = new Map();
      for (const anchor of anchors) {
        const relative = 'abcde'.indexOf(anchor.name[5]) - 2;
        const index = Number(anchor.name.slice(-2)) - 1;
        const x = anchor.matrix[4],
          y = anchor.matrix[5];
        if (page + relative < 0 || page + relative >= 20 || Math.abs(x) > display.halfWidth + 85)
          continue;
        const absoluteSlot = (page + relative) * 12 + index;
        const channel = ready ? slots[absoluteSlot] : null;
        const empty = layouts.mn_SdcardMenu_d;
        const clipping = {
          x: x + display.halfWidth - display.thumbnailHalfWidth,
          y: display.halfHeight - y - 48,
          w: display.thumbnailHalfWidth * 2,
          h: 96,
        };
        tilePositions.set(absoluteSlot, { matrix: anchor.matrix, clip: clipping });
        layers.push({
          layout: channel?.icon ? poseChannel(channel, 'icon', age) : poseLayout(empty, [
            { animation: empty.animations.mn_SdcardMenu_d, frame: age % 1999, loop: true },
          ]),
          matrix: anchor.matrix,
          prefix: `sd-${channel?.icon ? 'channel' : 'empty'}-${relative}-${index}:`,
          clip: clipping,
        });
      }
      for (const item of tileFocus.poses()) {
        const position = tilePositions.get(item.index);
        if (position) layers.push({
          layout: item.layout, prefix: `sd-focus-${item.index}:`, ...position,
        });
      }
      layers.push({ layout: grid, prefix: 'sd-grid:', exclude: new Set([...MASKS, 'ChMask']) });
      const pages = sourceAnchorMatrices(grid, ['N_Clock0', 'N_Clock1', 'N_Clock2'], {
        mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
      });
      pages.forEach((anchor, index) => {
        const label = poseLayout(layouts.mn_SdcardMenu_Page);
        label.root.translation = [anchor.matrix[4], anchor.matrix[5], 0];
        const texts = indexLayout(label).panes;
        texts.get('TextBox_00').text = String(page + index);
        texts.get('T_Page00').text = '/20';
        layers.push({ layout: label, prefix: `sd-page-${index}:` });
      });
      const clips = [clip('Arw', 'wating_roop', age, 'G_ArwRoop', true)];
      for (const [id, button] of Object.entries(FOOTER)) {
        if (isArrowId(id)) continue;
        const state = focus.get(id);
        clips.push(
          clip(
            button.stem,
            state && !state.entering ? 'rollout' : 'rollover',
            state?.frame ?? 0,
            button.group,
          ),
        );
      }
      for (const id of ['prev', 'next']) {
        const side = id === 'prev' ? 'L' : 'R';
        clips.push(
          clip(`Arw${side}`, arrowVisible[id] ? 'in' : 'out', arrowAge[id], `G_Arw${side}_End`),
        );
      }
      clips.push(...arrows.clips());
      if (helpAge !== null) clips.push(clip('Btn_Help', 'on', helpAge, 'G_BR'));
      const footer = poseLayout(footerSource, clips);
      indexLayout(footer).panes.get('T_page').text = messageMap[160] ?? 'SD Card Menu';
      layers.push({ layout: footer, prefix: 'sd-footer:', exclude: new Set(['background']) });
      const balloonAnchors = {};
      for (const anchor of sourceAnchorMatrices(footer, ['B_Wiimenu', 'B_Help'], {
        mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
      }))
        balloonAnchors[anchor.name === 'B_Wiimenu' ? 'sd-back' : 'sd-help'] = {
          x: anchor.matrix[4],
          y: anchor.matrix[5],
        };
      for (const item of balloons.poses(balloonAnchors))
        layers.push({ layout: item.layout, prefix: `sd-balloon-${item.id}:` });
      if (help) {
        const dialog = help.presentation();
        return {
          layers: [...layers, ...dialog.layers],
          page,
          pageCount: 20,
          locked: dialog.locked,
          controls: dialog.controls,
        };
      }
      if (loading) {
        const dialog = loading.presentation();
        return { ...dialog, layers: [...layers, ...dialog.layers], page, pageCount: 20 };
      }
      if (!ready) {
        const error = layouts.mn_Nocard;
        const layout = poseLayout(error, [{
          animation: error.animations.mn_Nocard_IN,
          frame: error.animations.mn_Nocard_IN.frames,
          group: 'Group_00',
        }]);
        const errorPanes = indexLayout(layout).panes;
        errorPanes.get('T_TimerMes').text = mediaErrorMessage(mediaStatus, { messages });
        errorPanes.get('T_TimerMes_01').flags &= ~1;
        errorPanes.get('Wait').flags &= ~1;
        layers.push({ layout, prefix: 'sd-error:' });
      }
      return {
        layers,
        page,
        pageCount: 20,
        locked: leaving || Boolean(scroll) || welcomePending,
        controls: [...Object.entries(FOOTER)
          .filter(([id]) => !['prev', 'next'].includes(id) || arrowVisible[id])
          .map(([id, button]) => ({ id, ...button, prefix: 'sd-footer:' })),
        ...Array.from({ length: 12 }, (_, index) => ({ index, channel: channelAt(`channel-${index}`) }))
          .filter(({ channel }) => channel?.icon)
          .map(({ index, channel }) => ({
            id: `channel-${index}`, label: channel.title,
            pane: `N_Ch_c${String(index + 1).padStart(2, '0')}`, prefix: 'sd-grid:',
          }))],
      };
    },
    getState() {
      return { page, scrolling: Boolean(scroll), leaving, loading: loading?.getState() ?? null,
        mediaStatus, channelCount: ready ? slots.filter((channel) => channel?.icon).length : 0 };
    },
  };
  return api;
}
