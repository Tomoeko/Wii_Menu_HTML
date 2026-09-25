/** Route a scene control's accepted action to its original or host-owned cue. */
export function activateSceneControl(scenes, id, playSound) {
  const state = scenes.snapshot();
  const ownsSound =
    (state.scene === 'board' && !state.boardChild) ||
    state.boardChild === 'create' ||
    (state.boardChild === 'calendar' && id.startsWith('date-')) ||
    Boolean(state.storagePage) ||
    id.startsWith('memo-');

  if (!scenes.activate(id)) return false;
  if (!ownsSound) playSound(id === 'back' ? 'cancel' : 'confirm');
  return true;
}
