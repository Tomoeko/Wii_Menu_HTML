const GRID_CONTROLS = new Set(['board', 'settings', 'sd', 'prev', 'next']);
const BOARD_CONTROLS = {
  'scene-back': 'board-back',
  'scene-calendar': 'calendar',
  'scene-create': 'create',
};

/** Startup overlays keep their pointer hit area, but do not emit menu hover cues. */
export function shouldPlayHoverSound(
  value,
  { startupComplete = true, footerOwnsSound = false, sceneOwnsSound = false } = {},
) {
  return Boolean(
    startupComplete && value && !value.startsWith('sd-menu-') &&
    !footerOwnsSound && !sceneOwnsSound,
  );
}

/** Shared control names are not shared controller ownership. In particular,
 * preview arrows use their own layout and must never refocus the hidden grid
 * footer after a transition clears it. A grid page scroll retains its footer. */
export function routeFooterHover(footer, value, state, scene = {}, blocked = false) {
  let target = null;
  const acceptsHover =
    !blocked && !state.overlay && (!state.locked || state.transition?.kind === 'page');
  if (acceptsHover) {
    if (state.screen === 'grid' && GRID_CONTROLS.has(value)) target = value;
    else if (
      state.screen === 'board' &&
      !scene.boardChild &&
      !scene.readingMemo &&
      !scene.draggingMemo &&
      !scene.transition
    ) {
      target = BOARD_CONTROLS[value] ?? null;
    }
  }
  footer?.hover(target);
  return target !== null && footer?.hovered === target;
}
