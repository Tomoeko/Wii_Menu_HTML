import { Renderer } from './renderer.js';
import { BitmapFont } from './font.js';
import { channelPreviewFontDescriptor, MENU_FALLBACK_FONT } from './channel-preview-fonts.js';
import { createAudio } from './audio.js';
import { poseLayout } from './animation.js';
import { poseEmptyDiscBanner } from './disc-animation.js';
import { poseChannel } from './channel-animation.js';
import { mergeChannelCatalog, readCustomChannelCatalog } from './channel-catalog.js';
import { createDisplay, prepareAspectLayout } from './display.js';
import { normalizeConfig } from './config.js';
import { languageMask } from './language.js';

const element = (id) => document.getElementById(id);
const status = element('status');
const replay = element('replay');
const pause = element('pause');
const stopSound = element('stop-sound');
const surfaces = [];
const discLabels = { T_Bar: 'Disc Channel', T_Comment0: 'Please insert a disc.' };
let channel;
let audio;
let sound;
let playing = false;
let ready = false;
let disposed = false;
let previousTime;
let elapsed = 0;
let animationRequest;
let soundRequest = 0;
let soundPending = false;
let soundPoll;

async function readJson(url, fallback) {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 404 && fallback !== undefined) return fallback;
  if (!response.ok) {
    throw new Error('A required resource is missing. Prepare the menu assets first.');
  }
  return response.json();
}

function showStatus(message, error = false) {
  if (disposed) return;
  status.textContent = message;
  status.dataset.error = String(error);
}

function discPose(layout, kind, frame) {
  const name = kind === 'icon' ? 'my_DiskCh_b' : 'my_DiskCh_a_Start';
  const animation = layout.animations?.[name];
  if (!animation)
    throw new Error('The Disc Channel animation is missing. Prepare the assets again.');
  // The production empty banner advances twice per native scene update.
  if (kind === 'banner') return poseEmptyDiscBanner(layout, frame);
  return poseLayout(layout, [
    {
      animation,
      frame: frame % animation.frames,
      loop: false,
    },
  ]);
}

async function createSurface(kind, layout, display, manifest) {
  const output = element(kind);
  const raster = document.createElement('canvas');
  raster.width = display.framebufferWidth;
  raster.height = display.framebufferHeight;
  const renderer = new Renderer(raster, { display });
  const source = prepareAspectLayout(layout, display);
  await renderer.load(source);

  const fonts = new Map();
  const loadedFonts = new Map();
  const fontNames = new Set(source.fonts || []);
  if (manifest.fonts?.[MENU_FALLBACK_FONT]) fontNames.add(MENU_FALLBACK_FONT);
  for (const name of fontNames) {
    const descriptor = channelPreviewFontDescriptor(manifest, name);
    if (!loadedFonts.has(descriptor.url)) {
      const font = new BitmapFont(await readJson('/assets/' + descriptor.url), renderer);
      await font.load();
      loadedFonts.set(descriptor.url, font);
    }
    fonts.set(name, loadedFonts.get(descriptor.url));
  }
  const fontFor = (pane, posedLayout = source) => {
    const font = fonts.get(posedLayout.fonts?.[pane.font]) || fonts.get(MENU_FALLBACK_FONT);
    if (!font) throw new Error('This channel references a font that is not prepared.');
    return font;
  };
  const poseOptions = {
    language: 'ENG',
    networkConfigured: false,
    measureText: (text, pane, posedLayout) =>
      fontFor(pane, posedLayout).width(text, pane.fontSize, pane.charSpace),
  };
  const icon = {
    x: display.halfWidth - display.thumbnailHalfWidth,
    y: display.halfHeight - display.thumbnailHalfHeight,
    w: display.thumbnailHalfWidth * 2,
    h: display.thumbnailHalfHeight * 2,
  };
  const scaleX = raster.width / display.width;
  const scaleY = raster.height / display.height;
  // Crop whole framebuffer pixels before CSS applies the selected TV aspect.
  // A standalone IPL root supplies the scale inherited from a menu grid anchor.
  const crop =
    kind === 'icon'
      ? {
          x: Math.floor(icon.x * scaleX),
          y: Math.floor(icon.y * scaleY),
          width: Math.ceil((icon.x + icon.w) * scaleX) - Math.floor(icon.x * scaleX),
          height: Math.ceil((icon.y + icon.h) * scaleY) - Math.floor(icon.y * scaleY),
        }
      : { x: 0, y: 0, width: raster.width, height: raster.height };
  output.width = crop.width;
  output.height = crop.height;
  const aspect =
    kind === 'icon'
      ? (icon.w / display.width) * display.outputAspect * (display.height / icon.h)
      : display.outputAspect;
  output.style.aspectRatio = String(aspect);
  const context = output.getContext('2d');
  if (!context) throw new Error('This browser cannot display the channel preview.');
  const prepared = { ...channel, [kind]: source };

  return {
    draw(frame) {
      const pose =
        channel.id === 'disc'
          ? discPose(source, kind, frame)
          : poseChannel(prepared, kind, frame, poseOptions);
      renderer.clear();
      renderer.clip(kind === 'icon' ? icon : null);
      renderer.draw(pose, {
        exclude: languageMask(pose),
        onPane(pane, matrix, alpha) {
          if (pane.type !== 'txt1' || alpha <= 0) return;
          const text =
            channel.id === 'disc' && Object.hasOwn(discLabels, pane.name)
              ? discLabels[pane.name]
              : pane.text;
          if (!text) return;
          fontFor(pane, pose).drawPane(text, pane, matrix, alpha, {
            material: pose.materials[pane.material],
          });
        },
      });
      renderer.clip(null);
      context.clearRect(0, 0, output.width, output.height);
      context.drawImage(
        raster,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        output.width,
        output.height,
      );
    },
  };
}

