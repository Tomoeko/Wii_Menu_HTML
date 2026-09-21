import { indexLayout, poseLayout } from './animation.js';

/** SDMenuButton: original appearance, disappearance, rollover and select clips.
 * Native In deliberately plays BtnL_Out backwards (iplSDMenuButton.cpp).
 */
export function createSDButton(source, { enabled = true, x = -152 } = {}) {
  let hovered = false,
    changedAt = -Infinity;
  let visible = true,
    visibilityAt = 0,
    visibilityStart = 0,
    selectedAt = null;
  const appearance = (frame) =>
    Math.max(0, Math.min(15, visibilityStart + (visible ? -1 : 1) * (frame - visibilityAt)));
  const clip = (name, frame, group) => ({
    animation: source.animations['mn_Sdcard_Btn_' + name],
    frame,
    group,
    loop: false,
  });
  const api = {
    setVisible(next, frame = 0) {
      if (next === visible) return;
      visibilityStart = next ? 15 : Math.floor(appearance(frame));
      visibilityAt = frame;
      visible = next;
      if (!visible) selectedAt = null;
    },
    select(frame = 0) {
      selectedAt = frame;
    },
    pose({ frame = 0, hovered: nextHovered = false, visible: nextVisible = visible } = {}) {
      api.setVisible(nextVisible, frame);
      nextHovered &&= visible;
      if (nextHovered !== hovered) {
        hovered = nextHovered;
        changedAt = frame;
      }
      const hoverFrame = Math.min(6, Math.max(0, frame - changedAt));
      const clips = [
        { ...clip('On_Roop', frame, 'On_Roop'), loop: true },
        clip('BtnL_Out', appearance(frame), 'Btn_L_InOut'),
        clip(hovered ? 'BtnL_RollOver' : 'BtnL_RollOut', hoverFrame, 'Btn_L_Roll'),
      ];
      if (selectedAt !== null)
        clips.push(clip('BtnL_On', Math.min(20, frame - selectedAt), 'Btn_L_On'));
      const layout = poseLayout(source, clips);
      const { panes } = indexLayout(layout);
      // A local fixture chooses the original On/Off artwork without a device query.
      layout.root.translation = [x, -172, 0];
      panes.get('N_Btn_On').flags = enabled
        ? panes.get('N_Btn_On').flags | 1
        : panes.get('N_Btn_On').flags & ~1;
      panes.get('N_Btn_Off').flags = enabled
        ? panes.get('N_Btn_Off').flags & ~1
        : panes.get('N_Btn_Off').flags | 1;
      return layout;
    },
    getState(frame = 0) {
      return { visible, frame: appearance(frame), hovered, selected: selectedAt !== null };
    },
    reset() {
      hovered = false;
      changedAt = -Infinity;
      visible = true;
      visibilityAt = 0;
      visibilityStart = 0;
      selectedAt = null;
    },
  };
  return api;
}
