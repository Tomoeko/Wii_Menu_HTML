/** Shared 16-bit pointer-hover clock. Each native callback supplies its own
 * repeat condition; ownership begins only with an accepted fresh press.
 */
export function createKeyboardHeldInput({ advance, activate, available, repeatAt }) {
  let held = null;
  let counter = 0;
  let untilUpdate = 1;
  const release = () => {
    held = null;
    counter = 0;
    untilUpdate = 1;
  };
  return {
    hold(id) {
      release();
      if (!available(id) || !activate(id)) return false;
      held = id;
      return true;
    },
    release,
    hover(id) {
      if (held !== id) release();
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0)
        throw new RangeError('Frames must be nonnegative');
      let pending = frames;
      while (held && pending >= untilUpdate) {
        const id = held;
        const step = untilUpdate;
        untilUpdate = 1;
        advance(step);
        pending -= step;
        if (held !== id) continue;
        if (!available(id)) {
          release();
          continue;
        }
        counter = (counter + 1) & 0xffff;
        if (repeatAt(counter)) activate(id);
      }
      if (held) untilUpdate -= pending;
      advance(pending);
    },
  };
}
