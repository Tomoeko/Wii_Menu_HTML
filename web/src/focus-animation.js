/**
 * Keep each control's focus animation alive after the pointer moves elsewhere.
 * Memory's AnmPane queues the latest focus request until the current authored
 * clip completes (USA 4.3, 0x813A6F64). A new pointer target must not steal the
 * previous target's rollout clock or restart an unfinished entrance.
 */
export function createFocusAnimation(resolve, duration) {
  const entries = new Map();
  let hovered = null;

  const begin = (id, entering, requested = entering) => {
    const clips = resolve(id, entering);
    const entry = { clips, entering, requested, frame: 0, duration: duration(clips) };
    entries.set(id, entry);
    return entry;
  };

  const request = (id, entering) => {
    const entry = entries.get(id);
    if (!entry) {
      if (entering) begin(id, true);
      return;
    }
    entry.requested = entering;
    if (entry.frame >= entry.duration && entry.entering !== entering) begin(id, entering);
  };

  return {
    hover(id) {
      if (id === hovered) return false;
      if (hovered !== null) request(hovered, false);
      hovered = id;
      if (id !== null) request(id, true);
      return true;
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0) {
        throw new RangeError('Frames must be nonnegative');
      }
      for (const [id, initial] of entries) {
        let entry = initial;
        const remaining = Math.max(0, frames - Math.max(0, entry.duration - entry.frame));
        entry.frame = Math.min(entry.duration, entry.frame + frames);
        if (entry.frame >= entry.duration && entry.requested !== entry.entering) {
          entry = begin(id, entry.requested);
          entry.frame = Math.min(entry.duration, remaining);
        }
      }
    },
    samples() {
      return [...entries.values()].flatMap((entry) =>
        entry.clips.map((clip) => ({ clip, frame: entry.frame })),
      );
    },
    reset() {
      entries.clear();
      hovered = null;
    },
  };
}
