/** Generic original keyboard form scrolling. Base::doScroll/autoScroll
 * (0x81420B90/0x81420CA8) interpolate vertical offsets for 15 updates.
 * limitRowNum(1), at 0x81427E1C, disables wrapping through 0x81427E14.
 */
export function createKeyboardTextField({
  pane,
  layout,
  measure,
  rowLimit = 1,
  onScroll = () => {},
}) {
  const template = { ...pane, noWrap: rowLimit === 1 };
  let x = 0;
  let y = 0;
  let maximum = 0;
  let lineHeight = 0;
  let motion = null;
  let lastInput = null;
  const metrics = (text) => measure(text, template, layout);
  const start = (target) => {
    target = Math.max(0, Math.min(maximum, target));
    if (target === y || motion) return false;
    motion = { from: y, to: target, frame: 0 };
    onScroll();
    return true;
  };
  return {
    metrics,
    accepts(text) {
      return rowLimit === 1 || metrics(text).lines.length <= rowLimit;
    },
    update(text, caret) {
      const measured = metrics(text);
      lineHeight = measured.lineHeight;
      maximum = Math.max(0, measured.lines.length * lineHeight - template.size[1]);
      const lineIndex = Math.max(
        0,
        measured.lines.findLastIndex((line) => caret >= line.start),
      );
      const line = measured.lines[lineIndex];
      const marker = line.carets?.find((position) => position.index === caret);
      if (rowLimit === 1 && marker) {
        const position = marker.x - line.x;
        x = Math.max(Math.min(x, position), position - template.size[0] + 2, 0);
      }
      const key = `${caret}:${text}`;
      if (key !== lastInput && !motion) {
        const midpoint = (lineIndex + 0.5) * lineHeight;
        if (midpoint < y)
          start(Math.max(0, y - Math.ceil((y - midpoint) / lineHeight) * lineHeight));
        else if (midpoint >= y + template.size[1]) {
          start(y + (Math.floor((midpoint - y - template.size[1]) / lineHeight) + 1) * lineHeight);
        }
        if (!motion) lastInput = key;
      }
      y = Math.min(y, maximum);
      if (motion && motion.to > maximum) {
        motion.from = Math.min(motion.from, maximum);
        motion.to = maximum;
      }
    },
    advance(frames) {
      if (!motion) return;
      motion.frame = Math.min(15, motion.frame + frames);
      const t = motion.frame / 15;
      y = Math.min(maximum, motion.from + (motion.to - motion.from) * t * t * (3 - 2 * t));
      if (motion.frame === 15) motion = null;
    },
    scroll(direction) {
      return start(y + direction * lineHeight);
    },
    snapshot() {
      return {
        x,
        y,
        maximum,
        moving: Boolean(motion),
        previous: y > 0,
        next: y < maximum,
        noWrap: template.noWrap,
      };
    },
  };
}