function cancelDraw() {
  if (animationRequest !== undefined) cancelAnimationFrame(animationRequest);
  animationRequest = undefined;
  previousTime = undefined;
}

function requestDraw() {
  if (!ready || disposed || document.hidden || animationRequest !== undefined) return;
  animationRequest = requestAnimationFrame(tick);
}

function setPlaying(value) {
  playing = value;
  cancelDraw();
  pause.textContent = playing ? 'Pause animation' : 'Resume animation';
  requestDraw();
}

function fail(error) {
  ready = false;
  playing = false;
  soundRequest++;
  soundPending = false;
  cancelDraw();
  clearTimeout(soundPoll);
  audio?.stopChannel();
  replay.disabled = true;
  pause.disabled = true;
  stopSound.disabled = true;
  showStatus(error.message || 'The channel could not be displayed.', true);
}

function tick(timestamp) {
  animationRequest = undefined;
  if (!ready || disposed || document.hidden) return;
  if (previousTime !== undefined && playing) {
    elapsed += Math.max(0, Math.min(timestamp - previousTime, 100));
  }
  previousTime = timestamp;
  try {
    // Production animations accept fractional updates on faster displays.
    for (const surface of surfaces) surface.draw(elapsed * 0.06);
    if (playing) requestDraw();
  } catch (error) {
    fail(error);
  }
}

function watchSound() {
  clearTimeout(soundPoll);
  const active = soundPending || Boolean(audio?.getStatus().channelId);
  stopSound.disabled = !active;
  // Update the Stop button after a one-shot ends without redrawing paused art.
  if (active && !disposed && !document.hidden) soundPoll = setTimeout(watchSound, 250);
}

replay.addEventListener('click', async () => {
  if (!ready || disposed) return;
  const request = ++soundRequest;
  audio.stopChannel();
  elapsed = 0;
  soundPending = Boolean(sound);
  setPlaying(!sound);
  pause.disabled = Boolean(sound);
  watchSound();
  if (!sound) {
    showStatus('Replaying animation. This channel has no preview sound.');
    return;
  }
  showStatus('Preparing the opening and sound…');
  try {
    // Unlock starts inside the gesture. Hold frame zero until decoding finishes
    // so the opening and its sound begin together, including on the first replay.
    const unlocked = await audio.unlock();
    if (request !== soundRequest || disposed) return;
    const started = unlocked && (await audio.playChannel(channel.id, sound));
    if (request !== soundRequest || disposed) return;
    if (!started) {
      showStatus('Replaying animation. The sound could not be played.', true);
    } else if (audio.getStatus().muted) {
      showStatus('Replaying animation. Sound is muted in your menu settings.');
    } else {
      showStatus('Replaying the opening animation and sound.');
    }
  } catch {
    if (request !== soundRequest || disposed) return;
    showStatus('Replaying animation. Check the channel audio file.', true);
  } finally {
    if (request === soundRequest && !disposed) {
      soundPending = false;
      pause.disabled = false;
      setPlaying(true);
      watchSound();
    }
  }
});

