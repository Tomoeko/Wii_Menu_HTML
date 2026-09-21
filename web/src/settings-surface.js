import { Renderer } from './renderer.js';
import { graphicsDimensions, normalizeGraphics, usesPresentationPass } from './graphics.js';
import { poseLayout } from './animation.js';
import { createSettingsInputMarker } from './settings-input-marker.js';
import { createSettingsSoundQueue } from './settings-sounds.js';
import {
  createLatestRasterQueue,
  createSettingsResourceEmbedder,
  settingsFastImageGeometry,
  settingsImageReplacement,
} from './settings-raster-work.js';
import {
  SETTINGS_RASTER,
  SETTINGS_FIRST_TEXTURE_FRAME,
  SETTINGS_SCROLL_UPDATES,
  advanceSettingsTextureFrame,
  quantizeSettingsRaster,
  settingsCrossfadeAlpha,
  settingsRasterPoint,
} from './settings-raster-math.js';

const WHITE = [255, 255, 255, 255];
const assetUrl = (path) => new URL(path, new URL('/assets/', location.href)).href;

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not rasterize the Settings surface.'));
    image.src = url;
  });
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * The original HTML is a private layout/state engine. Its completed raster is
 * copied into RGB565 textures, then displayed with IPL's GX presentation rules.
 * This reproduces the native pipeline while leaving Opera's font rasterizer as
 * a separately measurable compatibility gap.
 */
