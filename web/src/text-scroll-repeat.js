/** Pointer/A repeat for P_txtScrll_UP/DOWN: 0x814274B0 waits 60 updates,
 * then repeats every 20. This is separate from directional-key repetition.
 */
export function createTextScrollRepeat({ advance, activate }) {
  let held = null;
  let remaining = 60;
  return {
    hold(id) {
      held = id;
      remaining = 60;
      activate(id);
    },
    release() {
      held = null;
      remaining = 60;
    },
    hover(id) {
      if (held !== id) this.release();
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0)
        throw new RangeError('Frames must be nonnegative');
      let pending = frames;
      while (held && pending >= remaining) {
        const id = held;
        const step = remaining;
        remaining = 20;
        advance(step);
        pending -= step;
        if (held === id) activate(id);
      }
      if (held) remaining -= pending;
      advance(pending);
    },
  };
}
