/**
 * Wii animations use 60 updates per second. High-refresh displays do not need
 * duplicate scene submissions between those updates. Keep the fractional phase
 * so 120/144 Hz scheduling cannot accumulate timing drift, and never replay
 * missed draws after a stalled or backgrounded frame.
 */
export function createFramePacer() {
  const interval = 1000 / 60;
  const refreshSamples = new Float64Array(9);
  const orderedSamples = new Float64Array(9);
  let sampleCount = 0;
  let sampleIndex = 0;
  let previousCallback = null;
  let deadline = null;
  let refreshInterval = interval;

  function observeRefresh(elapsed) {
    // A background tab or a long task does not describe the monitor's refresh
    // rate. A short median window tolerates isolated skipped RAF callbacks and
    // adapts when the window moves to a display with a different refresh rate.
    if (elapsed <= 0 || elapsed > interval * 2.5) return;
    refreshSamples[sampleIndex] = elapsed;
    sampleIndex = (sampleIndex + 1) % refreshSamples.length;
    sampleCount = Math.min(sampleCount + 1, refreshSamples.length);
    for (let index = 0; index < sampleCount; index++) {
      const value = refreshSamples[index];
      let position = index;
      while (position > 0 && orderedSamples[position - 1] > value) {
        orderedSamples[position] = orderedSamples[position - 1];
        position--;
      }
      orderedSamples[position] = value;
    }
    refreshInterval = orderedSamples[Math.floor(sampleCount / 2)];
  }

  return (timestamp) => {
    if (!Number.isFinite(timestamp)) return false;
    if (previousCallback === null || timestamp < previousCallback) {
      previousCallback = timestamp;
      deadline = timestamp + interval;
      sampleCount = 0;
      sampleIndex = 0;
      refreshInterval = interval;
      return true;
    }
    observeRefresh(timestamp - previousCallback);
    previousCallback = timestamp;
    // Choose the available refresh nearest the fixed 60 Hz deadline. A tiny
    // fixed epsilon can turn normal 120 Hz timestamp jitter into alternating
    // 8/25 ms render gaps even though the average still appears to be 60 Hz.
    const tolerance = Math.min(interval / 2, refreshInterval / 2);
    if (timestamp + tolerance + 1e-7 < deadline) return false;
    const elapsedDeadlines = Math.floor((timestamp + tolerance + 1e-7 - deadline) / interval);
    deadline += (elapsedDeadlines + 1) * interval;
    return true;
  };
}