export async function createSettingsSurface({
  container,
  display,
  homeKeys,
  settings,
  onEvent,
  externalClock = false,
  graphics,
}) {
  const quality = normalizeGraphics(graphics);
  const dimensions = graphicsDimensions(display, quality);
  const enhanced = quality.resolutionScale !== 1 || usesPresentationPass(quality);
  const rasterScale = enhanced ? dimensions.rasterScale : 1;
  const rasterWidth = SETTINGS_RASTER.width * rasterScale;
  const rasterHeight = SETTINGS_RASTER.height * rasterScale;
  const element = document.createElement('div');
  element.id = 'system-settings';
  element.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;z-index:1;overflow:hidden';
  element.hidden = true;
  const canvas = document.createElement('canvas');
  canvas.width = enhanced ? dimensions.internalWidth : display.width;
  canvas.height = enhanced ? dimensions.internalHeight : display.height;
  canvas.setAttribute('aria-label', 'Wii System Settings');
  canvas.style.cssText = 'width:100%;height:100%;display:block;position:absolute;inset:0';
  element.appendChild(canvas);
  container.prepend(element);

  const engine = document.createElement('iframe');
  engine.title = 'Wii Settings layout engine';
  engine.setAttribute('sandbox', 'allow-scripts');
  engine.setAttribute('aria-hidden', 'true');
  engine.tabIndex = -1;
  engine.width = String(SETTINGS_RASTER.width);
  engine.height = String(SETTINGS_RASTER.height);
  engine.style.cssText =
    'position:fixed;left:-10000px;top:0;width:608px;height:456px;border:0;pointer-events:none';
  document.body.appendChild(engine);

  // Settings is later composited beneath the menu pointer and keyboard by the
  // main renderer. Keep this intermediate canvas at its enhanced scene
  // resolution but disable its own presentation pass, so SSAA and color
  // conversion happen once after the complete menu composition.
  const renderer = new Renderer(canvas, {
    display,
    graphics: { ...quality, antiAliasing: 'none', colorCorrection: 'none' },
    sceneDimensions: {
      width: canvas.width,
      height: canvas.height,
      internalWidth: canvas.width,
      internalHeight: canvas.height,
    },
  });
  const raster = document.createElement('canvas');
  raster.width = rasterWidth;
  raster.height = rasterHeight;
  const context = raster.getContext('2d', { willReadFrequently: true });
  const baseRaster = document.createElement('canvas');
  baseRaster.width = rasterWidth;
  baseRaster.height = rasterHeight;
  const baseContext = baseRaster.getContext('2d', { willReadFrequently: true });
  if (!context || !baseContext) {
    throw new Error('This browser could not allocate the enhanced Settings raster.');
  }
  const scrollSource = await fetch(assetUrl('layouts/setting/SceenChange_b.json')).then(
    (response) => response.json(),
  );
  const fontCss = await fetch(assetUrl('fonts/outline-fonts.css')).then((response) => {
    if (!response.ok) throw new Error('The original Settings font stylesheet is missing.');
    return response.text();
  });
  const resources = new Map();
  const textures = ['settings-old-raster', 'settings-new-raster'];
  const quadLayout = {
    textures: textures.map((url) => ({ url })),
    materials: textures.map((_, texture) => ({
      name: textures[texture],
      colors: [[0, 0, 0, 0], WHITE, WHITE],
      textureMaps: [{ texture, wrapS: 0, wrapT: 0 }],
    })),
  };
  let background = null;
  if (settings?.background) {
    background = settings.background;
    await renderer.load({ textures: [background] });
  }
  const backgroundLayout = background && {
    textures: [background],
    materials: [
      {
        name: 'native Settings widescreen side texture',
        colors: [[0, 0, 0, 0], WHITE, WHITE],
        textureMaps: [{ texture: 0, wrapS: 0, wrapT: 0 }],
      },
    ],
  };
  let hasRaster = false;
  let rasterHasColor = false;
  let oldRasterHasColor = false;
  let navigationPending = true;
  let navigationStartedAt = null;
  const inputMarker = createSettingsInputMarker();
  let keyboardRequestId = null;
  let validationRequestId = null;
  let direction = 0;
  let activeDirection = 0;
  let transitionFrame = 20;
  let rasterVersion = 0;
  let documentPath = '';
  let destroyed = false;
  let drawDirty = true;
  let rasterRevision = 0;
  let lastMarkup = '',
    lastSequence = 0,
    openedAt = 0,
    inputSequence = 0;
  let fastImages = new Map();
  const decodedImages = new Map(),
    rasterCache = new Map();
  const metrics = {
    rasterScale,
    rasterWidth,
    rasterHeight,
    fullRasters: 0,
    cachedRasters: 0,
    fastRasters: 0,
    duplicateSnapshots: 0,
    firstReadyMs: null,
    lastRasterMs: 0,
    lastInputToRasterMs: null,
    lastInputSequence: 0,
    lastNavigationReadyMs: null,
    lastMarkupBytes: 0,
    lastSvgBytes: 0,
    fastImageCandidates: 0,
    fastImagesPrepared: 0,
  };
  const inputTimings = [];
  const snapshotQueue = createLatestRasterQueue(
    ({ data, generation }) =>
      data.action === 'image-patch'
        ? acceptImagePatch(data, generation)
        : acceptSnapshot(data, generation),
    (error) => {
      console.error('Settings raster:', error);
      onEvent?.({ action: 'error', message: error.message });
    },
  );
  let previousTime = performance.now();
  const soundQueue = createSettingsSoundQueue();

  function send(data) {
    engine.contentWindow?.postMessage(data, '*');
  }
  function resource(url) {
    const absolute = new URL(url, location.href);
    if (absolute.origin !== location.origin || !absolute.pathname.startsWith('/assets/')) {
      return Promise.reject(new Error('Settings raster referenced an external resource.'));
    }
    if (!resources.has(absolute.href)) {
      const pending = fetch(absolute)
        .then((response) => {
          if (!response.ok) throw new Error(`Missing Settings resource: ${absolute.pathname}`);
          return response.blob();
        })
        .then(blobDataUrl)
        .catch((error) => {
          if (resources.get(absolute.href) === pending) resources.delete(absolute.href);
          throw error;
        });
      resources.set(absolute.href, pending);
    }
    return resources.get(absolute.href);
  }
  const embedResources = createSettingsResourceEmbedder(fontCss, resource);
  function decodedImage(url) {
    if (!decodedImages.has(url)) decodedImages.set(url, resource(url).then(imageFromUrl));
    return decodedImages.get(url);
  }
  function publishMetrics(data, started) {
    metrics.lastRasterMs = performance.now() - started;
    if (data.requestedAt) {
      metrics.lastInputToRasterMs = Date.now() - data.requestedAt;
      metrics.lastInputSequence = data.inputSequence;
      inputTimings.push(metrics.lastInputToRasterMs);
      if (inputTimings.length > 100) inputTimings.shift();
    }
    canvas.dataset.performance = JSON.stringify(metrics);
  }
  async function prepareFastImages(data, generation) {
    metrics.fastImageCandidates = data.images?.length ?? 0;
    const prepared = await Promise.all(
      (data.images || []).map(async (item) => {
        const image = await decodedImage(item.src);
        const geometry = settingsFastImageGeometry(item, rasterScale);
        // Partial replacement pixels must land on the same raster samples as
        // the original image. Enhanced settings pages use integer supersample
        // geometry and the same canvas filter as their SVG rasterization.
        if (
          image.width !== item.width ||
          image.height !== item.height ||
          !geometry
        )
          return null;
        const probe = document.createElement('canvas');
        probe.width = geometry.width;
        probe.height = geometry.height;
        const pixels = probe.getContext('2d', { willReadFrequently: true });
        pixels.drawImage(image, 0, 0, geometry.width, geometry.height);
        const original = pixels.getImageData(0, 0, probe.width, probe.height).data;
        const variants = new Map([[item.src, null]]);
        for (const url of item.alternates) {
          if (variants.has(url)) continue;
          const alternate = await decodedImage(url);
          pixels.clearRect(0, 0, probe.width, probe.height);
          // The original HTML explicitly sizes every rollover image. Keep
          // that displayed geometry even when a prepared hover PNG has a
          // different intrinsic canvas height (List03_on is 64px while the
          // authored control clips it to 60px).
          pixels.drawImage(alternate, 0, 0, geometry.width, geometry.height);
          const replacement = pixels.getImageData(0, 0, probe.width, probe.height).data;
          const patch = settingsImageReplacement(original, replacement);
          if (!patch) return null;
          const overlay = document.createElement('canvas');
          overlay.width = probe.width;
          overlay.height = probe.height;
          overlay
            .getContext('2d')
            .putImageData(new ImageData(patch, probe.width, probe.height), 0, 0);
          variants.set(url, overlay);
        }
        return [item.id, { ...item, ...geometry, variants }];
      }),
    );
    if (destroyed || generation !== rasterVersion || lastSequence !== data.sequence) return;
    fastImages = new Map(prepared.filter(Boolean));
    metrics.fastImagesPrepared = fastImages.size;
    canvas.dataset.performance = JSON.stringify(metrics);
    send({
      type: 'wii-settings-raster-fast-images',
      sequence: data.sequence,
      ids: [...fastImages.keys()],
    });
  }
  function upload(key, source) {
    const gl = renderer.gl;
    renderer.invalidateGpuState();
    let texture = renderer.textures.get(key);
    const allocated = Boolean(texture);
    if (!allocated) {
      texture = gl.createTexture();
      renderer.textures.set(key, texture);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (allocated) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    drawDirty = true;
  }
  async function acceptSnapshot(data, generation) {
    if (destroyed || element.hidden || generation !== rasterVersion) return;
    if (
      hasRaster &&
      !navigationPending &&
      data.path === documentPath &&
      data.markup === lastMarkup
    ) {
      metrics.duplicateSnapshots++;
      return;
    }
    const started = performance.now(),
      cacheKey = data.path + '\n' + data.markup;
    metrics.lastMarkupBytes = data.markup.length;
    let pixels = rasterCache.get(cacheKey);
    if (pixels) metrics.cachedRasters++;
    else {
      const markup = await embedResources(data.markup);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rasterWidth}" ` +
        `height="${rasterHeight}" viewBox="0 0 608 456">` +
        `<foreignObject width="608" height="456">${markup}</foreignObject></svg>`;
      metrics.lastSvgBytes = svg.length;
      const image = await imageFromUrl(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      );
      if (destroyed || generation !== rasterVersion) return;
      baseContext.fillStyle = '#000';
      baseContext.fillRect(0, 0, rasterWidth, rasterHeight);
      baseContext.drawImage(image, 0, 0);
      pixels = baseContext.getImageData(0, 0, rasterWidth, rasterHeight);
      // Enhanced pages can contain millions of samples. Bound the cache by
      // bytes as well as entries instead of retaining eight enormous rasters.
      const cacheLimit = Math.min(8, Math.floor(64 * 1024 * 1024 / pixels.data.byteLength));
      if (cacheLimit > 0) {
        rasterCache.set(cacheKey, pixels);
        while (rasterCache.size > cacheLimit) rasterCache.delete(rasterCache.keys().next().value);
      }
      metrics.fullRasters++;
    }
    if (destroyed || generation !== rasterVersion) return;
    if ((navigationPending || data.path !== documentPath) && hasRaster) {
      upload(textures[0], raster);
      oldRasterHasColor = rasterHasColor;
    }
    baseContext.putImageData(pixels, 0, 0);
    const converted = new ImageData(new Uint8ClampedArray(pixels.data), rasterWidth, rasterHeight);
    quantizeSettingsRaster(converted.data);
    rasterHasColor = converted.data.some((value, index) => index % 4 !== 3 && value !== 0);
    context.putImageData(converted, 0, 0);
    upload(textures[1], raster);
    if (!hasRaster) {
      context.fillStyle = '#000';
      const blank = document.createElement('canvas');
      blank.width = rasterWidth;
      blank.height = rasterHeight;
      blank.getContext('2d').fillRect(0, 0, rasterWidth, rasterHeight);
      upload(textures[0], blank);
    }
    if (navigationPending || data.path !== documentPath) {
      // The first texture shares the scene fader's first-update hold. Later
      // document swaps reset only Setting's own crossfade counter.
      transitionFrame = hasRaster ? 0 : SETTINGS_FIRST_TEXTURE_FRAME;
      activeDirection = direction;
      direction = 0;
      navigationPending = false;
    }
    hasRaster = true;
    lastMarkup = data.markup;
    lastSequence = data.sequence;
    fastImages.clear();
    // Script-owned location changes do not pass through the anchor navigation
    // marker. Never report the previous document's duration for such a page.
    if (data.path !== documentPath && navigationStartedAt === null)
      metrics.lastNavigationReadyMs = null;
    documentPath = data.path;
    canvas.dataset.page = documentPath;
    canvas.dataset.raster = 'rgb565';
    if (metrics.firstReadyMs === null) metrics.firstReadyMs = performance.now() - openedAt;
    if (navigationStartedAt !== null) {
      metrics.lastNavigationReadyMs = performance.now() - navigationStartedAt;
      navigationStartedAt = null;
    }
    publishMetrics(data, started);
    onEvent?.({ action: 'raster-ready', path: documentPath, performance: { ...metrics } });
    void prepareFastImages(data, generation).catch((error) =>
      console.warn('Settings hover cache:', error),
    );
  }
  async function acceptImagePatch(data, generation) {
    if (
      destroyed ||
      element.hidden ||
      generation !== rasterVersion ||
      data.baseSequence !== lastSequence ||
      !hasRaster
    )
      return;
    const started = performance.now();
    if (data.images.some((item) => !fastImages.get(item.id)?.variants.has(item.src))) {
      send({ type: 'wii-settings-raster-refresh' });
      return;
    }
    context.drawImage(baseRaster, 0, 0);
    for (const item of data.images) {
      const base = fastImages.get(item.id);
      // Geometry comes from the completed DOM; a geometry/style mutation
      // invalidates this path and sends a new full snapshot instead.
      const patch = base.variants.get(item.src);
      if (patch) context.drawImage(patch, base.x, base.y, base.width, base.height);
    }
    const pixels = context.getImageData(0, 0, rasterWidth, rasterHeight);
    quantizeSettingsRaster(pixels.data);
    context.putImageData(pixels, 0, 0);
    upload(textures[1], raster);
    metrics.fastRasters++;
    lastMarkup = '';
    publishMetrics(data, started);
  }
  function drawQuad(material, width, height, x = 0, alpha = 1, layout = quadLayout) {
    renderer.quad(
      layout,
      {
        origin: 4,
        size: [width, height],
        material,
        texCoords: [
          [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ],
        ],
      },
      [1, 0, 0, 1, x, 0],
      alpha,
    );
  }
  function draw() {
    // The intermediate canvas is composited by the main renderer. A
    // transparent clear avoids the redundant second GPU clear that used to
    // overwrite Renderer.clear() before every Settings frame.
    renderer.clear({ transparent: true });
    rasterRevision++;
    if (!hasRaster) {
      // Renderer uses the same enhanced scene/presentation path as the main
      // menu. Present the cleared scene too, otherwise the Settings canvas
      // remains an untouched black/white default framebuffer while its
      // internal scene target is being rebuilt.
      renderer.present();
      return;
    }
    const alpha = settingsCrossfadeAlpha(transitionFrame);
    // Setting::draw scans the previous RGB565 bank. It paints opaque side
    // panels only when that bank contains nonblack pixels; the first document
    // therefore fades its side panels together with its page texture.
    const sideAlpha = oldRasterHasColor ? 1 : alpha;
    drawQuad(0, 608, 456);
    if (backgroundLayout && display.wide) {
      drawQuad(
        0,
        background.width,
        background.height,
        -display.halfWidth + background.width / 2,
        sideAlpha,
        backgroundLayout,
      );
      drawQuad(
        0,
        background.width,
        background.height,
        display.halfWidth - background.width / 2,
        sideAlpha,
        backgroundLayout,
      );
    }
    drawQuad(1, 608, 456, 0, alpha);
    if (inputMarker.value) {
      const marker = inputMarker.value;
      renderer.quad(
        {
          materials: [{ name: 'HTML nickname selection', colors: [[0, 0, 0, 0], WHITE, WHITE] }],
          textures: [],
        },
        {
          origin: 0,
          material: 0,
          size: [marker.width, marker.height],
          vertexColors: Array.from({ length: 4 }, () => [0, 0, 0, 255]),
        },
        [1, 0, 0, 1, marker.x - 304, 228 - marker.y],
        1,
      );
    }
    if (activeDirection && transitionFrame < SETTINGS_SCROLL_UPDATES) {
      const clip =
        scrollSource.animations[`SceenChange_b_${activeDirection < 0 ? 'Left' : 'Right'}`];
      const pose = poseLayout(scrollSource, [
        { animation: clip, frame: Math.floor(transitionFrame), loop: false },
      ]);
      pose.textures = textures.map((url) => ({ url }));
      for (const material of pose.materials)
        material.textureMaps[0] = { texture: material.name === 'Tex0' ? 0 : 1, wrapS: 0, wrapT: 0 };
      renderer.draw(pose);
    }
    // The Settings surface owns a separate Renderer. Its draw calls target
    // the internal anti-aliased scene framebuffer, so explicitly resolve that
    // framebuffer before the main menu composites this canvas as a texture.
    renderer.present();
  }
  function frame(time) {
    if (destroyed) return;
    const elapsed = Math.min(100, Math.max(0, time - previousTime));
    previousTime = time;
    advance(elapsed * 0.06);
    requestAnimationFrame(frame);
  }
  function advance(frames) {
    if (destroyed) return;
    if (!element.hidden) {
      const sound = soundQueue.advance(frames);
      if (sound !== null) onEvent?.({ action: 'sound', value: sound });
    }
    const previousFrame = transitionFrame;
    transitionFrame = advanceSettingsTextureFrame(transitionFrame, frames, {
      hidden: element.hidden,
      inert: element.inert,
      externalClock,
    });
    const moving = previousFrame < SETTINGS_SCROLL_UPDATES && transitionFrame !== previousFrame;
    if (!element.hidden && (drawDirty || moving)) {
      draw();
      drawDirty = false;
    }
  }
  function message(event) {
    if (event.source !== engine.contentWindow) return;
    const data = event.data;
    if (data?.type === 'wii-settings-frame' && data.action === 'navigate') {
      const target = new URL(data.url, location.href);
      if (target.origin !== location.origin || !target.pathname.startsWith('/assets/settings/'))
        return;
      navigationPending = true;
      navigationStartedAt = performance.now();
      rasterVersion++;
      engine.src = target.href;
      return;
    }
    if (data?.type === 'wii-settings-raster') {
      if (data.action === 'ready') {
        send({ type: 'wii-settings-raster-configure', active: !element.hidden });
      } else if (data.action === 'input-marker') {
        inputMarker.prepare(data.marker);
      } else if (data.action === 'snapshot' || data.action === 'image-patch') {
        const generation = rasterVersion;
        snapshotQueue.submit({ data, generation });
      } else if (data.action === 'error') onEvent?.(data);
      return;
    }
    if (data?.type !== 'wii-settings') return;
    if (data.action === 'sound') {
      if (!element.hidden) soundQueue.request(data.value, data);
      return;
    }
    if (data.action === 'ready') {
      send({ type: 'wii-settings-configure', wide: display.wide, homeKeys });
      send({ type: 'wii-settings-raster-configure', active: !element.hidden });
    } else if (data.action === 'navigation') {
      navigationPending = true;
      navigationStartedAt = performance.now();
      rasterVersion++;
    } else if (data.action === 'transition') direction = data.direction;
    else if (data.action === 'keyboard-request') {
      keyboardRequestId = data.requestId;
      inputMarker.open(data);
      drawDirty = true;
    }
    else if (data.action === 'validation-request') validationRequestId = data.requestId;
    // Native coordinates come from the visible raster's input surface below.
    if (data.action !== 'pointer') onEvent?.(data);
  }
  function input(event, action) {
    if (
      element.hidden ||
      element.inert ||
      keyboardRequestId !== null ||
      validationRequestId !== null ||
      !hasRaster ||
      navigationPending ||
      transitionFrame < (activeDirection ? 40 : 20)
    )
      return;
    const bounds = element.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) * display.width) / bounds.width;
    const y = ((event.clientY - bounds.top) * display.height) / bounds.height;
    onEvent?.({ action: 'pointer', x, y, visible: action !== 'leave' });
    const point = settingsRasterPoint(x, y, display);
    send({
      type: 'wii-settings-raster-input',
      action: action === 'leave' ? 'move' : action,
      x: action === 'leave' ? -1 : point.x,
      y: point.y,
      inputSequence: ++inputSequence,
      requestedAt: Date.now(),
    });
  }
  canvas.addEventListener('pointermove', (event) => input(event, 'move'));
  canvas.addEventListener('pointerleave', (event) => input(event, 'leave'));
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    onEvent?.({ action: 'gesture' });
    input(event, 'activate');
  });
  window.addEventListener('message', message);
  if (!externalClock) requestAnimationFrame(frame);
  return {
    element,
    advance,
    get raster() {
      return { canvas, revision: rasterRevision };
    },
    completeKeyboard({ requestId, text, accepted }) {
      if (keyboardRequestId !== requestId) return false;
      keyboardRequestId = null;
      inputMarker.close(requestId);
      // Completion starts the keyboard exit during the scene's update. Draw
      // immediately so no retained marker survives that first exit frame.
      draw();
      drawDirty = false;
      send({ type: 'wii-settings-keyboard-complete', requestId, text, accepted });
      return true;
    },
    completeValidation(requestId) {
      if (validationRequestId !== requestId) return false;
      validationRequestId = null;
      send({ type: 'wii-settings-validation-complete', requestId });
      return true;
    },
    getPerformance: () => ({
      ...metrics,
      queue: snapshotQueue.snapshot(),
      inputTimings: [...inputTimings],
    }),
    open(url) {
      const target = new URL(url, location.href);
      if (target.origin !== location.origin || !target.pathname.startsWith('/assets/settings/'))
        throw new Error('Invalid Settings entry point.');
      element.hidden = false;
      drawDirty = true;
      openedAt = performance.now();
      metrics.firstReadyMs = null;
      metrics.lastNavigationReadyMs = null;
      navigationStartedAt = null;
      keyboardRequestId = null;
      inputMarker.close();
      validationRequestId = null;
      soundQueue.clear();
      lastMarkup = '';
      fastImages.clear();
      snapshotQueue.clear();
      hasRaster = false;
      rasterHasColor = false;
      oldRasterHasColor = false;
      navigationPending = true;
      direction = 0;
      activeDirection = 0;
      rasterVersion++;
      engine.src = target.href;
    },
    close() {
      element.hidden = true;
      keyboardRequestId = null;
      inputMarker.close();
      validationRequestId = null;
      soundQueue.clear();
      rasterVersion++;
      snapshotQueue.clear();
      send({ type: 'wii-settings-raster-configure', active: false });
    },
    destroy() {
      destroyed = true;
      window.removeEventListener('message', message);
      engine.remove();
      element.remove();
      for (const texture of renderer.textures.values()) renderer.gl.deleteTexture(texture);
    },
  };
}
