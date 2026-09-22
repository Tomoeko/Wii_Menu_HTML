import { indexLayout } from './animation.js';
import { fitChannelArtwork } from './channel-artwork.js';

/** IPL projects into a 640×456 framebuffer, then presents the chosen TV aspect. */
export function createDisplay(aspectRatio = '16:9') {
  if (!['4:3', '16:9'].includes(aspectRatio))
    throw new RangeError(`Unsupported aspect ratio: ${aspectRatio}`);
  const wide = aspectRatio === '16:9',
    width = wide ? 832 : 608,
    height = 456;
  return Object.freeze({
    aspectRatio,
    wide,
    width,
    height,
    halfWidth: width / 2,
    halfHeight: height / 2,
    rootScaleX: width / 608,
    adjustScaleX: 608 / width,
    // USA 4.3 mode records at 0x81634FA8/+0x3c; viewport call 0x81334CBC.
    // Logical projection and CSS output dimensions must not replace this raster.
    framebufferWidth: 640,
    framebufferHeight: 456,
    outputAspect: wide ? 16 / 9 : 4 / 3,
    thumbnailHalfWidth: wide ? 85 : 64,
    thumbnailHalfHeight: 48,
    // my_ChTop_a's Base1/Base0 footer begins at raster Y 339 in the native
    // 456-line preview. Custom banner artwork must fit the visible body above
    // the Wii Menu and Start buttons instead of rendering underneath them.
    bannerContentHeight: 339,
    sdX: wide ? -245 : -152,
    projection: Object.freeze({
      left: -width / 2,
      right: width / 2,
      top: -height / 2,
      bottom: height / 2,
    }),
  });
}

export const standardDisplay = createDisplay('4:3');

/**
 * Object::initLocationAdjust sets root X scale; Pane::CalculateMtx compensates
 * flag 0x04 in the LOCAL scale only. Translations must retain their spacing.
 * An embedded layout inherits the parent's IPL root scale, so must not add it
 * again. Local geometry, already expressed in screen coordinates, opts out.
 */
export function paneForDisplay(
  pane,
  display = standardDisplay,
  { root = false, layoutMode = 'ipl' } = {},
) {
  if (!display.wide || layoutMode === 'local') return pane;
  const rootScale = root && layoutMode === 'ipl' ? display.rootScaleX : 1;
  const adjustment = pane.flags & 4 ? display.adjustScaleX : 1;
  if (rootScale * adjustment === 1) return pane;
  return { ...pane, scale: [pane.scale[0] * rootScale * adjustment, pane.scale[1]] };
}

const wideTextures = {
  my_IplTop_a: [
    ['ChangeTex16x9', ['Picture_00', 'Picture_01', 'Picture_02', 'Picture_03', 'Picture_04']],
    ['Picture_16', ['Edge0', 'Edge1', 'Edge2', 'Edge3', 'Edge4']],
  ],
  my_ChTop_a: [
    ['Picture_04', ['Fre_a', 'Fre_d', 'Fre_i', 'Fre_l']],
    ['Picture_05', ['Fre_e', 'Fre_f', 'Fre_g', 'Fre_h']],
    ['Picture_06', ['Fre_b', 'Fre_c', 'Fre_j', 'Fre_k']],
  ],
  my_DiskCh_In: [['16x9', ['DiskIn']]],
  my_TVShade_a: [['16x9', ['4x3', '4x3_dummy']]],
};

/** Apply the scene's original SetTexture calls before its animation is posed. */
export function prepareAspectLayout(source, display = standardDisplay) {
  if (source.artwork) return fitChannelArtwork(source, display);
  const substitutions = display.wide && wideTextures[source.name];
  if (!substitutions) return source;
  const layout = structuredClone(source),
    { panes } = indexLayout(layout);
  for (const [donor, targets] of substitutions) {
    const sourceMapping = layout.materials[panes.get(donor)?.material]?.textureMaps?.[0];
    if (!sourceMapping)
      throw new Error(`Missing original widescreen donor ${source.name}/${donor}`);
    for (const target of targets) {
      const material = layout.materials[panes.get(target)?.material];
      if (!material?.textureMaps?.length)
        throw new Error(`Missing original widescreen target ${source.name}/${target}`);
      material.textureMaps[0] = { ...sourceMapping };
    }
  }
  return layout;
}

/** Convert CSS pointer coordinates to the source's logical screen rectangle. */
export function screenPoint(display, bounds, clientX, clientY) {
  return {
    x: ((clientX - bounds.left) * display.width) / bounds.width,
    y: ((clientY - bounds.top) * display.height) / bounds.height,
  };
}
