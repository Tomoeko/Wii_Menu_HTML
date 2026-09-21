import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, HOME_SPEAKER_ASSETS } from '../src/audio.js';
import { createMenuAudioSync } from '../src/menu-audio.js';
import { createMenuState, DEFAULT_TIMING } from '../src/menu-state.js';
import { createHomeOverlay } from '../src/home-overlay.js';
import { normalizeConfig } from '../src/config.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('Wii Remote reconnect speaker cues resolve to local WAV assets', () => {
  for (const [name, path] of [
    ['HOME_SPEAKER_CONNECT1', '/assets/audio/remote/connect1.wav'],
    ['HOME_SPEAKER_CONNECT2', '/assets/audio/remote/connect2.wav'],
    ['HOME_SPEAKER_CONNECT3', '/assets/audio/remote/connect3.wav'],
    ['HOME_SPEAKER_CONNECT4', '/assets/audio/remote/connect4.wav'],
    ['HOME_SPEAKER_VOLUME', '/assets/audio/remote/volume.wav'],
  ]) {
    assert.equal(HOME_SPEAKER_ASSETS[name]?.src, path, `${name} must have a local fallback`);
  }
});

test('audio loads a reconnect speaker cue when an older manifest omits it', async (t) => {
  const { urls } = environment(t);
  const audio = createAudio({ manifest: {}, baseUrl: 'http://localhost/' });
  await audio.unlock();
  assert.equal(await audio.play('HOME_SPEAKER_CONNECT1'), true);
  assert.deepEqual(urls, ['http://localhost/assets/audio/remote/connect1.wav']);
  await audio.destroy();
});

function environment(t, { resume, decode, fetch: fetchOverride } = {}) {
  const previousContext = globalThis.AudioContext,
    previousFetch = globalThis.fetch;
  const contexts = [],
    urls = [];
  class Context {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    sources = [];
    gains = [];
    constructor() {
      contexts.push(this);
    }
    async resume() {
      if (resume) await resume.promise;
      this.state = 'running';
    }
    async close() {
      this.state = 'closed';
    }
    async decodeAudioData() {
      if (decode) await decode.promise;
      return { duration: 8 };
    }
    createGain() {
      const gain = {
        gain: {
          value: 1,
          events: [],
          cancelScheduledValues(time) {
            this.events.push(['cancel', time]);
          },
          setValueAtTime(value, time) {
            this.value = value;
            this.events.push(['set', value, time]);
          },
          linearRampToValueAtTime(value, time) {
            this.value = value;
            this.events.push(['ramp', value, time]);
          },
        },
        connect(target) {
          return target;
        },
        disconnect() {},
      };
      this.gains.push(gain);
      return gain;
    }
    createBufferSource() {
      const source = {
        starts: 0,
        stops: 0,
        playbackRate: { value: 1 },
        connect(target) {
          return target;
        },
        disconnect() {},
        start(when = 0, offset = 0) {
          this.starts++;
          this.startTime = when;
          this.offset = offset;
        },
        stop(when = 0) {
          this.stops++;
          this.stopTime = when;
        },
      };
      this.sources.push(source);
      return source;
    }
  }
  globalThis.AudioContext = Context;
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (fetchOverride) return fetchOverride(url);
    return response();
  };
  t.after(() => {
    globalThis.AudioContext = previousContext;
    globalThis.fetch = previousFetch;
  });
  return { contexts, urls };
}

function response() {
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
}

function realtimeFixture() {
  const events = [];
  return {
    events,
    play() {
      events.push('play');
      return true;
    },
    pause(fade) {
      events.push(['pause', fade]);
    },
    destroy(fade) {
      events.push(['destroy', fade]);
    },
  };
}

const sequenceManifest = {
  background: { src: '/prepared.wav', sequence: { src: '/sequence.json' } },
};

test('inspection observes generic and native sound requests before mute and hover throttling', async (t) => {
  environment(t);
  const requests = [];
  const audio = createAudio({
    manifest: {
      buttonHover: { src: '/focus.wav', sourceSymbol: 'WIPL_SE_BT_TARGETTING' },
      hover: { src: '/hover.wav', sourceSymbol: 'WIPL_SE_CH_FOCUS' },
      drag: { src: '/drag.wav', sourceSymbol: 'WIPL_SE_CH_DRAG' },
    },
    onRequest: (request) => requests.push(request),
  });
  assert.equal(await audio.play('buttonHover'), false, 'a locked request is still observable');
  await audio.unlock();
  const options = { gain: 0.5, pan: -0.25 };
  assert.equal(await audio.play('buttonHover', options), true);
  assert.equal(await audio.play('WIPL_SE_BT_TARGETTING'), true);
  assert.equal(await audio.play('hover'), true);
  assert.equal(await audio.play('hover'), false);
  const loop = audio.startLoop('drag', { gain: 0 });
  assert.equal(audio.startLoop('drag'), loop, 'existing loop ownership is unchanged');
  await loop;
  audio.setMuted(true);
  assert.equal(await audio.play('WIPL_SE_BT_TARGETTING'), false);
  assert.deepEqual(requests.map(({ operation, symbol }) => [operation, symbol]), [
    ['play', 'buttonHover'], ['play', 'buttonHover'], ['play', 'WIPL_SE_BT_TARGETTING'],
    ['play', 'hover'], ['play', 'hover'], ['startLoop', 'drag'], ['startLoop', 'drag'],
    ['play', 'WIPL_SE_BT_TARGETTING'],
  ]);
  assert.equal(requests[1].sourceSymbol, requests[2].sourceSymbol);
  options.gain = 0.9;
  assert.deepEqual(requests[1].options, { gain: 0.5, pan: -0.25 });
  await audio.destroy();
});

