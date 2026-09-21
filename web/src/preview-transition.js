// ChannelTitle::startChangeChannel/calcNormalChangeWait/calcNormalChangeNext.
// Each original ChangeIn/ChangeOut BRLAN has 11 frames. IPL's forward
// Animator stops at GetFrameSize()-1, so preloaded resources need 10+10 ticks.
export const PREVIEW_CHANGE = Object.freeze({ inFrames: 10, outFrames: 10 });
export const PREVIEW_CHANGE_DURATION =
  ((PREVIEW_CHANGE.inFrames + PREVIEW_CHANGE.outFrames) * 1000) / 60;

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
