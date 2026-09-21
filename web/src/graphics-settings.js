import { DEFAULT_GRAPHICS, normalizeGraphics, supersampleScale } from './graphics.js';

const fields = document.querySelector('#graphics-fields');
const form = document.querySelector('#graphics-form');
const status = document.querySelector('#graphics-status');
const error = document.querySelector('#graphics-error');
const saved = document.querySelector('#graphics-saved');
const resolution = document.querySelector('#resolution-scale');
const aliasing = document.querySelector('#anti-aliasing');
const correction = document.querySelector('#color-correction');
const gamma = document.querySelector('#source-gamma');
const presets = {
  native: { ...DEFAULT_GRAPHICS },
  balanced: { ...DEFAULT_GRAPHICS, antiAliasing: 'ssaa-4x' },
  high: { ...DEFAULT_GRAPHICS, resolutionScale: 2, antiAliasing: 'ssaa-4x' },
};

function values() {
  return normalizeGraphics({
    resolutionScale: Number(resolution.value),
    antiAliasing: aliasing.value,
    colorCorrection: correction.value,
    sourceGamma: Number(gamma.value),
  });
}

function updateSummary() {
  const graphics = values();
  const rasterScale = graphics.resolutionScale * supersampleScale(graphics);
  const cost = rasterScale ** 2;
  document.querySelector('#graphics-cost').textContent =
    `${640 * rasterScale} × ${456 * rasterScale} internal raster · ` +
    `${cost}× the native pixel count per frame. ` +
    (graphics.antiAliasing === 'post-process' ? 'Legacy 1× post-process mode. ' : '') +
    'Actual speed depends on your GPU.';
  gamma.disabled = graphics.colorCorrection === 'none';
  for (const button of document.querySelectorAll('[data-preset]')) {
    const preset = presets[button.dataset.preset];
    const matches = Object.keys(DEFAULT_GRAPHICS).every((key) => graphics[key] === preset[key]);
    button.setAttribute('aria-pressed', String(matches));
  }
}

function show(graphics) {
  resolution.value = String(graphics.resolutionScale);
  aliasing.value = graphics.antiAliasing;
  correction.value = graphics.colorCorrection;
  gamma.value = String(graphics.sourceGamma);
  updateSummary();
}

function showError(message) {
  error.textContent = message;
  error.hidden = false;
  status.textContent = '';
}

async function request(options) {
  const response = await fetch('/api/graphics', options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save graphics settings.');
  return normalizeGraphics(result.graphics);
}

async function load() {
  fields.disabled = true;
  error.hidden = true;
  saved.hidden = true;
  status.textContent = 'Loading saved settings…';
  try {
    show(await request());
    status.textContent = 'Saved graphics settings loaded.';
    fields.disabled = false;
  } catch (failure) {
    showError(failure.message);
  } finally {
    fields.disabled = false;
  }
}

form.addEventListener('input', () => {
  error.hidden = true;
  saved.hidden = true;
  status.textContent = 'Unsaved changes.';
  if (form.checkValidity()) updateSummary();
});

for (const button of document.querySelectorAll('[data-preset]')) {
  button.addEventListener('click', () => {
    show(presets[button.dataset.preset]);
    error.hidden = true;
    saved.hidden = true;
    status.textContent = 'Preset selected. Save to apply it to the menu.';
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const graphics = values();
  fields.disabled = true;
  error.hidden = true;
  saved.hidden = true;
  status.textContent = 'Saving graphics settings…';
  try {
    show(await request({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphics),
    }));
    status.textContent = 'Saved. Reload the Wii Menu to apply your changes.';
    saved.hidden = false;
  } catch (failure) {
    showError(failure.message);
  } finally {
    fields.disabled = false;
  }
});

document.querySelector('#graphics-reload').addEventListener('click', load);
void load();
