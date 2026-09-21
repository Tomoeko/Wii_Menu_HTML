import { Renderer } from './renderer.js';
import { BitmapFont } from './font.js';
import { createDisplay } from './display.js';
import { MENU_SCENE_LAYOUTS } from './menu-scenes.js';
import { CREATE_INSPECTION_FLOWS, createInspectionSequence } from './create-inspection-sequence.js';

const element = (id) => document.getElementById(id);
const fields = Object.fromEntries(
  [...document.querySelectorAll('input, select, button')].map((field) => [field.id, field]),
);
const canvas = element('inspection');
const raster = document.createElement('canvas');
const renderer = new Renderer(raster);
const fonts = new Map();
const resources = [];
const query = new URLSearchParams(location.search);
for (const name of ['flow', 'aspect', 'date', 'focus', 'width', 'height', 'frame']) {
  if (query.has(name)) fields[name].value = query.get(name);
}

let layouts;
let messages;
let source;
let display;
let sequence;
let snapshot;
let exporting = false;
let cancelled = false;

async function readResource(path) {
  const response = await fetch('/assets/' + path);
  if (!response.ok) throw new Error('Unable to read prepared resource: ' + path);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  resources.push({ path, sha256 });
  return JSON.parse(new TextDecoder().decode(bytes));
}

function integer(id, minimum, maximum) {
  const number = Math.trunc(Number(fields[id].value));
  const value = Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
  fields[id].value = value;
  return value;
}

function setBusy(value) {
  exporting = value;
  for (const field of Object.values(fields)) field.disabled = value;
  fields.cancel.disabled = !value;
  if (!value) {
    fields.previous.disabled = snapshot.frame === 0;
    fields.next.disabled = snapshot.frame === sequence.duration;
  }
}

function applySetup() {
  if (!layouts || exporting) return;
  const date = new Date(fields.date.value + 'T12:00:00');
  display = createDisplay(fields.aspect.value);
  sequence = createInspectionSequence(layouts, {
    flow: fields.flow.value,
    focusFrames: integer('focus', 0, 60),
    date,
    display,
    messages,
  });
  renderer.setDisplay(display);
  canvas.width = integer('width', 304, 1920);
  canvas.height = integer('height', 228, 1080);
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
  raster.width = display.framebufferWidth;
  raster.height = display.framebufferHeight;
  fields.frame.max = sequence.duration;
  fields.scrubber.max = sequence.duration;
  renderFrame(integer('frame', 0, sequence.duration));
  setBusy(false);
}

function renderFrame(frame) {
  const sample = sequence.sample(frame);
  renderer.clear();
  for (const { layout, clip, ...options } of sample.presentation.layers) {
    renderer.clip(clip ?? null);
    renderer.draw(layout, {
      ...options,
      onPane(pane, matrix, alpha) {
        if (pane.type !== 'txt1' || !pane.text || alpha <= 0) return;
        const face = fonts.get(layout.fonts[pane.font]);
        face?.drawPane(pane.text, pane, matrix, alpha, {
          material: layout.materials[pane.material],
        });
      },
    });
  }
  renderer.clip(null);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.drawImage(raster, 0, 0, canvas.width, canvas.height);
  fields.frame.value = frame;
  fields.scrubber.value = frame;
  snapshot = {
    schemaVersion: 1,
    tool: 'create-inspect',
    ...sample.metadata,
    source,
    resources,
    projection: {
      aspectRatio: display.aspectRatio,
      logicalWidth: display.width,
      logicalHeight: display.height,
    },
    framebuffer: { width: raster.width, height: raster.height },
    output: { width: canvas.width, height: canvas.height },
    layers: sample.presentation.layers.map((layer) => layer.prefix),
    frameConvention: '0 = action accepted; duration = first settled boundary',
    nativeAlignment: null,
  };
  element('pose').textContent = JSON.stringify(snapshot, null, 2);
  if (!exporting) {
    fields.previous.disabled = frame === 0;
    fields.next.disabled = frame === sequence.duration;
    element('status').textContent = `${sequence.label}: update ${frame}/${sequence.duration}.`;
  }
}

async function saveFrame(extra = {}) {
  const response = await fetch('/__capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: `Create-Address-${sequence.flow}`,
      kind: 'create-sequence',
      frame: snapshot.frame,
      aspectRatio: display.aspectRatio,
      logicalWidth: display.width,
      logicalHeight: display.height,
      comparison: { ...snapshot, ...extra },
      png: canvas.toDataURL('image/png'),
    }),
  });
  if (!response.ok) throw new Error(`Comparison save failed (${response.status}).`);
  return response.json();
}

