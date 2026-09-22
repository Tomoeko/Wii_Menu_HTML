import { createRealtimeBackground } from './realtime-background.js';
import { createPreparedEffect } from './prepared-effect.js';

/**
 * Speaker PCM is exported by the HOME resource pass, while older prepared
 * asset directories may contain the WAV files without the newer manifest
 * entries. Keep the local fallback here so reconnect remains audible across
 * an incremental asset update; a prepared manifest entry still takes priority.
 */
export const HOME_SPEAKER_ASSETS = Object.freeze({
  HOME_SPEAKER_CONNECT1: Object.freeze({ src: '/assets/audio/remote/connect1.wav' }),
  HOME_SPEAKER_CONNECT2: Object.freeze({ src: '/assets/audio/remote/connect2.wav' }),
  HOME_SPEAKER_CONNECT3: Object.freeze({ src: '/assets/audio/remote/connect3.wav' }),
  HOME_SPEAKER_CONNECT4: Object.freeze({ src: '/assets/audio/remote/connect4.wav' }),
  HOME_SPEAKER_VOLUME: Object.freeze({ src: '/assets/audio/remote/volume.wav' }),
});

/** Own prepared cues and the selected original-source background playback path. */
export function createAudio({
  manifest = {},
  baseUrl,
  backgroundMode = 'prepared',
  onError = () => {},
  onRequest,
  realtimeFactory = createRealtimeBackground,
} = {}) {
  if (!['prepared', 'realtime'].includes(backgroundMode)) {
    throw new Error('Background mode must be prepared or realtime.');
  }
  if (onRequest !== undefined && typeof onRequest !== 'function') {
    throw new TypeError('Audio request observer must be a function.');
  }
  const entries = manifest.audio ?? manifest.sounds ?? manifest;
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const cache = new Map();
  const active = new Set();
  const effects = new Set();
  const loops = new Map();
  const failed = new Set();
  let context;
  let master;
  let muted = false;
  let volume = 1;
  let destroyed = false;
  let backgroundWanted = false;
  let background = null;
  let backgroundIntro = null;
  let backgroundVersion = 0;
  let channel = null;
  let channelVersion = 0;
  let effectVersion = 0;
  let menuPaused = false;
  let unlockPromise = null;
  let lastHover = -Infinity;

  function entry(name) {
    const value =
      entries[name] ?? HOME_SPEAKER_ASSETS[name] ??
      Object.values(entries).find((item) => item?.sourceSymbol === name);
    return typeof value === 'string' ? { src: value } : value;
  }

  async function loadAsset(name, asset) {
    if (!asset?.src || !context || destroyed) return null;
    const url = baseUrl ? new URL(asset.src, baseUrl).href : asset.src;
    if (!cache.has(url)) {
      cache.set(
        url,
        (async () => {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Audio ${name}: HTTP ${response.status}`);
            return await context.decodeAudioData(await response.arrayBuffer());
          } catch (error) {
            failed.add(name);
            onError(name, error);
            return null;
          }
        })(),
      );
    }
    return cache.get(url);
  }

  const load = (name) => loadAsset(name, entry(name));

  function backgroundIntroAsset() {
    // A native capture is cut from the mixed DSP stream and already contains
    // the startup wave. Built-in and realtime sequence paths need the separate
    // one-shot resource because their BGM sequence starts at tick zero.
    const backgroundAsset = entry('background');
    const captureIncludesStartup = backgroundMode !== 'realtime' && (
      backgroundAsset?.includesStartupWave ||
      backgroundAsset?.rendering === 'original-menu-emulated-ax-capture'
    );
    return captureIncludesStartup ? null : entry('backgroundIntro');
  }

  function shouldPreload(name) {
    if (name === 'backgroundIntro' && !backgroundIntroAsset()) return false;
    return name !== 'background' || backgroundMode === 'prepared';
  }

  function reportRequest(operation, symbol, options) {
    // Optional inspection observes requests before mute, loading or the hover
    // throttle can hide duplicates. It never changes playback or owns assets.
    try {
      onRequest({ operation, symbol, sourceSymbol: entry(symbol)?.sourceSymbol ?? null,
        options: { ...options } });
    } catch {
      // Diagnostic observers must not interrupt application sound playback.
    }
  }

  function startLoop(name, options = {}) {
    if (onRequest) reportRequest('startLoop', name, options);
    if (destroyed) return Promise.resolve(false);
    const existing = loops.get(name);
    if (existing) return existing.ready;
    // Identity is the cancellation token, including while gesture resume or
    // decoding is pending. A later grab may share the cached audio buffer.
    const request = { player: null, options, paused: false };
    effects.add(request);
    loops.set(name, request);
    const current = () => !destroyed && loops.get(name) === request;
    const cancel = () => {
      if (loops.get(name) === request) loops.delete(name);
      effects.delete(request);
      return false;
    };
    request.ready = (async () => {
      if (unlockPromise) await unlockPromise;
      if (!current() || !context || context.state !== 'running') return cancel();
      const buffer = await load(name);
      if (!current() || !buffer || context.state !== 'running') return cancel();
      request.player = effectPlayer(name, buffer, true, request, () => {
        if (loops.get(name) === request) loops.delete(name);
      });
      return true;
    })();
    return request.ready;
  }

  function stopLoop(name) {
    const request = loops.get(name);
    loops.delete(name);
    effects.delete(request);
    request?.player?.stop();
  }

  function setLoop(name, options) {
    const request = loops.get(name);
    if (!request) return;
    request.options = { ...request.options, ...options };
    request.player?.setOptions(options);
  }

  function effectPlayer(name, buffer, loop, request, onEnded = () => {}) {
    const asset = entry(name);
    return createPreparedEffect({
      context, destination: master, asset, buffer, loop,
      options: request.options, paused: request.paused,
      createSource: (options, destination) => sourceFor(asset, buffer, loop, options, destination),
      onEnded: () => {
        effects.delete(request);
        onEnded();
      },
    });
  }

  function prepareContext() {
    if (!AudioContextClass || destroyed) return false;
    if (!context) {
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(context.destination);
    }
    return true;
  }

  function sourceFor(
    asset,
    buffer,
    loop,
    options = {},
    destination = master,
    onEnded = () => {},
  ) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    if (loop) {
      source.loopStart = Math.max(0, asset.loopStart ?? 0);
      source.loopEnd = Math.min(buffer.duration, asset.loopEnd ?? buffer.duration);
    }
    gain.gain.value =
      (Number.isFinite(asset.gain) ? Math.max(0, asset.gain) : 1) * Math.max(0, options.gain ?? 1);
    const panner = context.createStereoPanner?.();
    source.connect(gain);
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
      gain.connect(panner).connect(destination);
    } else gain.connect(destination);
    if (source.playbackRate) source.playbackRate.value = options.pitch ?? 1;
    active.add(source);
    source.onended = () => {
      if (channel?.source === source) channel = null;
      if (background?.source === source) background = null;
      active.delete(source);
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
      onEnded();
    };
    return { source, gain, panner };
  }

  function beginTrack(track) {
    if (!track || menuPaused || destroyed) return;
    if (track.ended) return;
    if (track.realtime) {
      if (track.realtime.play(track.gainScale ?? 1)) track.source = track.realtime;
      return;
    }
    const { asset, buffer, loop } = track;
    if (!loop && track.offset >= buffer.duration) return;
    let player;
    player = sourceFor(asset, buffer, loop, {}, master, () => {
      // A one-shot startup cue must not be replayed when the menu resumes
      // after it has already reached the end of its source buffer.
      if (track.source === player.source && !loop) {
        track.source = null;
        track.ended = true;
        track.onEnded?.();
      }
    });
    Object.assign(track, player);
    track.startedAt = context.currentTime;
    track.source.start(0, track.offset);
  }

  function startPendingBackground() {
    if (!backgroundWanted || menuPaused || background?.source || backgroundIntro?.source)
      return false;
    // Start both sources at the menu boundary. The BGM's quiet opening sits
    // beneath the startup wave, preserving the authored loop marker while
    // retaining the native short overlap at the hand-off.
    beginTrack(background);
    beginTrack(backgroundIntro);
    return Boolean(background?.source || backgroundIntro?.source);
  }

  function pauseTrack(track, fadeMs = 0) {
    if (!track?.source) return;
    if (track.realtime) {
      track.realtime.pause(fadeMs);
      track.source = null;
      return;
    }
    const fadeSeconds = Math.max(0, fadeMs) / 1000;
    track.offset += Math.max(0, context.currentTime - track.startedAt) + fadeSeconds;
    if (track.loop) {
      const start = track.source.loopStart,
        end = track.source.loopEnd;
      if (end > start && track.offset >= end)
        track.offset = start + ((track.offset - start) % (end - start));
    }
    const { source, gain } = track;
    // Clear the handle before onended, which also runs for an explicit stop.
    // A preview's short fade still consumes those samples before suspension.
    track.source = null;
    track.gain = null;
    if (fadeSeconds) stopTrack({ source, gain }, fadeMs);
    else source.stop();
  }

  function stopTrack(track, fadeMs) {
    if (track?.realtime) {
      track.realtime.destroy(fadeMs);
      track.source = null;
      return;
    }
    if (!track?.source || !context) return;
    const { source, gain } = track,
      end = context.currentTime + Math.max(0, fadeMs) / 1000;
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(0, end);
    source.stop(end);
  }

  async function startBackground() {
    backgroundWanted = true;
    if (!context || context.state !== 'running' || destroyed) return false;
    if (background) return startPendingBackground() || menuPaused;
    const version = ++backgroundVersion;
    const introAsset = backgroundIntroAsset();
    const introPromise = introAsset
      ? load('backgroundIntro')
      : Promise.resolve(null);
    if (backgroundMode === 'realtime') {
      const asset = entry('background')?.sequence;
      if (!asset?.src) {
        failed.add('backgroundSequence');
        onError('backgroundSequence', new Error('Prepare the original background sequence first.'));
        return false;
      }
      try {
        let realtime;
        const [createdRealtime, introBuffer] = await Promise.all([
          realtimeFactory({
            context,
            destination: master,
            asset,
            baseUrl,
            onError: (error) => {
              failed.add('backgroundSequence');
              if (realtime && background?.realtime === realtime) background = null;
              onError('backgroundSequence', error);
            },
          }),
          introPromise,
        ]);
        realtime = createdRealtime;
        if (destroyed || !backgroundWanted || version !== backgroundVersion) {
          realtime.destroy(0);
          return false;
        }
        background = { realtime, source: null };
        backgroundIntro = introBuffer
          ? { asset: introAsset, buffer: introBuffer, loop: false, offset: 0 }
          : null;
        return startPendingBackground() || menuPaused;
      } catch (error) {
        if (!destroyed && version === backgroundVersion) {
          failed.add('backgroundSequence');
          onError('backgroundSequence', error);
        }
        return false;
      }
    }
    const [buffer, introBuffer] = await Promise.all([load('background'), introPromise]);
    if (!buffer || destroyed || !backgroundWanted || version !== backgroundVersion) return false;
    background = {
      asset: entry('background'),
      buffer,
      loop: true,
      offset: 0,
    };
    backgroundIntro = introBuffer
      ? { asset: introAsset, buffer: introBuffer, loop: false, offset: 0 }
      : null;
    return startPendingBackground() || menuPaused;
  }

  function pauseBackground(fadeMs = (5 * 1000) / 60) {
    backgroundWanted = false;
    backgroundVersion += 1;
    pauseTrack(background, fadeMs);
    pauseTrack(backgroundIntro, fadeMs);
  }

  function stopBackground(fadeMs = (5 * 1000) / 60) {
    backgroundWanted = false;
    backgroundVersion += 1;
    stopTrack(background, fadeMs);
    stopTrack(backgroundIntro, fadeMs);
    background = null;
    backgroundIntro = null;
  }

  function stopChannel(fadeMs = 0) {
    channelVersion += 1;
    stopTrack(channel, fadeMs);
    channel = null;
  }

  function resetAllSound() {
    // HOME's BEGIN_BLACKOUT callback calls resetAllSound (0x8136BC14):
    // existing voices and effect state are retired immediately. Browser loads
    // also need invalidation so a completed decode cannot recreate an old cue.
    effectVersion += 1;
    const stoppedTracks = new Set([background?.source, backgroundIntro?.source, channel?.source]);
    stopBackground(0);
    stopChannel(0);
    loops.clear();
    for (const effect of effects) effect.player?.stop();
    effects.clear();
    for (const source of active) {
      if (stoppedTracks.has(source)) continue;
      try {
        source.stop();
      } catch {
        // The source may already have ended before its callback was delivered.
      }
    }
    active.clear();
    lastHover = -Infinity;
  }

  function unlock() {
    if (!AudioContextClass || destroyed) return Promise.resolve(false);
    // Even an earlier autoplay request may still be suspended. Call resume in
    // this gesture before returning its promise, so startup can unlock reliably.
    if (unlockPromise) {
      void context?.resume();
      return unlockPromise;
    }
    unlockPromise = (async () => {
      try {
        prepareContext();
        // Resume begins synchronously inside the pointer/key event. A click
        // queued immediately afterwards awaits this same promise before playing.
        await context.resume();
        if (destroyed) return false;
        for (const name of Object.keys(entries)) {
          if (shouldPreload(name)) void load(name);
        }
        if (backgroundWanted) void startBackground();
        return context.state === 'running';
      } catch (error) {
        onError('unlock', error);
        return false;
      }
    })();
    void unlockPromise.finally(() => {
      unlockPromise = null;
    });
    return unlockPromise;
  }

  return Object.freeze({
    asset: entry,
    unlock,
    preloadChannel(id, asset) {
      if (!prepareContext()) return Promise.resolve(null);
      return loadAsset(`channel:${id}`, asset);
    },
    attemptAutoplay() {
      if (!prepareContext()) return false;
      // Browsers may reject or defer this request until a gesture. Do not hold
      // the loading screen on a promise that requires the user to press a key.
      void context
        .resume()
        .then(() => {
          if (backgroundWanted) void startBackground();
        })
        .catch(() => {});
      for (const name of Object.keys(entries)) {
        if (shouldPreload(name)) void load(name);
      }
      return context.state === 'running';
    },
    async play(name, options = {}) {
      const version = effectVersion;
      if (onRequest) reportRequest('play', name, options);
      const request = { player: null, options, paused: false };
      effects.add(request);
      const cancel = () => {
        effects.delete(request);
        return false;
      };
      if (unlockPromise) await unlockPromise;
      if (
        version !== effectVersion ||
        !context || context.state !== 'running' || destroyed || muted
      ) return cancel();
      if (name === 'hover') {
        if (context.currentTime - lastHover < 0.045) return cancel();
        lastHover = context.currentTime;
      }
      const buffer = await load(name);
      if (
        version !== effectVersion ||
        !buffer || destroyed || muted || context.state !== 'running'
      ) return cancel();
      request.player = effectPlayer(name, buffer, false, request);
      return true;
    },
    async playChannel(id, asset) {
      stopChannel();
      const version = channelVersion;
      if (unlockPromise) await unlockPromise;
      if (
        version !== channelVersion ||
        !context ||
        context.state !== 'running' ||
        destroyed ||
        !asset?.src
      )
        return false;
      const buffer = await loadAsset(`channel:${id}`, asset);
      if (!buffer || destroyed || context.state !== 'running' || version !== channelVersion)
        return false;
      // A banner sound's loop flag comes from its BNS metadata. A nonlooping
      // banner plays once, while mute only changes gain and retains its position.
      channel = { id, asset, buffer, loop: asset.loop === true, offset: 0 };
      beginTrack(channel);
      return true;
    },
    // HOME pauses menu and banner audio while its own button sounds continue.
    pauseMenuAudio() {
      if (menuPaused || destroyed) return;
      menuPaused = true;
      pauseTrack(background);
      pauseTrack(backgroundIntro);
      pauseTrack(channel);
      for (const effect of effects) {
        effect.paused = true;
        effect.player?.pause();
      }
    },
    resumeMenuAudio() {
      if (!menuPaused || destroyed) return;
      menuPaused = false;
      startPendingBackground();
      if (channel) beginTrack(channel);
      for (const effect of effects) {
        if (!effect.paused) continue;
        effect.paused = false;
        effect.player?.resume();
      }
    },
    stopChannel,
    resetAllSound,
    startLoop,
    stopLoop,
    setLoop,
    startBackground,
    pauseBackground,
    stopBackground,
    setMuted(value) {
      muted = Boolean(value);
      if (master) master.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
      return muted;
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return volume;
      volume = Math.max(0, Math.min(1, value));
      if (master) master.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
      return volume;
    },
    getStatus: () => ({
      supported: Boolean(AudioContextClass),
      unlocked: context?.state === 'running',
      muted,
      volume,
      menuPaused,
      backgroundPlaying: Boolean(background?.source || backgroundIntro?.source),
      backgroundMode,
      channelPlaying: Boolean(channel?.source),
      channelId: channel?.id ?? null,
      // Include pending loads: their ownership must survive HOME's pause too.
      effectCount: effects.size,
      pausedEffectCount: [...effects].filter((effect) => effect.paused).length,
      failed: [...failed],
    }),
    async destroy() {
      destroyed = true;
      resetAllSound();
      cache.clear();
      if (context && context.state !== 'closed') await context.close();
    },
  });
}