test('an absent or failing inspection observer does not change audio playback', async (t) => {
  const env = environment(t);
  const manifest = {};
  Object.defineProperty(manifest, 'unread', {
    enumerable: true,
    get() { throw new Error('An inactive observer must not resolve an asset.'); },
  });
  assert.equal(await createAudio({ manifest }).play('unused'), false);
  const audio = createAudio({
    manifest: { click: { src: '/click.wav' } },
    onRequest: (request) => {
      request.options.gain = 0;
      throw new Error('Synthetic inspection error');
    },
  });
  await audio.unlock();
  const options = { gain: 0.75 };
  assert.equal(await audio.play('click', options), true);
  assert.equal(options.gain, 0.75);
  assert.equal(env.contexts.at(-1).gains.at(-1).gain.value, 0.75);
  await audio.destroy();
});

test('live sequence retains its voices through preview and HOME pauses, then resets on restart', async (t) => {
  const env = environment(t);
  const instances = [];
  const audio = createAudio({
    manifest: sequenceManifest,
    backgroundMode: 'realtime',
    realtimeFactory: async () => {
      const instance = realtimeFixture();
      instances.push(instance);
      return instance;
    },
  });
  await audio.unlock();
  assert.equal(await audio.startBackground(), true);
  audio.pauseBackground();
  audio.pauseMenuAudio();
  audio.resumeMenuAudio();
  assert.equal(audio.getStatus().backgroundPlaying, false);
  await audio.startBackground();
  audio.pauseMenuAudio();
  audio.resumeMenuAudio();
  assert.equal(instances.length, 1);
  assert.deepEqual(instances[0].events, [
    'play', ['pause', 5 * 1000 / 60], 'play', ['pause', 0], 'play',
  ]);
  audio.stopBackground(0);
  assert.deepEqual(instances[0].events.at(-1), ['destroy', 0]);
  await audio.startBackground();
  assert.equal(instances.length, 2);
  assert.deepEqual(instances[1].events, ['play']);
  assert.deepEqual(env.urls, []);
  assert.equal(audio.getStatus().backgroundMode, 'realtime');
  await audio.destroy();
  assert.deepEqual(instances[1].events.at(-1), ['destroy', 0]);
});

test('leaving while a live sequence initializes disposes it without delayed playback', async (t) => {
  environment(t);
  const initialization = deferred();
  const instance = realtimeFixture();
  const audio = createAudio({
    manifest: sequenceManifest,
    backgroundMode: 'realtime',
    realtimeFactory: () => initialization.promise,
  });
  await audio.unlock();
  const pending = audio.startBackground();
  audio.pauseBackground();
  initialization.resolve(instance);
  assert.equal(await pending, false);
  assert.deepEqual(instance.events, [['destroy', 0]]);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  await audio.destroy();
});

test('a live sequence initialized under HOME remains silent until HOME closes', async (t) => {
  environment(t);
  const initialization = deferred();
  const instance = realtimeFixture();
  const audio = createAudio({
    manifest: sequenceManifest,
    backgroundMode: 'realtime',
    realtimeFactory: () => initialization.promise,
  });
  await audio.unlock();
  const pending = audio.startBackground();
  audio.pauseMenuAudio();
  initialization.resolve(instance);
  assert.equal(await pending, true);
  assert.deepEqual(instance.events, []);
  audio.resumeMenuAudio();
  assert.deepEqual(instance.events, ['play']);
  await audio.destroy();
});

test('unavailable live playback is reported without substituting the prepared track', async (t) => {
  const env = environment(t);
  const errors = [];
  const audio = createAudio({
    manifest: sequenceManifest,
    backgroundMode: 'realtime',
    realtimeFactory: async () => { throw new Error('AudioWorklet unavailable'); },
    onError: (name, error) => errors.push([name, error.message]),
  });
  await audio.unlock();
  assert.equal(await audio.startBackground(), false);
  assert.deepEqual(errors, [['backgroundSequence', 'AudioWorklet unavailable']]);
  assert.deepEqual(env.urls, []);
  assert.deepEqual(audio.getStatus().failed, ['backgroundSequence']);
  await audio.destroy();
});

test('configuration defaults to prepared music and validates the explicit live choice', () => {
  assert.equal(normalizeConfig().audio.backgroundMode, 'prepared');
  assert.equal(normalizeConfig({ audio: { backgroundMode: 'realtime' } }).audio.backgroundMode, 'realtime');
  assert.throws(() => normalizeConfig({ audio: { backgroundMode: 'unknown' } }), /backgroundMode/);
});

test('first-click sound waits for gesture resume and reuses the preload', async (t) => {
  const resume = deferred();
  const env = environment(t, { resume });
  const audio = createAudio({ manifest: { click: { src: '/click.wav' } } });
  const unlocking = audio.unlock();
  const playing = audio.play('click');
  assert.equal(env.contexts[0].sources.length, 0);
  resume.resolve();
  assert.equal(await unlocking, true);
  assert.equal(await playing, true);
  assert.equal(env.contexts[0].sources[0].starts, 1);
  assert.deepEqual(env.urls, ['/click.wav']);
  await audio.destroy();
});

test('master volume applies before unlock, stays muted, and restores the selected level', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio();
  assert.equal(audio.setVolume(0.7), 0.7);
  await audio.unlock();
  const master = contexts[0].gains[0].gain;
  assert.equal(master.value, 0.7);
  audio.setMuted(true);
  audio.setVolume(0.3);
  assert.equal(master.value, 0);
  assert.equal(audio.getStatus().volume, 0.3);
  audio.setMuted(false);
  assert.equal(master.value, 0.3);
  assert.equal(audio.setVolume(-2), 0);
  assert.equal(master.value, 0);
  assert.equal(audio.setVolume(2), 1);
  assert.equal(master.value, 1);
  assert.equal(audio.setVolume(Number.NaN), 1);
  await audio.destroy();
});

