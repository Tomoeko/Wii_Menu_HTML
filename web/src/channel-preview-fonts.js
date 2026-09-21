export const MENU_FALLBACK_FONT = 'RevoIpl_RodinNTLGPro_DB_48_IA4.brfnt';

/** Match the menu renderer when optional shared-font aliases are unavailable. */
export function channelPreviewFontDescriptor(manifest, name) {
  const fonts = manifest.fonts ?? {};
  const descriptor = fonts[name] ?? fonts[MENU_FALLBACK_FONT];
  if (!descriptor) {
    throw new Error('A channel font is missing. Prepare the menu assets again.');
  }
  return descriptor;
}
