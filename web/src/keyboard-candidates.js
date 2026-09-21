/** Original candidate-strip paging (USA 4.3: 0x8142C424–0x8142D074).
 * Pages overlap the partially visible last word. A page movement interpolates
 * positions through frame 15, then unlocks on update 16. Scalar::calc checks
 * the previous frame before incrementing (0x8141F32C/0x81429694).
 */
export function createCandidateStrip(values, { measure, areaWidth, projectionWidth }) {
  const margin = projectionWidth > 700 ? 10 : 20;
  let position = 0;
  const entries = values.map((value, index) => {
    const width = measure(value) + 0.01;
    const screenWidth = (width * 608) / projectionWidth;
    const entry = { index, value, width, screenWidth, position };
    position += screenWidth + margin;
    return entry;
  });
  let first = 0;
  let motion = null;
  const ease = (t) => t * t * (3 - 2 * t);
  const offset = () => {
    const start = entries[first]?.position || 0;
    if (!motion) return start;
    return start + (entries[motion.target].position - start) * ease(Math.min(15, motion.frame) / 15);
  };
  const nextIndex = () => {
    if (!entries.length) return -1;
    let index = first;
    let width = -margin;
    while (width <= areaWidth && index < entries.length) {
      width += entries[index].screenWidth + margin;
      index++;
    }
    if (index === entries.length && width <= areaWidth) return -1;
    return Math.min(entries.length - 1, Math.max(first + 1, index - 1));
  };
  const previousIndex = () => {
    let index = first - 1;
    let width = -margin;
    while (width <= areaWidth && index >= 0) {
      width += entries[index].screenWidth + margin;
      index--;
    }
    return Math.max(0, Math.min(first - 1, index + 2));
  };
  return {
    advance(frames) {
      if (!motion) return;
      motion.frame = Math.min(16, motion.frame + frames);
      if (motion.frame === 16) {
        first = motion.target;
        motion = null;
      }
    },
    scroll(direction) {
      if (motion) return false;
      const target = direction > 0 ? nextIndex() : previousIndex();
      if (target < 0 || target === first) return false;
      motion = { frame: 0, target };
      return true;
    },
    snapshot() {
      const x = offset();
      return {
        first,
        scrolling: Boolean(motion),
        offset: x,
        previous: first > 0,
        next: nextIndex() > first,
        entries: entries
          .map((entry) => ({
            ...entry,
            x: entry.position - x,
            clippedLeft: Math.max(0, entry.position - x),
            clippedRight: Math.min(areaWidth, entry.position - x + entry.screenWidth),
          }))
          .filter((entry) => entry.clippedRight > entry.clippedLeft),
      };
    },
  };
}