test('banner sounds preserve loop metadata and replace the preceding source', async (t) => {
  const { contexts, urls } = environment(t);
  const audio = createAudio();
  await audio.unlock();
  await audio.playChannel('photo', { src: '/photo.wav', loop: false, loopStart: 2, loopEnd: 6 });
  const first = contexts[0].sources[0];
  assert.equal(first.loop, false);
  await audio.playChannel('mii', { src: '/mii.wav', loop: true, loopStart: 1.25, loopEnd: 7.75 });
  const second = contexts[0].sources[1];
  assert.equal(first.stops, 1);
  assert.equal(second.loop, true);
  assert.equal(second.loopStart, 1.25);
  assert.equal(second.loopEnd, 7.75);
  assert.equal(audio.getStatus().channelId, 'mii');
  audio.stopChannel();
  assert.equal(second.stops, 1);
  assert.equal(audio.getStatus().channelPlaying, false);
  await audio.playChannel('mii', { src: '/mii.wav', loop: false });
  assert.deepEqual(urls, ['/photo.wav', '/mii.wav']);
  contexts[0].sources[2].onended();
  assert.equal(audio.getStatus().channelPlaying, false);
  await audio.destroy();
});

test('leaving a preview cancels a sound still waiting on its download', async (t) => {
  const pending = deferred();
  const { contexts } = environment(t, { fetch: () => pending.promise });
  const audio = createAudio();
  await audio.unlock();
  const playing = audio.playChannel('slow', { src: '/slow.wav', loop: true });
  audio.stopChannel();
  pending.resolve(response());
  assert.equal(await playing, false);
  assert.equal(contexts[0].sources.length, 0);
  await audio.destroy();
});

test('switching channels prevents an older delayed download from replacing the current sound', async (t) => {
  const pending = deferred();
  const { contexts } = environment(t, {
    fetch: (url) => (url === '/slow.wav' ? pending.promise : response()),
  });
  const audio = createAudio();
  await audio.unlock();
  const slow = audio.playChannel('slow', { src: '/slow.wav', loop: true });
  assert.equal(await audio.playChannel('current', { src: '/current.wav', loop: true }), true);
  pending.resolve(response());
  assert.equal(await slow, false);
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(audio.getStatus().channelId, 'current');
  await audio.destroy();
});

test('HOME pauses looping menu tracks at their current offsets while UI sounds remain playable', async (t) => {
  const { contexts } = environment(t),
    audio = createAudio({
      manifest: {
        background: { src: '/background.wav', loopStart: 1, loopEnd: 7 },
        click: { src: '/click.wav' },
      },
    });
  await audio.unlock();
  await audio.startBackground();
  await audio.playChannel('mii', { src: '/mii.wav', loop: true, loopStart: 2, loopEnd: 6 });
  const context = contexts[0],
    background = context.sources[0],
    banner = context.sources[1];
  context.currentTime = 11;
  audio.pauseMenuAudio();
  audio.pauseMenuAudio();
  assert.equal(background.stops, 1);
  assert.equal(banner.stops, 1);
  assert.equal(audio.getStatus().channelId, 'mii');
  assert.equal(audio.getStatus().channelPlaying, false);
  background.onended();
  banner.onended();
  assert.equal(await audio.play('click'), true);
  context.currentTime = 30;
  audio.resumeMenuAudio();
  assert.deepEqual(
    context.sources.slice(3).map((source) => source.offset),
    [5, 3],
  );
  assert.equal(audio.getStatus().channelPlaying, true);
  audio.resumeMenuAudio();
  assert.equal(context.sources.length, 5);
  await audio.destroy();
});

test('a banner loaded during HOME waits for resume and stopping it while paused cancels that resume', async (t) => {
  const pending = deferred(),
    { contexts } = environment(t, { fetch: () => pending.promise });
  const audio = createAudio();
  await audio.unlock();
  const playing = audio.playChannel('slow', { src: '/slow.wav', loop: false });
  audio.pauseMenuAudio();
  pending.resolve(response());
  assert.equal(await playing, true);
  assert.equal(contexts[0].sources.length, 0);
  audio.stopChannel();
  audio.resumeMenuAudio();
  assert.equal(contexts[0].sources.length, 0);
  await audio.destroy();
});

test('HOME resumes a nonlooping banner without replaying its intro', async (t) => {
  const { contexts } = environment(t),
    audio = createAudio();
  await audio.unlock();
  await audio.playChannel('photo', { src: '/photo.wav', loop: false });
  contexts[0].currentTime = 2.75;
  audio.pauseMenuAudio();
  contexts[0].sources[0].onended();
  contexts[0].currentTime = 9;
  audio.resumeMenuAudio();
  assert.equal(contexts[0].sources[1].offset, 2.75);
  contexts[0].sources[1].onended();
  audio.pauseMenuAudio();
  audio.resumeMenuAudio();
  assert.equal(contexts[0].sources.length, 2);
  await audio.destroy();
});

