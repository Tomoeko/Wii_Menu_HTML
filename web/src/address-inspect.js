import { Renderer } from './renderer.js';
import { BitmapFont } from './font.js';
import { createDisplay } from './display.js';
import { createBoardAddress, ADDRESS_LAYOUTS } from './board-address.js';

const element = (id) => document.getElementById(id);
const fields = Object.fromEntries(
  [
    'aspect',
    'page',
    'turn',
    'frame',
    'width',
    'height',
    'native-raster',
    'stack-only',
    'render',
    'save',
  ].map((id) => [id, element(id)]),
);
const canvas = element('inspection');
const raster = document.createElement('canvas');
const renderer = new Renderer(raster);
const fonts = new Map();
const query = new URLSearchParams(location.search);
for (const name of ['aspect', 'page', 'turn', 'frame', 'width', 'height']) {
  if (query.has(name)) fields[name].value = query.get(name);
}
fields['stack-only'].checked = query.get('stack-only') === '1';
fields['native-raster'].checked = query.get('native-raster') !== '0';
let layouts;
let snapshot;

async function read(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to read prepared resource: ' + url);
  return response.json();
}

function integer(id, minimum, maximum) {
  const parsed = Math.trunc(Number(fields[id].value));
  const value = Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : minimum));
  fields[id].value = value;
  return value;
}

function render() {
  if (!layouts) return;
  const display = createDisplay(fields.aspect.value);
  renderer.setDisplay(display);
  canvas.width = integer('width', 304, 1920);
  canvas.height = integer('height', 228, 1080);
  raster.width = fields['native-raster'].checked ? display.framebufferWidth : canvas.width;
  raster.height = fields['native-raster'].checked ? display.framebufferHeight : canvas.height;
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
  const page = integer('page', 0, 20);
  const frame = integer('frame', 0, 30);
  const book = createBoardAddress(layouts, { display });
  book.advance(17);
  for (let index = 0; index < page; index++) {
    book.activate('address-next');
    book.advance(16);
  }
  if (fields.turn.value) {
    book.activate('address-' + fields.turn.value);
    book.advance(frame);
  }
  const { layout: layer, ...drawOptions } = book.presentation().layers[0];
  const exclude = fields['stack-only'].checked
    ? new Set(
        layer.root.children
          .flatMap((pane) => (pane.name === 'N_note_base' ? pane.children : []))
          .flatMap((pane) => pane.children)
          .filter(
            (pane) =>
              ['N_note_b', 'N_note_c'].includes(pane.name) || pane.name.startsWith('N_note_e'),
          )
          .map((pane) => pane.name),
      )
    : new Set();
  renderer.clear();
  renderer.draw(layer, {
    ...drawOptions,
    exclude,
    onPane(pane, matrix, alpha) {
      if (pane.type !== 'txt1' || !pane.text || alpha <= 0) return;
      fonts.get(layer.fonts[pane.font])?.drawPane(pane.text, pane, matrix, alpha, {
        material: layer.materials[pane.material],
      });
    },
  });
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.drawImage(raster, 0, 0, canvas.width, canvas.height);
  snapshot = {
    page,
    turn: fields.turn.value || null,
    update: frame,
    aspect: display.aspectRatio,
    logicalWidth: display.width,
    logicalHeight: display.height,
    width: canvas.width,
    height: canvas.height,
    framebufferWidth: raster.width,
    framebufferHeight: raster.height,
    stackOnly: fields['stack-only'].checked,
    geometry: book.snapshot().bookGeometry,
  };
  element('pose').textContent = JSON.stringify(snapshot, null, 2);
  element('status').textContent = 'Candidate ready; no original resource values were changed.';
  fields.save.disabled = false;
}

fields.render.addEventListener('click', render);
async function save() {
  try {
    const response = await fetch('/__capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: `AddressBook-page-${snapshot.page}-${snapshot.turn || 'idle'}`,
        kind: snapshot.stackOnly ? 'book-sheets' : 'address-book',
        frame: snapshot.update,
        aspectRatio: snapshot.aspect,
        logicalWidth: snapshot.logicalWidth,
        logicalHeight: snapshot.logicalHeight,
        png: canvas.toDataURL('image/png'),
      }),
    });
    if (!response.ok) throw new Error('Comparison frame was not saved.');
    const result = await response.json();
    element('status').textContent = 'Saved ' + result.path;
  } catch (error) {
    element('status').textContent = error.message;
  }
}
fields.save.addEventListener('click', save);

try {
  const manifest = await read('/assets/manifest.json');
  layouts = Object.fromEntries(
    await Promise.all(
      ADDRESS_LAYOUTS.map(async (name) => [
        name,
        await read('/assets/' + manifest.layouts[name].url),
      ]),
    ),
  );
  await Promise.all(Object.values(layouts).map((layout) => renderer.load(layout)));
  for (const name of new Set(Object.values(layouts).flatMap((layout) => layout.fonts))) {
    const descriptor = manifest.fonts[name];
    if (!descriptor) throw new Error('Missing original font: ' + name);
    const font = new BitmapFont(await read('/assets/' + descriptor.url), renderer);
    await font.load();
    fonts.set(name, font);
  }
  render();
  if (query.get('save') === '1') await save();
} catch (error) {
  element('status').textContent = error.message;
}
