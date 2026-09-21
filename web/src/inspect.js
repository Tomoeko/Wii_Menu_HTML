import { Renderer } from './renderer.js';
import { BitmapFont } from './font.js';
import { poseLayout, walkPanes } from './animation.js';
import { channelClips, poseChannel } from './channel-animation.js';
import { languageMask } from './language.js';
import { createDisplay, prepareAspectLayout } from './display.js';
import { mergeChannelCatalog, readCustomChannelCatalog } from './channel-catalog.js';

const byId = (id) => document.getElementById(id);
const canvas = byId('inspection'),
  fields = Object.fromEntries(
    [
      'channel',
      'kind',
      'aspect',
      'frame',
      'end',
      'scrubber',
      'play',
      'previous',
      'next',
      'download',
      'save',
    ].map((id) => [id, byId(id)]),
  );
const source = byId('source'),
  status = byId('status'),
  time = byId('time'),
  controllers = byId('controllers');
const fonts = new Map(),
  loadedFonts = new Map(),
  loadedChannels = new Map();
let renderer,
  manifest,
  catalog,
  channel,
  frame = 0,
  end = 3600,
  playing = false,
  playAt = 0,
  playFrame = 0,
  loadVersion = 0;
const query = new URLSearchParams(location.search);
let display = createDisplay(query.get('aspect') || '16:9');
const integer = (value, fallback = 0, max = 36000) =>
  Math.min(max, Math.max(0, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));
const round = (value) =>
  Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString();

function setAspect(aspect) {
  display = createDisplay(aspect);
  renderer.setDisplay(display);
  fields.aspect.value = aspect;
  canvas.width = display.framebufferWidth;
  canvas.height = display.framebufferHeight;
  canvas.style.width = display.width + 'px';
  canvas.style.height = Math.round(display.width / display.outputAspect) + 'px';
  fields.kind.options[0].textContent = `Icon · ${display.thumbnailHalfWidth * 2} × 96 logical`;
  fields.kind.options[1].textContent = `Banner · ${display.width} × ${display.height} logical`;
  byId('hint').textContent =
    `Space plays or pauses. Left and Right step one frame when a text field is not focused. ` +
    `Icons use the source ${display.thumbnailHalfWidth * 2} × 96 logical clip. ` +
    `The ${display.width} × ${display.height} projection renders to ${canvas.width} × ${canvas.height} native framebuffer pixels, presented at ${display.aspectRatio}.`;
}
function iconRect() {
  return {
    x: display.halfWidth - display.thumbnailHalfWidth,
    y: display.halfHeight - 48,
    w: display.thumbnailHalfWidth * 2,
    h: 96,
  };
}
function exportRect() {
  if (fields.kind.value !== 'icon') return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const rect = iconRect(),
    sx = canvas.width / display.width,
    sy = canvas.height / display.height;
  const x = Math.floor(rect.x * sx),
    y = Math.floor(rect.y * sy);
  // Preserve whole output pixels; do not resample the captured icon a second time.
  return {
    x,
    y,
    w: Math.ceil((rect.x + rect.w) * sx) - x,
    h: Math.ceil((rect.y + rect.h) * sy) - y,
  };
}

async function read(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}
function controlsEnabled(enabled) {
  for (const field of Object.values(fields)) field.disabled = !enabled;
}
function fail(error) {
  playing = false;
  fields.play.textContent = 'Play';
  status.classList.add('error');
  status.textContent = error.message || String(error);
}
function stop() {
  playing = false;
  fields.play.textContent = 'Play';
}
function fontFor(pane, layout) {
  const name = layout.fonts?.[pane.font],
    font = fonts.get(name);
  if (!font) throw new Error(`Source font ${name} is missing. Run the shared-font export.`);
  return font;
}
const poseOptions = {
  language: 'ENG',
  networkConfigured: false,
  measureText: (text, pane, layout) =>
    fontFor(pane, layout).width(text, pane.fontSize, pane.charSpace),
};