test('held effects loop independently, preserve loop markers, and inherit master volume', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({
    manifest: {
      background: { src: '/background.wav' },
      drag: { src: '/drag.wav', loopStart: 1.25, loopEnd: 6.5, gain: 0.4 },
    },
  });
  await audio.unlock();
  await audio.startBackground();
  await audio.playChannel('shop', { src: '/shop.wav', loop: true });
  audio.setMuted(true);
  audio.setVolume(0.3);
  const first = audio.startLoop('drag'),
    duplicate = audio.startLoop('drag');
  assert.equal(first, duplicate);
  assert.equal(await first, true);
  const context = contexts[0],
    [background, banner, drag] = context.sources;
  assert.equal(drag.loop, true);
  assert.equal(drag.loopStart, 1.25);
  assert.equal(drag.loopEnd, 6.5);
  assert.equal(context.gains.at(-1).gain.value, 0.4);
  assert.equal(context.gains[0].gain.value, 0);
  audio.setMuted(false);
  assert.equal(context.gains[0].gain.value, 0.3);
  assert.equal(await audio.startLoop('drag'), true);
  assert.equal(context.sources.length, 3);
  audio.stopLoop('drag');
  audio.stopLoop('drag');
  assert.equal(drag.stops, 1);
  assert.equal(background.stops, 0);
  assert.equal(banner.stops, 0);
  assert.equal(audio.getStatus().backgroundPlaying, true);
  assert.equal(audio.getStatus().channelId, 'shop');
  await audio.destroy();
});

test('release during decode cancels a held effect and cannot cancel a later grab', async (t) => {
  const decode = deferred(),
    { contexts, urls } = environment(t, { decode });
  const audio = createAudio({ manifest: { drag: { src: '/drag.wav' } } });
  await audio.unlock();
  const released = audio.startLoop('drag');
  audio.stopLoop('drag');
  const newGrab = audio.startLoop('drag');
  decode.resolve();
  assert.equal(await released, false);
  assert.equal(await newGrab, true);
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(contexts[0].sources[0].starts, 1);
  assert.deepEqual(urls, ['/drag.wav']);
  audio.stopLoop('drag');
  await audio.destroy();
});

test('release before gesture resume prevents a held effect from starting later', async (t) => {
  const resume = deferred(),
    { contexts } = environment(t, { resume });
  const audio = createAudio({ manifest: { drag: { src: '/drag.wav' } } });
  const unlocking = audio.unlock(),
    playing = audio.startLoop('drag');
  audio.stopLoop('drag');
  resume.resolve();
  await unlocking;
  assert.equal(await playing, false);
  assert.equal(contexts[0].sources.length, 0);
  await audio.destroy();
});

test('destroy stops active held effects and invalidates pending decodes', async (t) => {
  const pending = deferred(),
    { contexts } = environment(t, {
      fetch: (url) => (url === '/slow.wav' ? pending.promise : response()),
    });
  const audio = createAudio({
    manifest: { drag: { src: '/drag.wav' }, slow: { src: '/slow.wav' } },
  });
  await audio.unlock();
  await audio.startLoop('drag');
  const loading = audio.startLoop('slow');
  await audio.destroy();
  pending.resolve(response());
  assert.equal(await loading, false);
  assert.equal(await audio.startLoop('drag'), false);
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(contexts[0].sources[0].stops, 1);
  assert.equal(contexts[0].state, 'closed');
});

test('a pending drag loop starts with its latest movement gain and exact source alias', async (t) => {
  const decode = deferred();
  const { contexts } = environment(t, { decode });
  const audio = createAudio({
    manifest: {
      drag: {
        src: '/drag.wav',
        gain: 0.5,
        sourceSymbol: 'WIPL_SE_CH_DRAG',
        loopStart: 0.1,
        loopEnd: 0.8,
      },
    },
  });
  await audio.unlock();
  const started = audio.startLoop('WIPL_SE_CH_DRAG', { gain: 0 });
  audio.setLoop('WIPL_SE_CH_DRAG', { gain: 0.2 });
  decode.resolve();
  assert.equal(await started, true);
  assert.equal(contexts[0].gains.at(-1).gain.value, 0.1);
  assert.equal(contexts[0].sources.at(-1).loopStart, 0.1);
  audio.setLoop('WIPL_SE_CH_DRAG', { gain: 0 });
  assert.equal(contexts[0].gains.at(-1).gain.value, 0);
  audio.stopLoop('WIPL_SE_CH_DRAG');
  assert.equal(contexts[0].sources.at(-1).stops, 1);
  await audio.destroy();
});

test('background suspension keeps the loop cursor through its fade and ignores stale completion', async (t) => {
  const { contexts, urls } = environment(t);
  const audio = createAudio({
    manifest: { background: { src: '/background.wav', loopStart: 1, loopEnd: 7 } },
  });
  await audio.unlock();
  await audio.startBackground();
  const context = contexts[0];
  const original = context.sources[0];
  context.currentTime = 11;
  audio.pauseBackground();
  audio.pauseBackground();
  assert.equal(original.stops, 1);
  assert.equal(original.stopTime, 11 + 5 / 60);
  original.onended();
  context.currentTime = 40;
  await audio.startBackground();
  const resumed = context.sources[1];
  assert.ok(Math.abs(resumed.offset - (5 + 5 / 60)) < 1e-12);
  assert.equal(resumed.buffer, original.buffer);
  assert.equal(resumed.loopStart, 1);
  assert.equal(resumed.loopEnd, 7);
  original.onended();
  assert.equal(audio.getStatus().backgroundPlaying, true);
  assert.equal(await audio.startBackground(), false);
  assert.deepEqual(urls, ['/background.wav']);
  await audio.destroy();
});

