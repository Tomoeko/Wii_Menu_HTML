import { indexLayout, poseLayout } from './animation.js';
import { standardDisplay } from './display.js';
import { commonArrowDefinitions, createArrowInteraction, isArrowId } from './arrow-interaction.js';

// Button::scBtnFadeFrame. These endpoints are independent of the BRLAN length.
const BUTTONS = {
  board: {
    pane: 'B_Bbs',
    group: 'G_Bbs',
    enter: 900,
    leave: 930,
    message: 15,
    label: 'Wii Message Board',
  },
  settings: {
    pane: 'B_Set',
    group: 'G_Set',
    enter: 6900,
    leave: 6930,
    message: 14,
    label: 'Wii Options',
  },
  'board-back': {
    pane: 'B_Ch',
    group: 'G_Ch',
    enter: 5900,
    leave: 5930,
    message: 16,
    label: 'Wii Menu',
  },
  calendar: {
    pane: 'B_Cal',
    group: 'G_Cal',
    enter: 1900,
    leave: 1930,
    message: 17,
    label: 'Calendar',
  },
  create: {
    pane: 'B_Add',
    group: 'G_Add',
    enter: 3900,
    leave: 3930,
    message: 18,
    label: 'Create Message',
  },
  sd: { pane: 'Ac', message: 161, label: 'SD Card Menu', margin: [200, 110] },
  'sd-back': { pane: 'B_Wiimenu', message: 168, label: 'Wii Menu' },
  'sd-help': { pane: 'B_Help', message: 166, label: 'SD Card Menu Help' },
  prev: { pane: 'B_ArwL' },
  next: { pane: 'B_ArwR' },
};

/** Common TextBalloon waits 17 updates (postincrement >15), then plays six
 * intervals from its seven-frame BRLAN. Leaving reverses the current frame.
 * anchors maps IDs to the original button's global {x,y} translation.
 */
export function createFooterBalloons(
  source,
  measure,
  { display = standardDisplay, messages = {}, onSound = () => {} } = {},
) {
  const animation = source.animations.my_IplTopBalloon_a_BalloonInOut;
  const end = animation.frames - 1;
  const textPane = indexLayout(source).panes.get('T_Balloon');
  const messageMap = messages.messages || messages;
  const items = new Map();
  let hovered = null;
  const api = {
    target(id) {
      if (!BUTTONS[id]?.message) id = null;
      if (id === hovered) return;
      const old = items.get(hovered);
      if (old) {
        if (old.phase === 'wait') items.delete(hovered);
        else old.phase = 'leave';
      }
      hovered = id;
      if (id !== null) items.set(id, { phase: 'wait', wait: 0, frame: 0, anchor: null });
    },
    advance(frames) {
      for (const [id, item] of items) {
        if (item.phase === 'wait') {
          item.wait += frames;
          if (item.wait < 17) continue;
          item.phase = 'enter';
          item.frame = Math.min(end, item.wait - 17);
          onSound('balloon');
        } else if (item.phase === 'enter') item.frame = Math.min(end, item.frame + frames);
        else if (item.phase === 'leave') {
          item.frame = Math.max(0, item.frame - frames);
          if (item.frame === 0) items.delete(id);
        }
      }
    },
    poses(anchors = {}) {
      const result = [];
      for (const [id, item] of items) {
        const anchor = anchors instanceof Map ? anchors.get(id) : anchors[id];
        if (anchor) item.anchor = anchor;
        if (item.phase === 'wait' || !item.anchor) continue;
        const button = BUTTONS[id];
        let title = messageMap[button.message] ?? button.label;
        if (!id.startsWith('sd-')) {
          while ((title.length > 20 || measure(title, textPane) > 390.32) && title.length > 3)
            title = title.replace(/\.{3}$/, '').slice(0, -1) + '...';
        }
        const width = Math.max(160 * display.rootScaleX, measure(title, textPane) + 40);
        const margin = (button.margin || [120, 30])[display.wide ? 0 : 1];
        const x = Math.max(
          -display.halfWidth + margin + width / 2,
          Math.min(display.halfWidth - margin - width / 2, item.anchor.x),
        );
        const layout = poseLayout(source, [{ animation, frame: item.frame, loop: false }]);
        const { panes } = indexLayout(layout);
        panes.get('W_Base').size[0] = width;
        panes.get('W_Shade').size[0] = width;
        panes.get('T_Balloon').text = title;
        // Preserve N_Balloon's location-adjust flag. Its parent applies the
        // original aspect scale after TextBalloon::set_translate's clamp.
        panes.get('N_Balloon').translation = [x, item.anchor.y + 50, 0];
        panes.get('N_Balloon').flags |= 1;
        result.push({ id, layout, title });
      }
      return result;
    },
    clear() {
      hovered = null;
      items.clear();
    },
  };
  return api;
}