async function saveSequence() {
  if (exporting) return;
  cancelled = false;
  setBusy(true);
  const sequenceId = crypto.randomUUID();
  const total = sequence.duration + 1;
  const saved = [];
  try {
    for (let frame = 0; frame < total; frame++) {
      if (cancelled) break;
      renderFrame(frame);
      const comparison = { sequenceId, index: frame, total };
      if (frame === total - 1) {
        // A capture's filename is assigned by the server. This marker refers
        // to the PNG beside the final JSON, avoiding a second manifest API.
        comparison.sequenceManifest = {
          complete: true,
          frames: [...saved, { frame, currentCapture: true }],
        };
      }
      const result = await saveFrame(comparison);
      saved.push({ frame, path: result.path });
      element('saved').textContent = JSON.stringify({ sequenceId, total, frames: saved }, null, 2);
      element('status').textContent = `Saved ${saved.length}/${total} frames. ${result.path}`;
      await new Promise(requestAnimationFrame);
    }
    if (cancelled) {
      element('status').textContent =
        `Export cancelled after ${saved.length}/${total} frames. Saved frames remain available.`;
    } else {
      const last = saved.at(-1).path.replace(/\.png$/, '.json');
      element('status').textContent = `Saved ${total} frames. Full sequence index: ${last}`;
    }
  } finally {
    setBusy(false);
  }
}

function run(action) {
  Promise.resolve()
    .then(action)
    .catch((error) => {
      element('status').textContent = error.message;
    });
}

fields.render.addEventListener('click', () => run(applySetup));
fields.frame.addEventListener('change', () =>
  run(() => renderFrame(integer('frame', 0, sequence.duration))),
);
fields.scrubber.addEventListener('input', () =>
  run(() => renderFrame(Number(fields.scrubber.value))),
);
fields.previous.addEventListener('click', () => run(() => renderFrame(snapshot.frame - 1)));
fields.next.addEventListener('click', () => run(() => renderFrame(snapshot.frame + 1)));
fields['save-frame'].addEventListener('click', () =>
  run(async () => {
    const result = await saveFrame();
    element('status').textContent = 'Saved ' + result.path;
  }),
);
fields['save-sequence'].addEventListener('click', () => run(saveSequence));
fields.cancel.addEventListener('click', () => {
  cancelled = true;
});

try {
  const manifest = await readResource('manifest.json');
  source = {
    titleId: manifest.preparation?.titleId ?? null,
    wadSha256: manifest.preparation?.wadSha256 ?? null,
    contentSha256: manifest.source?.sha256 ?? null,
    language: manifest.language,
  };
  const names = [...new Set(MENU_SCENE_LAYOUTS)];
  layouts = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const descriptor = manifest.layouts[name];
        if (!descriptor) throw new Error('Missing prepared layout: ' + name);
        return [name, await readResource(descriptor.url)];
      }),
    ),
  );
  messages = await readResource(manifest.messages[manifest.language].url);
  await Promise.all(Object.values(layouts).map((layout) => renderer.load(layout)));
  // Scene construction needs its child templates, but these three inspections
  // never enter the keyboard. Its unused Chinese/Korean fonts are not required
  // by a USA WAD. Enumerate the layers actually reached by the inspected flows.
  const requiredFonts = new Set();
  for (const flow of Object.keys(CREATE_INSPECTION_FLOWS)) {
    const probe = createInspectionSequence(layouts, { flow, messages });
    for (const frame of [0, probe.duration]) {
      for (const { layout } of probe.sample(frame).presentation.layers) {
        for (const name of layout.fonts) requiredFonts.add(name);
      }
    }
  }
  for (const name of requiredFonts) {
    const descriptor = manifest.fonts[name];
    if (!descriptor) throw new Error('Missing original font: ' + name);
    const face = new BitmapFont(await readResource(descriptor.url), renderer);
    await face.load();
    fonts.set(name, face);
  }
  resources.sort((left, right) => left.path.localeCompare(right.path));
  if (!CREATE_INSPECTION_FLOWS[fields.flow.value]) fields.flow.value = 'enter';
  applySetup();
} catch (error) {
  element('status').textContent = error.message;
}
