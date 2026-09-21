// Original USA 4.3 ColorFader::calc, 0x815F7094. Its integer opacity and
// completion checks are separate: alpha reaches its endpoint before status.
export const NATIVE_FADE_FRAMES = 20;
export function nativeFadeSample(updates, direction = 'in') {
  if (!['in', 'out'].includes(direction)) throw new RangeError('Unknown native fade direction');
  if (!Number.isFinite(updates) || updates < 0) throw new RangeError('Updates must be nonnegative');
  const frame = Math.max(0, Math.min(NATIVE_FADE_FRAMES, Math.floor(updates) - 1));
  const progress = Math.floor((frame * 255) / NATIVE_FADE_FRAMES);
  const alpha = direction === 'in' ? 255 - progress : progress;
  return { alpha, opacity: alpha / 255, complete: updates >= (direction === 'in' ? 22 : 23) };
}

/** Resource-ready handoff after Health SeenOut: global fade-out, then Board's
 * global fade-in over ChannelSelect START_NORMAL at BRLAN frame zero. Actual
 * hardware/resource loading can extend the black interval independently.
 */
export function menuEntranceSample(updates, { healthShown = true } = {}) {
  const hold = healthShown ? 23 : 0;
  if (updates < hold)
    return { phase: 'black', alpha: 255, opacity: 1, complete: false, gridFrame: 0 };
  return { phase: 'reveal', ...nativeFadeSample(updates - hold, 'in'), gridFrame: 0 };
}