test('preview return resumes BGM after zoom, while full HOME restart discards its suspended cursor', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: { background: { src: '/background.wav' } } });
  await audio.unlock();
  const menu = createMenuState({
    channels: [
      { id: 'mii', audio: { src: '/mii.wav', loop: true } },
      { id: 'photo', audio: { src: '/photo.wav', loop: true } },
    ],
  });
  const sync = createMenuAudioSync(audio);
  menu.subscribe(sync);
  const settle = () => new Promise(setImmediate);
  await settle();
  const context = contexts[0];
  const firstBackground = context.sources[0];
  const backgroundSources = () =>
    context.sources.filter((source) => source.buffer === firstBackground.buffer);
  context.currentTime = 4.5;
  menu.selectChannel(0);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  menu.advance(DEFAULT_TIMING.select);
  await settle();
  menu.changePreview(1);
  menu.advance(DEFAULT_TIMING.preview);
  await settle();
  assert.equal(backgroundSources().length, 1);

  context.currentTime = 10;
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter);
  sync(menu.getState(), { homeSoundInitialized: true });
  context.currentTime = 30;
  menu.closeHome();
  menu.advance(DEFAULT_TIMING.homeExit);
  assert.equal(backgroundSources().length, 1, 'closing HOME inside a preview must not resume BGM');
  assert.equal(audio.getStatus().channelPlaying, true);
  menu.back();
  menu.advance(DEFAULT_TIMING.back - 1);
  assert.equal(backgroundSources().length, 1, 'return zoom still owns the audio boundary');
  context.currentTime = 40;
  menu.advance(1);
  await settle();
  assert.equal(backgroundSources().length, 2);
  assert.ok(Math.abs(backgroundSources()[1].offset - (4.5 + 5 / 60)) < 1e-12);
  sync(menu.getState());
  assert.equal(backgroundSources().length, 2, 'settled render updates must not restart music');

  context.currentTime = 42;
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  await settle();
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter);
  sync(menu.getState(), { homeSoundInitialized: true });
  const sourcesBeforeRestart = context.sources.length;
  sync({ ...menu.getState(), screen: 'restarting', overlay: null, transition: null });
  assert.equal(
    context.sources.length,
    sourcesBeforeRestart,
    'reboot must not briefly resume old tracks',
  );
  assert.equal(audio.getStatus().channelId, null);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  context.currentTime = 60;
  menu.finishHome({ returnToMenu: true });
  await settle();
  assert.equal(backgroundSources().length, 3);
  assert.equal(
    backgroundSources()[2].offset,
    0,
    'a full HOME reboot intentionally starts fresh music',
  );
  await audio.destroy();
});

test('preview suspension cancels a pending BGM load without starting it under HOME', async (t) => {
  const pending = deferred();
  const { contexts } = environment(t, { fetch: () => pending.promise });
  const audio = createAudio({ manifest: { background: { src: '/background.wav' } } });
  await audio.unlock();
  const starting = audio.startBackground();
  audio.pauseBackground();
  audio.pauseMenuAudio();
  pending.resolve(response());
  assert.equal(await starting, false);
  audio.resumeMenuAudio();
  assert.equal(contexts[0].sources.length, 0);
  await audio.startBackground();
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(
    contexts[0].sources[0].offset,
    0,
    'an unheard intro starts only when the menu returns',
  );
  await audio.destroy();
});

test('HOME blackout retires effects, held loops and detached fading tracks without closing audio', async (t) => {
  const { contexts, urls } = environment(t);
  const audio = createAudio({
    manifest: {
      background: { src: '/background.wav' },
      focus: { src: '/focus.wav' },
      scroll: { src: '/scroll.wav' },
    },
  });
  await audio.unlock();
  await audio.startBackground();
  await audio.playChannel('banner', { src: '/banner.wav', loop: true });
  await audio.play('focus');
  await audio.startLoop('scroll');
  const context = contexts[0];
  const [background, banner, focus, scroll] = context.sources;
  context.currentTime = 2;
  audio.pauseBackground(100);
  assert.equal(background.stopTime, 2.1);
  audio.setVolume(0.4);
  audio.setMuted(true);
  audio.resetAllSound();
  assert.equal(background.stops, 2, 'blackout replaces the detached fade with an immediate stop');
  assert.equal(background.stopTime, 0);
  assert.deepEqual([banner.stops, focus.stops, scroll.stops], [1, 1, 1]);
  assert.equal(audio.getStatus().channelId, null);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  assert.equal(context.state, 'running');
  assert.equal(audio.getStatus().volume, 0.4);
  assert.equal(audio.getStatus().muted, true);
  audio.resetAllSound();
  assert.deepEqual([background.stops, banner.stops, focus.stops, scroll.stops], [2, 1, 1, 1]);
  audio.setMuted(false);
  assert.equal(await audio.play('focus'), true, 'a new scene can play through the same context');
  assert.equal(await audio.startLoop('scroll'), true, 'the old loop identity was retired');
  assert.equal(urls.filter((url) => url === '/focus.wav').length, 1, 'decoded buffers remain cached');
  await audio.destroy();
});

test('HOME blackout cancels pending cue, loop, background and banner decodes', async (t) => {
  const decoding = deferred();
  const { contexts } = environment(t, { decode: decoding });
  const audio = createAudio({
    manifest: {
      background: { src: '/background.wav' },
      focus: { src: '/focus.wav' },
      scroll: { src: '/scroll.wav' },
    },
  });
  await audio.unlock();
  const oldRequests = [
    audio.play('focus'),
    audio.startLoop('scroll'),
    audio.startBackground(),
    audio.playChannel('banner', { src: '/banner.wav' }),
  ];
  audio.resetAllSound();
  const newLoop = audio.startLoop('scroll');
  decoding.resolve();
  assert.deepEqual(await Promise.all(oldRequests), [false, false, false, false]);
  assert.equal(await newLoop, true, 'an old completion cannot cancel the replacement loop');
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(contexts[0].sources[0].loop, true);
  assert.equal(await audio.play('focus'), true, 'cached completion is valid for a new request');
  assert.equal(contexts[0].sources.length, 2);
  await audio.destroy();
});

