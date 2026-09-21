import { indexLayout } from './animation.js';

/** Keep authored pixels proportional after IPL's non-square raster presentation. */
export function fitChannelArtwork(layout, display) {
  if (!layout.artwork) return layout;
  const result = structuredClone(layout);
  const { panes } = indexLayout(result);
  const { kind, width, height } = result.artwork;
  const areaWidth = kind === 'icon' ? display.thumbnailHalfWidth * 2 : display.width;
  const areaHeight = kind === 'icon' ? display.thumbnailHalfHeight * 2 : display.height;
  const pixelAspect = (display.outputAspect * display.height) / display.width;
  const scale = Math.min((areaWidth * pixelAspect) / width, areaHeight / height);
  const fitted = [(width * scale) / pixelAspect, height * scale];
  panes.get('Background').size = [areaWidth, areaHeight];
  panes.get('Artwork').size = fitted;
  panes.get('ArtworkBorder').size = [
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
