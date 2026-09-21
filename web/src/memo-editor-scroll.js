/** Original Memo input form scroll bounds and animation (USA 4.3 executable
 * 0x81442208, 0x8144231C, 0x81443410 and 0x81443ED0).
 */
export function createMemoEditorScroll(onScroll = () => {}) {
  let offset = 0;
  let maximum = 0;
  let height = 42;
  let motion = null;
  let lastCaret = null;
  let measuredCaret = null;
  let wasEditing = false;
  const start = (target) => {
    target = Math.max(0, Math.min(maximum, target));
    if (target === offset) return false;
    motion = { from: offset, to: target, frame: 0 };
    onScroll();
    return true;
  };
  return {
    measure({ lines, lineHeight = 42 }, caret, editing) {
      measuredCaret = caret;
      const entering = editing && !wasEditing;
      if (entering) lastCaret = null;
      wasEditing = editing;
      height = lineHeight;
      // Display-page bounds include the ruled footer. The native editor instead
      // follows and scrolls through a two-line viewport (0x81442D50/0x81443410).
      // Reusing the display bound leaves the last line partly under prediction.
      maximum = editing
        ? Math.max(0, lines.length - 2) * height
        : Math.max(0, Math.max(4, lines.length) * height - 100);
      if (entering) {
        offset = Math.min(maximum, Math.round(offset / height) * height);
        motion = null;
      }
      if (motion && motion.to > maximum) {
        motion.to = maximum;
      }
      if (!editing) offset = Math.min(maximum, offset);
      else if (!motion && offset > maximum) start(maximum);
      const caretLine = Math.max(
        0,
        lines.findLastIndex((line) => caret >= line.start),
      );
      const changed = caret !== lastCaret;
      if (editing && changed && !motion) {
        const y = caretLine * height;
        const midpoint = y + 0.5 * height;
        if (offset > midpoint) start(offset - Math.trunc((offset - y) / height) * height);
        else if (offset + 2 * height < midpoint) {
          start(offset + (Math.trunc((midpoint - offset - 2 * height) / height) + 1) * height);
        }
      }
      // Keep a pending caret change until its existing movement has completed.
      if (!motion) lastCaret = caret;
    },
    advance(frames) {
      if (!motion) return;
      motion.frame = Math.min(15, motion.frame + frames);
      const t = motion.frame / 15;
      offset = motion.from + (motion.to - motion.from) * t * t * (3 - 2 * t);
      if (motion.frame === 15) motion = null;
    },
    scroll(direction, { editing = false } = {}) {
      if (motion) return false;
      // A manual scroll deliberately leaves the insertion point offscreen.
      // Only subsequent caret input may resume automatic following.
      lastCaret = measuredCaret;
      return start(offset + direction * (editing ? 1 : 3) * height);
    },
    snapshot() {
      return {
        offset,
        maximum,
        moving: Boolean(motion),
        previous: offset > 0,
        next: offset < maximum,
      };
    },
  };
}
