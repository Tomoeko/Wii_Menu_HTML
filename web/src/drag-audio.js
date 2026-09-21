/** System::holdSEwithPosDis, USA 4.3 at 0x8136b8a0.
 * The volume is movement per update divided by the original half-width, times
 * two. Holding still is silent; the raw instrument must never run at full gain.
 */
export function dragAudioParameters(point, previous, frames = 1) {
  const speed =
    previous && frames > 0 ? Math.hypot(point.x - previous.x, point.y - previous.y) / frames : 0;
  const parameters = {
    gain: Math.min(1, (2 * speed) / 304),
    pan: Math.max(-1, Math.min(1, point.x / 304)),
  };
  // The original changes pitch only above this threshold; retain the existing
  // voice pitch below it, as the native routine does.
  if (speed > 30) parameters.pitch = speed / 30;
  return parameters;
}
