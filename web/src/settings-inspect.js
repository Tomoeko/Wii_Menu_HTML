import { createSettingsSurface } from './settings-surface.js';
import { createDisplay } from './display.js';
const manifest = await fetch('/assets/manifest.json').then((response) => response.json());
const display = createDisplay(new URLSearchParams(location.search).get('aspect') || '16:9');
const preview = document.querySelector('#preview');
preview.style.aspectRatio = display.outputAspect;
const surface = await createSettingsSurface({
  container: preview,
  display,
  homeKeys: ['Home', 'h'],
  settings: manifest.settings,
  onEvent: (event) => {
    document.querySelector('#events').textContent = JSON.stringify(event);
    if (event.action === 'exit') surface.close();
  },
});
const entry =
  new URLSearchParams(location.search).get('entry') || manifest.settings.defaultEntryPoint;
const restart = () => surface.open('/assets/' + entry);
document.querySelector('#restart').onclick = restart;
document.querySelector('#profile').onclick = async () => {
  const output = document.querySelector('#events'),
    canvas = preview.querySelector('canvas');
  const before = surface.getPerformance(),
    bounds = canvas.getBoundingClientRect();
  const timings = [];
  output.textContent = 'Profiling original Settings hover controls…';
  // The four original page-1 button centers, in its 608×456 coordinate space.
  // Repeated movement inside each button must not generate new page rasters.
  for (let pass = 0; pass < 3; pass++)
    for (const y of [108, 180, 252, 324]) {
      const start = performance.now(),
        previous = surface.getPerformance().lastInputSequence;
      for (let step = 0; step < 20; step++) {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: bounds.left + ((display.width / 2 + step / 10) * bounds.width) / display.width,
            clientY: bounds.top + (y * bounds.height) / display.height,
            bubbles: true,
          }),
        );
      }
      while (
        surface.getPerformance().lastInputSequence === previous &&
        performance.now() - start < 3000
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      timings.push(Math.round(performance.now() - start));
    }
  const after = surface.getPerformance();
  output.textContent = JSON.stringify({
    firstReadyMs: after.firstReadyMs,
    pointerMoves: 240,
    fullRasters: after.fullRasters - before.fullRasters,
    cachedRasters: after.cachedRasters - before.cachedRasters,
    fastRasters: after.fastRasters - before.fastRasters,
    hoverWaitMs: timings,
    inputToRasterMs: after.inputTimings.slice(-12),
    markupBytes: after.lastMarkupBytes,
    svgBytes: after.lastSvgBytes,
    queue: after.queue,
  });
};
document.querySelector('#profile-navigation').onclick = async () => {
  const output = document.querySelector('#events');
  const canvas = preview.querySelector('canvas');
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  if (!canvas.dataset.page?.endsWith('/index01.html')) {
    output.textContent = 'Restart Settings on page 1 before profiling its arrows.';
    return;
  }
  const results = [];
  for (const [direction, page] of [
    [1, 2],
    [1, 3],
    [-1, 2],
    [-1, 1],
  ]) {
    // Let the original forty-frame scroll finish before sending another input.
    await wait(750);
    const bounds = canvas.getBoundingClientRect();
    const x = (display.width - 608) / 2 + (direction > 0 ? 550 : 58);
    const event = (type) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          clientX: bounds.left + (x * bounds.width) / display.width,
          clientY: bounds.top + (216 * bounds.height) / display.height,
          button: 0,
          bubbles: true,
        }),
      );
    const before = surface.getPerformance();
    event('pointermove');
    await wait(100);
    const hover = surface.getPerformance();
    const started = performance.now();
    event('pointerdown');
    while (
      !canvas.dataset.page.endsWith(`/index0${page}.html`) &&
      performance.now() - started < 5000
    )
      await wait(10);
    const after = surface.getPerformance();
    results.push({
      page,
      clickToReadyMs: Math.round(performance.now() - started),
      navigationReadyMs: after.lastNavigationReadyMs,
      hoverFullRasters: hover.fullRasters - before.fullRasters,
      hoverFastRasters: hover.fastRasters - before.fastRasters,
      navigationFullRasters: after.fullRasters - hover.fullRasters,
      navigationCachedRasters: after.cachedRasters - hover.cachedRasters,
      rasterMs: after.lastRasterMs,
      queue: after.queue,
    });
    output.textContent = JSON.stringify({ navigation: results });
    if (!canvas.dataset.page.endsWith(`/index0${page}.html`)) break;
  }
};
document.querySelector('#save').onclick = async () => {
  const canvas = preview.querySelector('canvas');
  const response = await fetch('/__capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      png: canvas.toDataURL('image/png'),
      channel: canvas.dataset.page,
      kind: 'settings',
      frame: 0,
      aspectRatio: display.aspectRatio,
      logicalWidth: display.width,
      logicalHeight: display.height,
    }),
  });
  const result = await response.json();
  document.querySelector('#events').textContent = response.ok
    ? `Saved comparison frame: ${result.path}`
    : result.error;
};
restart();
