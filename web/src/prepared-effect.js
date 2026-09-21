const UPDATES_PER_SECOND = 60;
const PAUSE_UPDATES = 5;

function fadeValue(fade, time) {
  if (!fade) return 1;
  const update = Math.max(0, Math.floor((time - fade.start) * UPDATES_PER_SECOND + 1e-7));
  if (update >= fade.updates) return fade.to;
  const difference = Math.fround(fade.to - fade.from);
  return Math.fround(fade.from + Math.fround(Math.fround(update * difference) / fade.updates));
}

/** Retain a prepared effect's cursor through HOME's per-handle pause. */
export function createPreparedEffect({
  context, destination, asset, buffer, loop, options = {}, paused = false,
  createSource, onEnded,
}) {
  let playback = null;
  let offset = 0;
  let stopped = false;
  let fade = paused ? { from: 0, to: 0, updates: 1, start: context.currentTime } : null;
  let parameters = { ...options };

  function wrap(position) {
    if (!loop) return Math.min(buffer.duration, position);
    const start = Math.max(0, asset.loopStart ?? 0);
    const end = Math.min(buffer.duration, asset.loopEnd ?? buffer.duration);
    return end > start && position >= end
      ? start + ((position - start) % (end - start))
      : position;
  }

  function positionAt(time) {
    if (!playback) return offset;
    const elapsed = Math.max(0, Math.min(time, playback.stopAt) - playback.startedAt);
    return wrap(playback.offset + elapsed * playback.rate);
  }

  function finish() {
    if (stopped) return;
    stopped = true;
    onEnded();
  }

  function retirePlayback() {
    if (!playback) return;
    const retiring = playback;
    playback = null;
    retiring.source.stop();
    retiring.cleanup();
  }

  function begin(level) {
    if (stopped || paused) return;
    if (!loop && offset >= buffer.duration) {
      finish();
      return;
    }
    const pauseGain = context.createGain();
    pauseGain.gain.value = level;
    pauseGain.connect(destination);
    const created = createSource(parameters, pauseGain);
    const ended = created.source.onended;
    const current = {
      ...created, pauseGain, offset, startedAt: context.currentTime,
      rate: Math.max(0.01, parameters.pitch ?? 1), stopAt: Infinity,
    };
    let cleaned = false;
    current.cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      pauseGain.disconnect();
      ended();
    };
    created.source.onended = () => {
      if (playback === current) {
        offset = positionAt(context.currentTime);
        playback = null;
        if (!paused || (!loop && offset >= buffer.duration)) finish();
      }
      current.cleanup();
    };
    playback = current;
    created.source.start(0, offset);
  }

  function setFade(target) {
    const now = context.currentTime;
    const from = fadeValue(fade, now);
    // BasicSound::Pause (0x814FC8B8) truncates the remaining distance times
    // five, with a minimum of one update when reversing an unfinished fade.
    const distance = target === 0 ? from : Math.fround(1 - from);
    const updates = Math.max(1, Math.trunc(Math.fround(PAUSE_UPDATES * distance)));
    fade = { from, to: target, updates, start: now };
    if (playback) {
      const gain = playback.pauseGain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(from, now);
      for (let update = 1; update <= updates; update++) {
        const time = now + update / UPDATES_PER_SECOND;
        gain.setValueAtTime(fadeValue(fade, time), time);
      }
    }
    return now + updates / UPDATES_PER_SECOND;
  }

  begin(1);
  return {
    pause() {
      if (paused || stopped) return;
      paused = true;
      if (!playback) {
        fade = { from: 0, to: 0, updates: 1, start: context.currentTime };
        return;
      }
      playback.stopAt = setFade(0);
      offset = positionAt(playback.stopAt);
      // BasicSound::Update pauses its player after the fade, so these samples
      // advance the retained cursor. A short effect can naturally finish first.
      playback.source.stop(playback.stopAt);
    },
    resume() {
      if (!paused || stopped) return;
      const level = fadeValue(fade, context.currentTime);
      offset = positionAt(context.currentTime);
      retirePlayback();
      paused = false;
      begin(level);
      if (!stopped) setFade(1);
    },
    stop() {
      retirePlayback();
      finish();
    },
    setOptions(next) {
      parameters = { ...parameters, ...next };
      if (!playback) return;
      const now = context.currentTime;
      playback.offset = positionAt(now);
      playback.startedAt = Math.min(now, playback.stopAt);
      playback.rate = Math.max(0.01, parameters.pitch ?? 1);
      playback.gain.gain.setValueAtTime(
        (asset.gain ?? 1) * Math.max(0, parameters.gain ?? 1), now,
      );
      if (playback.panner)
        playback.panner.pan.value = Math.max(-1, Math.min(1, parameters.pan ?? 0));
      if (playback.source.playbackRate) playback.source.playbackRate.value = playback.rate;
      if (paused) offset = positionAt(playback.stopAt);
    },
  };
}