test('HOME blackout cancels requests waiting for gesture resume', async (t) => {
  const resuming = deferred();
  const { contexts } = environment(t, { resume: resuming });
  const audio = createAudio({ manifest: { focus: { src: '/focus.wav' } } });
  const unlocking = audio.unlock();
  const oldCue = audio.play('focus');
  const oldLoop = audio.startLoop('focus');
  audio.resetAllSound();
  resuming.resolve();
  assert.equal(await unlocking, true);
  assert.equal(await oldCue, false);
  assert.equal(await oldLoop, false);
  assert.equal(contexts[0].sources.length, 0);
  assert.equal(await audio.play('focus'), true);
  await audio.destroy();
});

test('HOME blackout destroys a live background that finishes initializing later', async (t) => {
  environment(t);
  const initialization = deferred();
  const instance = realtimeFixture();
  const audio = createAudio({
    manifest: sequenceManifest,
    backgroundMode: 'realtime',
    realtimeFactory: () => initialization.promise,
  });
  await audio.unlock();
  const starting = audio.startBackground();
  audio.resetAllSound();
  initialization.resolve(instance);
  assert.equal(await starting, false);
  assert.deepEqual(instance.events, [['destroy', 0]]);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  await audio.destroy();
});

test('HOME pauses existing effects after five updates while new HOME cues stay live', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: { cue: { src: '/cue.wav', gain: 0.4 } } });
  await audio.unlock();
  await audio.play('cue');
  const context = contexts[0];
  const oldCue = context.sources[0];
  const pauseGain = context.gains[1].gain;
  context.currentTime = 1;
  audio.pauseMenuAudio();
  audio.pauseMenuAudio();
  assert.equal(oldCue.stopTime, 1 + 5 / 60);
  assert.equal(audio.getStatus().effectCount, 1);
  assert.equal(audio.getStatus().pausedEffectCount, 1);
  assert.equal(oldCue.stops, 1, 'repeated pause must not consume another fade');
  assert.deepEqual(pauseGain.events.map(event => event[0]), [
    'cancel', 'set', 'set', 'set', 'set', 'set', 'set',
  ]);
  assert.deepEqual(pauseGain.events.slice(2).map(event => event[1]), [
    0.800000011920929, 0.6000000238418579, 0.3999999761581421,
    0.19999998807907104, 0,
  ]);
  context.currentTime = 2;
  oldCue.onended();
  await audio.play('cue');
  const homeCue = context.sources[1];
  assert.equal(homeCue.starts, 1);
  assert.equal(audio.getStatus().effectCount, 2);
  assert.equal(audio.getStatus().pausedEffectCount, 1);
  context.currentTime = 3;
  audio.resumeMenuAudio();
  audio.resumeMenuAudio();
  assert.equal(context.sources.length, 3);
  assert.equal(audio.getStatus().pausedEffectCount, 0);
  assert.equal(context.sources[2].offset, 1 + 5 / 60);
  assert.equal(homeCue.stops, 0, 'a newly started HOME cue is not restarted or stopped');
  const resumedGain = context.gains[5].gain.events;
  assert.equal(resumedGain[1][1], 0);
  assert.deepEqual(resumedGain.at(-1), ['set', 1, 3 + 5 / 60]);
  oldCue.onended();
  context.currentTime = 4;
  audio.pauseMenuAudio();
  assert.equal(context.sources[2].stops, 1, 'a stale ended event cannot retire the resumed cue');
  await audio.destroy();
});

test('effects and held loops requested before HOME wait for resume after delayed decoding', async (t) => {
  const decoding = deferred();
  const { contexts } = environment(t, { decode: decoding });
  const audio = createAudio({ manifest: { cue: { src: '/cue.wav' } } });
  await audio.unlock();
  const oldCue = audio.play('cue');
  const oldLoop = audio.startLoop('cue');
  audio.pauseMenuAudio();
  const homeCue = audio.play('cue');
  decoding.resolve();
  assert.deepEqual(await Promise.all([oldCue, oldLoop, homeCue]), [true, true, true]);
  assert.equal(contexts[0].sources.length, 1, 'only the post-HOME request starts');
  audio.resumeMenuAudio();
  assert.equal(contexts[0].sources.length, 3);
  assert.deepEqual(contexts[0].sources.slice(1).map(source => source.offset), [0, 0]);
  assert.equal(contexts[0].sources[2].loop, true);
  await audio.destroy();
});

test('HOME effect ownership starts before gesture resume and release cancels a paused loop', async (t) => {
  const resuming = deferred();
  const { contexts } = environment(t, { resume: resuming });
  const audio = createAudio({ manifest: { cue: { src: '/cue.wav' } } });
  const unlocking = audio.unlock();
  const cue = audio.play('cue');
  const loop = audio.startLoop('cue');
  audio.pauseMenuAudio();
  resuming.resolve();
  await unlocking;
  assert.deepEqual(await Promise.all([cue, loop]), [true, true]);
  assert.equal(contexts[0].sources.length, 0);
  audio.stopLoop('cue');
  audio.resumeMenuAudio();
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(contexts[0].sources[0].loop, false);
  await audio.destroy();
});

test('held effect cursor accounts for pitch, wraps its source loop and keeps live parameter changes', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({
    manifest: { scroll: { src: '/scroll.wav', loopStart: 1, loopEnd: 3, gain: 0.5 } },
  });
  await audio.unlock();
  await audio.startLoop('scroll', { pitch: 2 });
  const context = contexts[0];
  context.currentTime = 0.5;
  audio.setLoop('scroll', { pitch: 1 });
  context.currentTime = 2;
  audio.pauseMenuAudio();
  context.currentTime = 5;
  audio.setLoop('scroll', { gain: 0.2, pitch: 0.5 });
  audio.resumeMenuAudio();
  assert.ok(Math.abs(context.sources[1].offset - (2.5 + 5 / 60)) < 1e-12);
  assert.equal(context.sources[1].playbackRate.value, 0.5);
  assert.equal(context.gains.at(-1).gain.value, 0.1);
  context.currentTime = 6;
  audio.pauseMenuAudio();
  context.currentTime = 10;
  audio.resumeMenuAudio();
  assert.ok(Math.abs(context.sources[2].offset - 1.125) < 1e-12);
  audio.stopLoop('scroll');
  context.sources[0].onended();
  context.sources[1].onended();
  assert.equal(await audio.startLoop('scroll'), true);
  assert.equal(context.sources[3].offset, 0, 'releasing a paused or resumed loop retires its cursor');
  await audio.destroy();
});

