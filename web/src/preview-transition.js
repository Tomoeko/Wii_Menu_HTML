// ChannelTitle::startChangeChannel/calcNormalChangeWait/calcNormalChangeNext.
// Each original ChangeIn/ChangeOut BRLAN has 11 frames. IPL's forward
// Animator stops at GetFrameSize()-1, so preloaded resources need 10+10 ticks.
import { indexLayout, poseLayout } from './animation.js';

export const PREVIEW_CHANGE = Object.freeze({ inFrames: 10, outFrames: 10 });
export const PREVIEW_CHANGE_DURATION =
  ((PREVIEW_CHANGE.inFrames + PREVIEW_CHANGE.outFrames) * 1000) / 60;
export const PREVIEW_ARROW_EXIT_UPDATES = 10;

/** The preview may already have changed menu.screen to grid when Back starts. */
export function previewArrowAvailability(channels, selectedIndex) {
  const hasNeighbor = channels.some((channel, index) =>
    index !== selectedIndex && channel && channel.disabled !== true);
  return { prev: hasNeighbor, next: hasNeighbor };
}

/** ChannelTitle reuses the full-size common Button arrows. Their End groups
 * move independently of the zoom camera and hold the WAD's source geometry.
 */
export function posePreviewArrows(source, {
  phase = 'enter',
  frame = PREVIEW_ARROW_EXIT_UPDATES,
  loopFrame = 0,
  available = { prev: true, next: true },
  focusClips = [],
} = {}) {
  if (!['enter', 'exit'].includes(phase)) throw new RangeError('Invalid preview arrow phase.');
  const animation = source.animations.my_IplTop_e;
  const endFrame = (phase === 'exit' ? 10100 : 10150) +
    Math.min(PREVIEW_ARROW_EXIT_UPDATES, Math.max(0, frame));
  const clips = [
    { animation, frame: 0, loop: false },
    { animation, frame: 10000 + (loopFrame % 55), group: 'G_ArwRoop', loop: false },
    { animation, frame: endFrame, group: 'G_ArwL_End', loop: false },
    { animation, frame: endFrame, group: 'G_ArwR_End', loop: false },
    ...focusClips,
  ];
  const exclude = new Set(
    [...indexLayout(source).panes.keys()].filter((name) =>
      /^N_Btn[RL]_a/.test(name) || name === 'N_Dust'),
  );
  if (!available.prev) exclude.add('N_ArwL');
  if (!available.next) exclude.add('N_ArwR');
  return { layout: poseLayout(source, clips), exclude };
}

/** USA4.3 button handler 0x813BAC50 requests BT_PUSH before entering the
 * reverse-zoom path, which requests CH_UNSELECT at 0x813B7784. */
export function activatePreviewReturn(menu, onSound) {
  if (!menu.back()) return false;
  onSound('WIPL_SE_BT_PUSH');
  onSound('WIPL_SE_CH_UNSELECT');
  return true;
}

/** The selected slot changes immediately; the displayed banner changes later. */
export function previewPresentation(state) {
  const transition = state.transition;
  if (transition?.kind !== 'preview')
    return { index: state.selectedIndex, phase: 'normal', frame: 0 };
  const frame = transition.progress * (PREVIEW_CHANGE.inFrames + PREVIEW_CHANGE.outFrames);
  return frame < PREVIEW_CHANGE.inFrames
    ? { index: transition.from.selectedIndex, phase: 'in', frame }
    : {
        index: state.selectedIndex,
        phase: 'out',
        frame: Math.min(PREVIEW_CHANGE.outFrames, frame - PREVIEW_CHANGE.inFrames),
      };
}

/** Source binds Change nonrecursively, not the unrelated button tracks. */
export function previewChangeClip(source, presentation) {
  if (presentation.phase === 'normal') return null;
  const animation =
    source.animations[`my_ChTop_a_Change${presentation.phase === 'in' ? 'In' : 'Out'}`];
  return animation
    ? {
        animation: {
          ...animation,
          targets: animation.targets.filter((target) => target.name === 'Change'),
        },
        frame: presentation.frame,
        loop: false,
      }
    : null;
}

export function previewStartButtonClip(source, state, presentation) {
  const enabled = state.channels[presentation.index]?.id !== 'disc';
  const wasEnabled = state.channels[state.transition?.from.selectedIndex]?.id !== 'disc';
  const changing = presentation.phase === 'out' && enabled !== wasEnabled;
  const name = changing && !enabled ? 'my_ChTop_a_OffBtn' : 'my_ChTop_a_OnBtn';
  return {
    animation: source.animations[name],
    frame: changing ? presentation.frame : enabled ? 10 : 0,
    group: 'G_OnOffBtnB',
    loop: false,
  };
}

const PREVIEW_BUTTON_IDS = new Set(['back', 'start']);
const PREVIEW_BUTTON_LAST_FRAME = 10;
const PREVIEW_BUTTON_SCALE_IN_END = 5;
const PREVIEW_BUTTON_SCALE_OUT_END = 8;

function previewButtonId(id) {
  return PREVIEW_BUTTON_IDS.has(id) ? id : null;
}

function leaveFrameFor(state) {
  if (!state) return PREVIEW_BUTTON_SCALE_OUT_END;
  if (state.phase === 'out') return state.frame;
  const enterFrame = Math.min(PREVIEW_BUTTON_SCALE_IN_END, state.frame);
  return PREVIEW_BUTTON_SCALE_OUT_END -
    (enterFrame / PREVIEW_BUTTON_SCALE_IN_END) * PREVIEW_BUTTON_SCALE_OUT_END;
}

function enterFrameFor(state) {
  if (!state) return 0;
  if (state.phase === 'in') return state.frame;
  return PREVIEW_BUTTON_SCALE_IN_END *
    (1 - Math.min(PREVIEW_BUTTON_SCALE_OUT_END, state.frame) / PREVIEW_BUTTON_SCALE_OUT_END);
}

/**
 * Drives the ChannelTitle Wii Menu and Start focus groups from their source
 * eleven-frame clips. Keeping each button's phase lets a departure finish the
 * authored FocusBtnA_off motion instead of jumping to its endpoint.
 */
export function createPreviewButtonHover() {
  const states = new Map();
  let hovered = null;

  return {
    reset() {
      states.clear();
      hovered = null;
    },
    hover(id) {
      const next = previewButtonId(id);
      if (next === hovered) return false;
      if (hovered) {
        const previous = states.get(hovered);
        states.set(hovered, { phase: 'out', frame: leaveFrameFor(previous) });
      }
      hovered = next;
      if (next) {
        const previous = states.get(next);
        states.set(next, { phase: 'in', frame: enterFrameFor(previous) });
      }
      return true;
    },
    advance(frames) {
      for (const [id, state] of states) {
        state.frame += frames;
        if (state.phase === 'out' && state.frame >= PREVIEW_BUTTON_LAST_FRAME) {
          states.delete(id);
          continue;
        }
        if (state.phase === 'in') state.frame = Math.min(PREVIEW_BUTTON_LAST_FRAME, state.frame);
      }
    },
    clip(id) {
      const state = states.get(id);
      if (!state)
        return {
          animation: 'my_ChTop_a_FocusBtnA_off',
          frame: PREVIEW_BUTTON_LAST_FRAME,
        };
      return state.phase === 'in'
        ? { animation: 'my_ChTop_a_FocusBtn_on', frame: state.frame }
        : { animation: 'my_ChTop_a_FocusBtnA_off', frame: state.frame };
    },
    get hovered() {
      return hovered;
    },
  };
}
