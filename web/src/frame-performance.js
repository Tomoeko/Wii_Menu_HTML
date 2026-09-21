function summarize(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const percentile = (fraction) => ordered[Math.ceil(ordered.length * fraction) - 1];
  return {
    samples: values.length,
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    maximum: ordered.at(-1),
  };
}

/** Explicit inspection runs only. Timing never synchronizes with the GPU. */
export function createFramePerformance({ time = () => performance.now() } = {}) {
  let pending = null;
  let result = null;
  return {
    start(frames = 300) {
      if (!Number.isInteger(frames) || frames < 2 || frames > 3600) {
        throw new RangeError('Measure between 2 and 3600 frames.');
      }
      pending = {
        frames, cpu: [], intervals: [], previous: null, started: null,
        callbacks: [], firstCallback: null,
      };
      result = null;
    },
    candidate(timestamp, rendered) {
      if (!pending || pending.callbacks.length >= pending.frames * 8) return;
      pending.firstCallback ??= timestamp;
      pending.callbacks.push({ milliseconds: timestamp - pending.firstCallback, rendered });
    },
    begin(timestamp) {
      if (!pending) return;
      if (pending.previous !== null) pending.intervals.push(timestamp - pending.previous);
      pending.previous = timestamp;
      pending.started = time();
    },
    finish() {
      if (!pending || pending.started === null) return null;
      pending.cpu.push(Math.max(0, time() - pending.started));
      pending.started = null;
      if (pending.cpu.length < pending.frames) return null;
      result = {
        frames: pending.frames,
        cpuMilliseconds: summarize(pending.cpu),
        frameMilliseconds: summarize(pending.intervals),
        callbacks: pending.callbacks,
        scope: 'Menu update and WebGL submission; excludes capture serialization. ' +
          'Frame intervals include browser scheduling. This is not GPU execution time.',
      };
      pending = null;
      return result;
    },
    cancel() {
      pending = null;
    },
    get active() {
      return Boolean(pending);
    },
    get result() {
      return result;
    },
  };
}