test('HOME fade reversal uses the current native step and does not skip future samples', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: { cue: { src: '/cue.wav' } } });
  await audio.unlock();
  await audio.play('cue');
  const context = contexts[0];
  context.currentTime = 1;
  audio.pauseMenuAudio();
  context.currentTime = 1 + 2 / 60;
  audio.resumeMenuAudio();
  assert.equal(context.sources[1].offset, 1 + 2 / 60);
  assert.equal(context.sources[0].stopTime, 0, 'the original pending stop is replaced immediately');
  const gain = context.gains[3].gain;
  assert.equal(gain.events[1][1], 0.6000000238418579);
  // Native float32 5 * (1 - 0.6f) truncates to one update, not two.
  assert.deepEqual(gain.events.at(-1), ['set', 1, context.currentTime + 1 / 60]);
  context.sources[0].onended();
  context.currentTime = 2;
  audio.pauseMenuAudio();
  assert.equal(context.sources[1].stops, 1);
  await audio.destroy();
});

test('an effect that finishes during the HOME fade is not replayed on resume', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: { cue: { src: '/cue.wav' } } });
  await audio.unlock();
  await audio.play('cue');
  const context = contexts[0];
  context.currentTime = 7.99;
  audio.pauseMenuAudio();
  context.currentTime = 8;
  context.sources[0].onended();
  context.currentTime = 10;
  audio.resumeMenuAudio();
  assert.equal(context.sources.length, 1);
  await audio.destroy();
});

test('blackout during an effect pause cancels its fade and retained cursor', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: { cue: { src: '/cue.wav' } } });
  await audio.unlock();
  await audio.play('cue');
  await audio.startLoop('cue');
  const context = contexts[0];
  context.currentTime = 1;
  audio.pauseMenuAudio();
  context.currentTime += 1 / 60;
  audio.resetAllSound();
  assert.deepEqual(context.sources.map(source => source.stopTime), [0, 0]);
  assert.equal(audio.getStatus().effectCount, 0);
  assert.equal(audio.getStatus().pausedEffectCount, 0);
  for (const source of context.sources) source.onended();
  audio.resumeMenuAudio();
  assert.equal(context.sources.length, 2);
  assert.equal(await audio.startLoop('cue'), true);
  assert.equal(context.sources[2].offset, 0);
  await audio.destroy();
});

test('leaving HOME before a deferred effect loads releases only its pause ownership', async (t) => {
  const decoding = deferred();
  const { contexts } = environment(t, { decode: decoding });
  const audio = createAudio({ manifest: { cue: { src: '/cue.wav' } } });
  await audio.unlock();
  const playing = audio.play('cue');
  audio.pauseMenuAudio();
  audio.resumeMenuAudio();
  decoding.resolve();
  assert.equal(await playing, true);
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(contexts[0].sources[0].offset, 0);
  await audio.destroy();
});

function homeAudioScene(audio, context, menuOptions = {}) {
  // Authored empty tracks retain only the controller's source update counts.
  // These scene/audio lifetime tests do not depend on extracted artwork.
  const frames = {
    hmMenu_strt: 21, optn_bar_psh: 41, hmMenu_bar_psh: 20, close_bar_psh: 40,
    cntrl_dwn: 40, btry_wht: 1, btry_gry: 1, sound_ylw: 1, sound_gry: 1,
    vb_btn_wht_psh: 25, vb_btn_ylw_psh: 25, hmMenu_fnsh: 20,
    cntBtn_psh: 17, cmn_msg_in: 25, cmn_msg_btn_psh: 21,
  };
  const source = {
    root: { name: 'Root', flags: 1, alpha: 255,
      children: [{ name: 'T_Dialog', flags: 1, text: '' }] },
    materials: [],
    groups: {},
    animations: Object.fromEntries(Object.entries(frames).map(([name, count]) =>
      [`th_HomeBtn_d_${name}`, { frames: count, targets: [] }])),
  };
  const events = [];
  const menu = createMenuState(menuOptions);
  const sync = createMenuAudioSync(audio);
  menu.subscribe(sync);
  const home = createHomeOverlay(source, {
    onSoundInitialize() {
      events.push('initialize');
      sync(menu.getState(), { homeSoundInitialized: true });
    },
    onSound(symbol) {
      events.push(symbol);
      void audio.play(symbol);
    },
    onClose() {
      events.push('close');
      menu.finishHome();
    },
    onReturn() {
      events.push('blackout');
      audio.resetAllSound();
      sync({ ...menu.getState(), screen: 'restarting', overlay: null, transition: null });
    },
  });
  return {
    home, menu, sync, events,
    open() {
      assert.equal(menu.openHome(), true);
      home.open();
    },
    advance(frames) {
      context.currentTime += frames / 60;
      home.advance(frames);
      menu.advance(frames * 1000 / 60);
    },
  };
}

