import { indexLayout } from './animation.js';

/** Keep authored pixels proportional after IPL's non-square raster presentation. */
export function fitChannelArtwork(layout, display) {
  if (!layout.artwork) return layout;
  const result = structuredClone(layout);
  const { panes } = indexLayout(result);
  const { kind, width, height } = result.artwork;
  const areaWidth = kind === 'icon' ? display.thumbnailHalfWidth * 2 : display.width;
  const areaHeight =
    kind === 'icon' ? display.thumbnailHalfHeight * 2 : display.bannerContentHeight;
  const pixelAspect = (display.outputAspect * display.height) / display.width;
  const scale = Math.min((areaWidth * pixelAspect) / width, areaHeight / height);
  // A fitted source often lands within a fraction of a logical pixel from a
  // native edge (for example, a 239×100 GIF in the 832×339 wide banner body).
  // Leaving that fraction to the rasterizer exposes a one-pixel seam beside
  // the footer or side mask. Snap only near-boundary values so ordinary
  // artwork keeps its exact aspect-ratio fit.
  const snapToBoundary = (value, boundary) =>
    Math.abs(value - boundary) < 1 ? boundary : value;
  const fitted = [
    snapToBoundary((width * scale) / pixelAspect, areaWidth),
    snapToBoundary(height * scale, areaHeight),
  ];
  const artworkOffsetY = kind === 'banner' ? (display.height - areaHeight) / 2 : 0;
  const background = panes.get('Background');
  background.translation[1] += artworkOffsetY;
  background.size = [areaWidth, areaHeight];
  const artwork = panes.get('Artwork');
  const border = panes.get('ArtworkBorder');
  artwork.translation[1] += artworkOffsetY;
  border.translation[1] += artworkOffsetY;
  artwork.size = fitted;
  border.size = [
    Math.min(areaWidth, fitted[0] + 4 / pixelAspect),
    Math.min(areaHeight, fitted[1] + 4),
  ];
  return result;
}

export function imageFrameTexture(animation, elapsedFrames) {
  const duration = animation.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  const elapsed = (Math.max(0, elapsedFrames) * 1000) / 60;
  if (animation.repetitions > 0 && elapsed >= duration * animation.repetitions) {
    return animation.frames.at(-1).texture;
  }
  let time = elapsed % duration;
  for (const frame of animation.frames) {
    if (time < frame.durationMs) return frame.texture;
    time -= frame.durationMs;
  }
  return animation.frames.at(-1).texture;
}

/** GIF time follows the same channel clock as every other authored animation. */
export function poseImageAnimations(layout, elapsedFrames) {
  if (!layout.imageAnimations?.length) return;
  const textures = new Map(
    layout.imageAnimations.map((animation) => [
      animation.texture,
      imageFrameTexture(animation, elapsedFrames),
    ]),
  );
  for (const material of layout.materials) {
    for (const mapping of material.textureMaps ?? []) {
      const selected = textures.get(mapping.texture);
      if (selected !== undefined) mapping.texture = selected;
    }
  }
}