/** Button::startMailNumAnm uses 1–400; new arrival uses 1–160.
 * Group binding follows hover so its stopped pose hides the spare envelope. */
export function messageBadgePose(source, { count = 0, age = 0, newMailFrame = null } = {}) {
  const animation = source.animations.my_IplTop_e;
  const value = Math.max(0, Math.min(99, Math.trunc(count)));
  const layout = poseLayout(source, [
    {
      animation,
      group: 'G_BbsSignal',
      frame: value ? 1 + (age % 399) : 0,
      loop: false,
    },
    {
      animation,
      group: 'G_BbsSignal_new',
      frame: newMailFrame === null ? 0 : Math.min(160, 1 + newMailFrame),
      loop: false,
    },
  ]);
  const pane = indexLayout(layout).panes.get('T_BbsMark1');
  if (pane && value) pane.text = String(value);
  return layout;
}

/** Source footer hover groups; sceneFrame is the caller's scene-change pose. */
export function createFooterController(source, balloonSource, measure, options = {}) {
  const balloons = createFooterBalloons(balloonSource, measure, options);
  const states = new Map();
  const arrows = createArrowInteraction(commonArrowDefinitions(source));
  let newMailActive = false,
    newMailAge = 0;
  let hovered = null;
  let age = 0;
  const arrowVisibility = new Map();
  const api = {
    reset() {
      age = 0;
      hovered = null;
      newMailActive = false;
      newMailAge = 0;
      states.clear();
      arrows.reset();
      arrowVisibility.clear();
      balloons.clear();
    },
    hover(id) {
      if (!BUTTONS[id]) id = null;
      if (id === hovered) return;
      if (hovered && !isArrowId(hovered)) states.set(hovered, { entering: false, frame: 0 });
      hovered = id;
      arrows.hover(isArrowId(id) ? id : null);
      if (id) {
        if (!isArrowId(id)) states.set(id, { entering: true, frame: 0 });
        options.onSound?.('buttonHover');
      }
      balloons.target(id);
    },
    press(id) {
      return arrows.press(id);
    },
    stopNewMail() {
      // Board::stt_wait_child_dst clears Button's active flag when the
      // departing ChannelSelect child is gone (0x813907A0, 0x8139D1E4).
      // This lifetime change must not depend on drawing the grid footer.
      newMailActive = false;
      newMailAge = 0;
    },
    setArrows(visible) {
      for (const id of ['prev', 'next']) {
        const next = Boolean(visible[id]);
        const previous = arrowVisibility.get(id);
        if (previous?.visible === next) continue;
        arrowVisibility.set(id, { visible: next, start: previous ? age : age - 10 });
        if (!next && arrows.hovered === id) api.hover(null);
      }
    },
    arrowClips() {
      const animation = source.animations.my_IplTop_e;
      return [...arrowVisibility].map(([id, state]) => ({
        animation,
        group: id === 'prev' ? 'G_ArwL_End' : 'G_ArwR_End',
        frame: (state.visible ? 10150 : 10100) + Math.min(10, age - state.start),
        loop: false,
      }));
    },
    advance(frames) {
      age += frames;
      arrows.advance(frames);
      if (newMailActive) {
        newMailAge += frames;
        if (newMailAge >= 180) {
          newMailAge %= 180;
          options.onSound?.('WIPL_SE_NEW_ARRIVAL');
        }
      }
      for (const state of states.values()) state.frame += frames;
      balloons.advance(frames);
    },
    pose({ sceneFrame = 0, messageCount = 0, newMail = false } = {}) {
      if (newMail !== newMailActive) {
        newMailActive = newMail;
        newMailAge = 0;
        if (newMail) options.onSound?.('WIPL_SE_NEW_ARRIVAL');
      }
      const animation = source.animations.my_IplTop_e;
      const clips = [
        { animation, frame: sceneFrame, group: 'G_SeenChange', loop: false },
        {
          animation,
          frame: 10000 + (age % 55),
          group: 'G_ArwRoop',
          loop: false,
        },
      ];
      for (const [id, state] of states) {
        const button = BUTTONS[id];
        if (!button.group) continue;
        const duration = state.entering ? (button.enterFrames ?? 6) : (button.leaveFrames ?? 8);
        clips.push({
          animation,
          frame: (state.entering ? button.enter : button.leave) + Math.min(duration, state.frame),
          group: button.group,
          loop: false,
        });
      }
      clips.push(...api.arrowClips(), ...arrows.clips());
      return messageBadgePose(poseLayout(source, clips), {
        count: messageCount,
        age,
        newMailFrame: newMail ? newMailAge : null,
      });
    },
    balloons: (anchors) => balloons.poses(anchors),
    clear() {
      api.hover(null);
      balloons.clear();
    },
    get hovered() {
      return hovered;
    },
  };
  return api;
}
