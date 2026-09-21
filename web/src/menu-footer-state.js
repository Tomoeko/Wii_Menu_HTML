/** ChannelSelect resumes its controls after its twenty-frame Board return
 * layout completes. Channel zoom keeps controls present, then restores arrows
 * after the twenty-eight-frame zoom has finished.
 */
export function menuFooterState(menu, scene = {}) {
  const zooming = ['select', 'back'].includes(menu.transition?.kind);
  const returningFromBoard =
    menu.screen === 'board' && scene.transition === 'exit' && scene.frame >= 20;
  const showArrows = (menu.screen === 'grid' && !zooming) || returningFromBoard;
  return {
    arrows: {
      prev: showArrows && menu.page > 0,
      next: showArrows && menu.page < 3,
    },
    sdVisible: ['grid', 'preview'].includes(menu.screen) || returningFromBoard,
    useGridArrowClips:
      menu.screen === 'board' &&
      ((scene.transition === 'enter' && scene.frame < 10) || returningFromBoard),
  };
}