test('HOME pauses existing scene audio at entrance completion before its opening cue', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: {
    background: { src: '/background.wav' },
    old: { src: '/old.wav' },
    duringEntrance: { src: '/during-entrance.wav' },
    HOMESE_HOME_BUTTON: { src: '/home-open.wav' },
    HOMESE_RETURN_APP: { src: '/home-close.wav' },
  } });
  await audio.unlock();
  const context = contexts[0];
  const scene = homeAudioScene(audio, context);
  await new Promise(setImmediate);
  await audio.play('old');
  const [background, old] = context.sources;
  scene.open();
  scene.advance(20.5);
  assert.equal(background.stops, 0);
  assert.equal(old.stops, 0);
  assert.equal(audio.getStatus().backgroundPlaying, true);
  assert.equal(audio.getStatus().pausedEffectCount, 0);
  await audio.play('duringEntrance');
  const late = context.sources.at(-1);

  scene.advance(0.5);
  const pauseTime = context.currentTime;
  await new Promise(setImmediate);
  const openingCue = context.sources.at(-1);
  assert.deepEqual(scene.events, ['initialize', 'HOMESE_HOME_BUTTON']);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  assert.equal(audio.getStatus().pausedEffectCount, 2);
  assert.equal(old.stopTime, pauseTime + 5 / 60);
  assert.equal(late.stopTime, pauseTime + 5 / 60);
  assert.equal(openingCue.stops, 0, 'the opening cue is outside the paused snapshot');
  scene.sync(scene.menu.getState());
  scene.sync(scene.menu.getState(), { homeSoundInitialized: true });
  assert.equal(old.stops, 1, 'repeated scene publications cannot resnapshot HOME cues');

  assert.equal(scene.home.back(), true);
  scene.advance(38.5);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  scene.advance(0.5);
  assert.equal(audio.getStatus().backgroundPlaying, true);
  const resumed = context.sources.find(source => source !== background &&
    source.buffer === background.buffer);
  assert.equal(resumed.offset, pauseTime, 'the entrance remains part of the retained BGM cursor');
  assert.equal(audio.getStatus().pausedEffectCount, 0);
  assert.equal(openingCue.stops, 0);
  assert.equal(scene.events.filter(event => event === 'initialize').length, 1);
  await audio.destroy();
});

test('canceled or unadvanced HOME entrance never acquires audio pause ownership', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: { background: { src: '/background.wav' } } });
  await audio.unlock();
  const context = contexts[0];
  const scene = homeAudioScene(audio, context);
  await new Promise(setImmediate);
  const background = context.sources[0];
  scene.open();
  scene.advance(20.5);
  for (let index = 0; index < 10; index += 1) scene.sync(scene.menu.getState());
  assert.equal(background.stops, 0, 'scene publications do not advance the native boundary');
  scene.home.reset();
  scene.menu.finishHome();
  scene.advance(100);
  scene.sync(scene.menu.getState(), { homeSoundInitialized: true });
  assert.deepEqual(scene.events, []);
  assert.equal(background.stops, 0);
  assert.equal(context.sources.length, 1, 'canceling entry must not resume a new BGM source');
  scene.open();
  scene.advance(20.5);
  assert.equal(background.stops, 0);
  scene.advance(5);
  assert.deepEqual(scene.events, ['initialize', 'HOMESE_HOME_BUTTON']);
  assert.equal(background.stops, 1, 'a larger update still initializes exactly once');
  await audio.destroy();
});

test('HOME entrance and close preserve a preview-owned background suspension', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: { background: { src: '/background.wav' } } });
  await audio.unlock();
  const context = contexts[0];
  const scene = homeAudioScene(audio, context, {
    timing: { select: 0 },
    channels: [{ id: 'mii', audio: { src: '/banner.wav', loop: true } }],
  });
  await new Promise(setImmediate);
  const background = context.sources[0];
  scene.menu.selectChannel(0);
  await new Promise(setImmediate);
  const banner = context.sources.at(-1);
  scene.open();
  scene.advance(20);
  assert.equal(banner.stops, 0);
  assert.equal(audio.getStatus().channelPlaying, true);
  scene.advance(1);
  assert.equal(banner.stops, 1);
  assert.equal(audio.getStatus().channelPlaying, false);
  scene.home.back();
  scene.advance(39);
  assert.equal(audio.getStatus().channelPlaying, true);
  assert.equal(audio.getStatus().backgroundPlaying, false);
  assert.equal(context.sources.filter(source => source.buffer === background.buffer).length, 1);
  assert.equal(context.sources.filter(source => source.buffer === banner.buffer).length, 2);
  await audio.destroy();
});

test('HOME confirmed return retires initialized audio before releasing its pause', async (t) => {
  const { contexts } = environment(t);
  const audio = createAudio({ manifest: {
    background: { src: '/background.wav' },
    cue: { src: '/cue.wav' },
    HOMESE_HOME_BUTTON: { src: '/home-open.wav' },
  } });
  await audio.unlock();
  const context = contexts[0];
  const scene = homeAudioScene(audio, context);
  await new Promise(setImmediate);
  await audio.play('cue');
  const background = context.sources[0];
  scene.open();
  scene.advance(21);
  await new Promise(setImmediate);
  assert.equal(scene.home.activate('return'), true);
  scene.advance(16 + 24);
  assert.equal(scene.home.activate('home-yes'), true);
  scene.advance(20 + 29);
  const count = context.sources.length;
  assert.equal(audio.getStatus().pausedEffectCount, 1);
  scene.advance(1);
  assert.equal(scene.events.at(-1), 'blackout');
  assert.equal(context.sources.length, count, 'blackout cannot briefly resume the old sources');
  assert.equal(audio.getStatus().backgroundPlaying, false);
  assert.equal(audio.getStatus().effectCount, 0);
  scene.menu.finishHome({ returnToMenu: true });
  await new Promise(setImmediate);
  const fresh = context.sources.filter(source => source.buffer === background.buffer);
  assert.equal(fresh.length, 2);
  assert.equal(fresh[1].offset, 0);
  await audio.destroy();
});
