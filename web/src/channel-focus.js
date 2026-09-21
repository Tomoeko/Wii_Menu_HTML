import { poseLayout } from './animation.js';

/** ChannelObj's enter/hold/exit controller; source clips themselves are not loops. */
export function createChannelFocus(source) {
  const entries = new Map();
  const on = source.animations.my_IplTop_d_FocusOn;
  const off = source.animations.my_IplTop_d_FocusOff;
  const select = source.animations.my_IplTop_d_Select;
  let current = null;
  return {
    target(index) {
      if (current === index) return;
      if (current !== null) {
        const previous = entries.get(current);
        if (previous) previous.leaving = true;
      }
      current = index;
      if (index !== null) {
        const existing = entries.get(index);
        if (existing?.phase === 'on') existing.leaving = false;
        else entries.set(index, { phase: 'on', frame: 0, leaving: false });
      }
    },
    advance(frames) {
      for (const [index, entry] of entries) {
        entry.frame += frames;
        if (entry.phase === 'on' && entry.frame >= on.frames && entry.leaving) {
          entry.phase = 'off';
          entry.frame = 0;
        }
        if (entry.phase === 'off' && entry.frame >= off.frames) entries.delete(index);
      }
    },
    poses() {
      return [...entries].map(([index, entry]) => ({
        index,
        layout: poseLayout(source, [
          {
            animation: entry.phase === 'on' ? on : off,
            frame: entry.frame,
            loop: false,
          },
        ]),
      }));
    },
    selectPose(index, frame) {
      // ChannelObj starts its independent 16-frame decide animation on click.
      // Loading/module shutdown can delay native zoom; preloaded HTML need not.
      return select && frame < select.frames
        ? { index, layout: poseLayout(source, [{ animation: select, frame, loop: false }]) }
        : null;
    },
    clear() {
      entries.clear();
      current = null;
    },
  };
}
