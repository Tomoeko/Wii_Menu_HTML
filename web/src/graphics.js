/** Dolphin-style coverage-preserving enhancements enabled for the public default. */
export const DEFAULT_GRAPHICS = Object.freeze({
  resolutionScale: 1,
  antiAliasing: 'ssaa-4x',
  colorCorrection: 'gamma',
  sourceGamma: 2.35,
});

// Keep the final presentation pass within a 4K-sized pixel budget. The scene
// remains at the Wii's native raster plus SSAA; this cap only bounds the cheap
// fullscreen resampling pass on very large or high-DPI browser surfaces.
export const MAX_PRESENTATION_PIXELS = 3840 * 2160;

export function normalizeGraphics(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('graphics must be an object.');
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(DEFAULT_GRAPHICS, key)) throw new Error(`Unknown graphics option: ${key}.`);
  }
  const graphics = { ...DEFAULT_GRAPHICS, ...value };
  if (!Number.isInteger(graphics.resolutionScale) || graphics.resolutionScale < 1 ||
      graphics.resolutionScale > 4) {
    throw new Error('graphics.resolutionScale must be an integer between 1 and 4.');
  }
  if (!['none', 'post-process', 'ssaa-4x', 'ssaa-9x'].includes(graphics.antiAliasing)) {
    throw new Error('graphics.antiAliasing must be "none", "post-process", ' +
      '"ssaa-4x", or "ssaa-9x".');
  }
  if (!['none', 'gamma', 'ntsc-m'].includes(graphics.colorCorrection)) {
    throw new Error('graphics.colorCorrection must be "none", "gamma", or "ntsc-m".');
  }
  if (!Number.isFinite(graphics.sourceGamma) || graphics.sourceGamma < 1 ||
      graphics.sourceGamma > 3) {
    throw new Error('graphics.sourceGamma must be between 1 and 3.');
  }
  return graphics;
}

export function supersampleScale(graphics = DEFAULT_GRAPHICS) {
  if (graphics.antiAliasing === 'ssaa-4x') return 2;
  if (graphics.antiAliasing === 'ssaa-9x') return 3;
  return 1;
}

export function graphicsDimensions(display, graphics = DEFAULT_GRAPHICS) {
  const width = display.framebufferWidth * graphics.resolutionScale;
  const height = display.framebufferHeight * graphics.resolutionScale;
  const samples = supersampleScale(graphics);
  return {
    width,
    height,
    internalWidth: width * samples,
    internalHeight: height * samples,
    rasterScale: graphics.resolutionScale * samples,
  };
}

/**
 * Return the physical canvas size used by the final presentation pass.
 *
 * The browser CSS surface can be much larger than the Wii scene, especially on
 * a 4K display with a device pixel ratio above one. Matching that surface keeps
 * the browser from applying a second, blurry bitmap scale after WebGL has
 * finished. The cap prevents that final shader from becoming an accidental
 * performance sink on oversized desktop surfaces.
 */
export function presentationDimensions(
  surfaceWidth,
  surfaceHeight,
  devicePixelRatio,
  sceneDimensions,
  maxPixels = MAX_PRESENTATION_PIXELS,
) {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  let width = Math.max(sceneDimensions.width, Math.round(surfaceWidth * dpr));
  let height = Math.max(sceneDimensions.height, Math.round(surfaceHeight * dpr));
  const pixelCount = width * height;
  if (pixelCount > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixelCount);
    width = Math.max(sceneDimensions.width, Math.floor(width * scale));
    height = Math.max(sceneDimensions.height, Math.floor(height * scale));
  }
  return { width, height };
}

export function usesPresentationPass(graphics = DEFAULT_GRAPHICS) {
  return graphics.antiAliasing !== 'none' || graphics.colorCorrection !== 'none';
}