async function loadFonts(layout) {
  for (const name of layout.fonts || []) {
    if (fonts.has(name)) continue;
    const descriptor = manifest.fonts[name];
    if (!descriptor)
      throw new Error(`Source font ${name} is missing. Run npm run assets:shared-fonts.`);
    if (!loadedFonts.has(descriptor.url))
      loadedFonts.set(
        descriptor.url,
        (async () => {
          const font = new BitmapFont(await read('/assets/' + descriptor.url), renderer);
          await font.load();
          return font;
        })(),
      );
    fonts.set(name, await loadedFonts.get(descriptor.url));
  }
}
async function getChannel(id) {
  if (loadedChannels.has(id)) return loadedChannels.get(id);
  const metadata =
    id === 'disc'
      ? { id, shortId: 'Disc', title: 'Disc Channel' }
      : catalog.channels.find((item) => item.id === id);
  if (!metadata) throw new Error('Unknown catalog channel');
  const result = { ...metadata };
  for (const kind of ['icon', 'banner']) {
    const descriptor =
      id === 'disc'
        ? manifest.layouts[kind === 'icon' ? 'my_DiskCh_b' : 'my_DiskCh_a']?.url
        : metadata[`${kind}Layout`];
    if (!descriptor) continue;
    const layout = await read('/assets/' + descriptor);
    await Promise.all([renderer.load(layout), loadFonts(layout)]);
    result[kind] = layout;
  }
  loadedChannels.set(id, result);
  return result;
}
function currentPose() {
  const kind = fields.kind.value;
  if (!channel[kind]) throw new Error(`This channel has no ${kind} resource`);
  const layout = prepareAspectLayout(channel[kind], display),
    prepared = { ...channel, [kind]: layout };
  if (channel.id !== 'disc')
    return {
      layout: poseChannel(prepared, kind, frame, poseOptions),
      clips: channelClips(prepared, kind, frame, poseOptions),
    };
  const name = kind === 'icon' ? 'my_DiskCh_b' : 'my_DiskCh_a_Start',
    animation = layout.animations[name];
  const max = animation.frames - (animation.loop ? 0 : 1),
    sample = animation.loop ? frame % max : Math.min(frame, max);
  const clip = {
    name,
    frame: sample,
    animation: { ...animation, loop: false },
    controller: { min: 0, max, initial: 0, speed: 1, loop: animation.loop },
  };
  return { layout: poseLayout(layout, [clip]), clips: [clip] };
}
function controllerRows(clips) {
  controllers.replaceChildren();
  for (const clip of clips) {
    const row = document.createElement('tr'),
      control = clip.controller;
    for (const value of [
      clip.name,
      clip.group || 'Whole layout',
      round(clip.frame),
      control.min,
      control.max,
      control.initial,
      round(control.speed),
      control.loop ? 'Loop' : 'Forward / hold',
    ]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    controllers.append(row);
  }
  if (!clips.length) {
    const row = document.createElement('tr'),
      cell = document.createElement('td');
    cell.colSpan = 8;
    cell.textContent = 'Static source layout; no automatic timeline.';
    row.append(cell);
    controllers.append(row);
  }
}
function render() {
  if (!channel) return;
  const { layout, clips } = currentPose(),
    kind = fields.kind.value,
    visibleText = [];
  renderer.clear();
  if (kind === 'icon') renderer.clip(iconRect());
  renderer.draw(layout, {
    exclude: languageMask(layout),
    onPane: (pane, matrix, alpha) => {
      if (pane.type !== 'txt1' || !pane.text || alpha <= 0) return;
      const text =
        channel.id === 'disc' && pane.name === 'T_Comment0' ? 'Please insert a disc.' : pane.text;
      fontFor(pane, layout).drawPane(text, pane, matrix, alpha, {
        material: layout.materials[pane.material],
      });
      visibleText.push({
        pane: pane.name,
        font: layout.fonts[pane.font],
        text,
        translation: pane.translation,
        size: pane.size,
        fontSize: pane.fontSize,
        alpha,
      });
    },
  });
  renderer.clip(null);
  fields.frame.value = frame;
  fields.scrubber.value = frame;
  fields.previous.disabled = frame === 0;
  fields.next.disabled = frame === end;
  time.textContent = `Frame ${frame} · ${(frame / 60).toFixed(3)} seconds · 60 Hz`;
  controllerRows(clips);
  const output = exportRect();
  source.textContent = `${channel.shortId} · ${display.aspectRatio} · ${display.width} × ${display.height} logical projection · ${canvas.width} × ${canvas.height} canvas pixels · ${output.w} × ${output.h} exported pixels · ${layout.source || layout.name} · ENG · No downloaded/save data`;
  byId('texts').textContent = visibleText.length
    ? JSON.stringify(visibleText, null, 2)
    : 'No visible authored text at this frame.';
  const panes = [];
  walkPanes(layout.root, (pane) =>
    panes.push({
      name: pane.name,
      flags: pane.flags,
      alpha: pane.alpha,
      translation: pane.translation,
      rotation: pane.rotation,
      scale: pane.scale,
      size: pane.size,
    }),
  );
  byId('trace').textContent = JSON.stringify(
    {
      frame,
      display,
      output: { width: canvas.width, height: canvas.height },
      controllers: clips.map(({ name, frame, group, controller }) => ({
        name,
        frame,
        group,
        controller,
      })),
      panes,
    },
    null,
    2,
  );
  query.set('channel', channel.shortId);
  query.set('kind', kind);
  query.set('frame', String(frame));
  query.set('aspect', display.aspectRatio);
  // URL state contains catalog IDs and numeric frames only; no filesystem paths.
  if (!playing) history.replaceState(null, '', `${location.pathname}?${query}`);
}
function setFrame(value) {
  stop();
  frame = integer(value, frame, end);
  try {
    render();
  } catch (error) {
    fail(error);
  }
}
function showTimelines() {
  const layout = channel[fields.kind.value];
  byId('timelines').textContent = JSON.stringify(
    Object.entries(layout.animations || {}).map(([name, animation]) => ({
      name,
      frames: animation.frames,
      loop: animation.loop,
      targets: animation.targets.map((target) => ({
        name: target.name,
        type: target.type,
        tracks: target.tracks.map((track) => ({
          kind: track.kind,
          id: track.id,
          target: track.target,
          curveType: track.curveType,
          keys: track.keys.length,
          firstFrame: track.keys[0]?.frame,
          lastFrame: track.keys.at(-1)?.frame,
        })),
      })),
    })),
    null,
    2,
  );
}
async function selectChannel(reset = true) {
  const version = ++loadVersion;
  stop();
  controlsEnabled(false);
  status.classList.remove('error');
  status.textContent = 'Loading original textures and font sheets…';
  try {
    const result = await getChannel(fields.channel.value);
    if (version !== loadVersion) return;
    channel = result;
    if (reset) frame = 0;
    showTimelines();
    controlsEnabled(true);
    render();
    status.textContent =
      'Ready. Playback samples integer source frames at 60 Hz. Save comparison frame preserves the displayed canvas pixels.';
  } catch (error) {
    if (version === loadVersion) fail(error);
  }
}
fields.channel.addEventListener('change', () => void selectChannel());
fields.kind.addEventListener('change', () => {
  stop();
  frame = 0;
  try {
    showTimelines();
    render();
  } catch (error) {
    fail(error);
  }
});
fields.aspect.addEventListener('change', () => {
  stop();
  try {
    setAspect(fields.aspect.value);
    render();
  } catch (error) {
    fail(error);
  }
});
fields.frame.addEventListener('change', () => setFrame(fields.frame.value));
fields.scrubber.addEventListener('input', () => setFrame(fields.scrubber.value));
fields.end.addEventListener('change', () => {
  end = Math.max(1, integer(fields.end.value, 3600));
  fields.end.value = end;
  fields.scrubber.max = end;
  fields.frame.max = end;
  setFrame(Math.min(frame, end));
});
fields.previous.addEventListener('click', () => setFrame(frame - 1));
fields.next.addEventListener('click', () => setFrame(frame + 1));
fields.play.addEventListener('click', () => {
  if (playing) {
    stop();
    render();
    return;
  }
  if (frame === end) frame = 0;
  playing = true;
  playAt = performance.now();
  playFrame = frame;
  fields.play.textContent = 'Pause';
});
fields.download.addEventListener('click', () => {
  try {
    stop();
    render();
    const rect = exportRect(),
      output = document.createElement('canvas');
    output.width = rect.w;
    output.height = rect.h;
    output.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const filename = `${channel.shortId}-${fields.kind.value}-${display.aspectRatio.replace(':', 'x')}-frame-${String(frame).padStart(5, '0')}.png`;
    output.toBlob((blob) => {
      if (!blob) {
        fail(new Error('PNG export failed'));
        return;
      }
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } catch (error) {
    fail(error);
  }
});
fields.save.addEventListener('click', async () => {
  try {
    stop();
    render();
    fields.save.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Saving this visible comparison frame…';
    const response = await fetch('/__capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        png: canvas.toDataURL('image/png'),
        channel: channel.id,
        kind: fields.kind.value,
        frame,
        aspectRatio: display.aspectRatio,
        logicalWidth: display.width,
        logicalHeight: display.height,
      }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || `Comparison save failed (${response.status})`);
    status.textContent = `Saved comparison frame: ${result.path || result.relativePath || 'artifacts/browser-captures'}`;
  } catch (error) {
    fail(error);
  } finally {
    fields.save.disabled = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName) || fields.play.disabled) return;
  if (event.code === 'Space') {
    event.preventDefault();
    fields.play.click();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    setFrame(frame - 1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    setFrame(frame + 1);
  }
});
function tick(now) {
  if (playing) {
    const next = Math.min(end, playFrame + Math.floor(((now - playAt) * 60) / 1000));
    if (next !== frame) {
      frame = next;
      try {
        render();
      } catch (error) {
        fail(error);
      }
    }
    if (frame === end) {
      stop();
      render();
    }
  }
  requestAnimationFrame(tick);
}
async function init() {
  renderer = new Renderer(canvas, { display });
  setAspect(display.aspectRatio);
  renderer.clear();
  [manifest, catalog] = await Promise.all([
    read('/assets/manifest.json'),
    read('/assets/channels.json'),
  ]);
  catalog = mergeChannelCatalog(catalog, await readCustomChannelCatalog());
  for (const item of [
    { id: 'disc', shortId: 'Disc', title: 'Disc Channel' },
    ...catalog.channels,
  ]) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.title} (${item.shortId})`;
    fields.channel.append(option);
  }
  const selected = catalog.channels.find(
    (item) => item.id === query.get('channel') || item.shortId === query.get('channel'),
  );
  fields.channel.value = selected?.id || 'disc';
  fields.kind.value = query.get('kind') === 'banner' ? 'banner' : 'icon';
  frame = integer(query.get('frame'));
  end = Math.max(3600, frame);
  fields.end.value = end;
  fields.scrubber.max = end;
  fields.frame.max = end;
  await selectChannel(false);
  requestAnimationFrame(tick);
}
init().catch(fail);
