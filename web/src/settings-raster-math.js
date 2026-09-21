/** The original browser raster is fixed at 608×456 in either TV aspect mode. */
export const SETTINGS_RASTER = Object.freeze({ width: 608, height: 456 });
export const SETTINGS_CROSSFADE_UPDATES = 20;
export const SETTINGS_SCROLL_UPDATES = 40;
// The global fader holds its first update before changing alpha. The initial
// Settings document shares that update; subsequent browser swaps do not.
export const SETTINGS_FIRST_TEXTURE_FRAME = -1;

/** In shared-clock mode the caller controls pause/resume. Inert only disables
 * input during the global fade; it must not stall the native texture fade. */
export function advanceSettingsTextureFrame(
  frame,
  updates,
  { hidden = false, inert = false, externalClock = false } = {},
) {
  return !hidden && (externalClock || !inert) ? frame + updates : frame;
}

/** BrowserWindow::convertToRGB565 truncates before GX expands the components. */
export function quantizeSettingsRaster(pixels) {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset] >> 3;
    const green = pixels[offset + 1] >> 2;
    const blue = pixels[offset + 2] >> 3;
    pixels[offset] = (red << 3) | (red >> 2);
    pixels[offset + 1] = (green << 2) | (green >> 4);
    pixels[offset + 2] = (blue << 3) | (blue >> 2);
    pixels[offset + 3] = 255;
  }
  return pixels;
}

/** Setting::draw uses integer (frame * 255) / 20, not a CSS eased opacity. */
export function settingsCrossfadeAlpha(updates) {
  const frame = Math.max(0, Math.min(SETTINGS_CROSSFADE_UPDATES, Math.floor(updates)));
  return Math.floor((frame * 255) / SETTINGS_CROSSFADE_UPDATES) / 255;
}

export function settingsRasterPoint(x, y, display) {
  return { x: x - (display.width - SETTINGS_RASTER.width) / 2, y };
}