pause.addEventListener('click', () => setPlaying(!playing));
stopSound.addEventListener('click', () => {
  soundRequest++;
  audio.stopChannel();
  if (soundPending) {
    soundPending = false;
    pause.disabled = false;
    setPlaying(true);
  }
  watchSound();
  showStatus('Sound stopped.');
});

document.addEventListener('visibilitychange', () => {
  cancelDraw();
  clearTimeout(soundPoll);
  if (document.hidden) audio?.pauseMenuAudio();
  else {
    audio?.resumeMenuAudio();
    watchSound();
    requestDraw();
  }
});
window.addEventListener('pagehide', (event) => {
  cancelDraw();
  clearTimeout(soundPoll);
  if (event.persisted) audio?.pauseMenuAudio();
  else {
    disposed = true;
    soundRequest++;
    void audio?.destroy();
  }
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted || disposed) return;
  audio?.resumeMenuAudio();
  watchSound();
  requestDraw();
});

async function initialize() {
  const [manifest, imported, custom, rawConfig, sounds] = await Promise.all([
    readJson('/assets/manifest.json'),
    readJson('/assets/channels.json', { channels: [], defaultOrder: [] }),
    readCustomChannelCatalog(),
    readJson('/config.json', {}),
    readJson('/assets/audio.json', {}),
  ]);
  if (disposed) return;
  const config = normalizeConfig(rawConfig);
  const id = new URLSearchParams(location.search).get('channel');
  const catalog = mergeChannelCatalog(imported, custom);
  channel =
    id === 'disc'
      ? { id, title: 'Disc Channel' }
      : catalog.channels.find((entry) => entry.id === id);
  if (!channel) {
    throw new Error('This channel is not installed. Return to Channel Manager to choose one.');
  }
  element('title').textContent = channel.title;
  document.title = channel.title + ' — Channel preview';
  const display = createDisplay(config.display.aspectRatio);
  for (const kind of ['icon', 'banner']) {
    const descriptor =
      id === 'disc'
        ? manifest.layouts?.[kind === 'icon' ? 'my_DiskCh_b' : 'my_DiskCh_a']?.url
        : channel[`${kind}Layout`];
    if (!descriptor) throw new Error(`This channel's ${kind} is missing. Prepare it again.`);
    const layout = await readJson('/assets/' + descriptor);
    if (disposed) return;
    if (layout.artwork && !layout.imageAnimations?.length) {
      element(kind).setAttribute('aria-label', `Stationary channel ${kind}`);
      if (kind === 'icon') {
        element('icon-note').textContent = 'This artwork stays stationary on the Wii Menu.';
      }
    }
    surfaces.push(await createSurface(kind, layout, display, manifest));
  }
  if (disposed) return;
  const entries = sounds.audio ?? sounds.sounds ?? sounds;
  sound = channel.audio || (id === 'disc' ? entries.discPreview : null);
  if (typeof sound === 'string') sound = { src: sound };
  // This page never needs menu BGM or other channels' effects. Decode only the
  // selected preview sound, and only after the explicit Replay gesture.
  audio = createAudio({ manifest: sound ? { preview: sound } : {} });
  audio.setVolume(config.audio.volume);
  audio.setMuted(config.audio.muted);
  ready = true;
  replay.textContent = sound ? 'Replay opening and sound' : 'Replay opening';
  replay.disabled = false;
  pause.disabled = false;
  showStatus(
    sound
      ? 'Animation is playing. Choose Replay to hear the sound.'
      : 'Animation is playing. This channel has no preview sound.',
  );
  setPlaying(true);
}

initialize().catch(fail);
