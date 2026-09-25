import { identity, multiply, paneMatrix, poseLayout, transform } from './animation.js';
import { paneForDisplay } from './display.js';

export const CHANNEL_ZOOM_FRAMES = 28;
const mix = (a, b, amount) => a + (b - a) * amount;

/** ChannelSelect::initChanZoomParam samples the twelve center-page anchors
 * from the frame-zero WAD pose. The camera reuses these centers for every
 * update of the enter and return animation. */
export function channelZoomCenters(source, display) {
  const names = Array.from({ length: 12 }, (_, index) =>
    `N_Ch_c${String(index + 1).padStart(2, '0')}`);
  const layout = poseLayout(source, [{
    animation: source.animations.my_IplTop_a,
    frame: 0,
    loop: false,
  }]);
  const anchors = sourceAnchorMatrices(layout, names, {
    mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
  });
  if (anchors.length !== names.length)
    throw new Error('Channel zoom anchors are incomplete.');
  return anchors.map((anchor) => transform(anchor.matrix, 0, 0));
}

/** Native draw order: ChannelSelect's full-screen ChMask, captured preview,
 * then ChannelTitle's black outside rectangles. The two independent fades
 * darken the grid twice; omitting ChMask makes the midpoint twice as bright.
 */
export function drawChannelZoom(renderer, gridLayout, zoom, capture, drawOutside) {
  renderer.draw(gridLayout, {
    matrix: zoom.cameraMatrix,
    onPane: (pane) => pane === gridLayout.root || pane.name === 'ChMask',
  });
  renderer.drawCapture(capture, { matrix: zoom.previewMatrix, alpha: zoom.alpha });
  for (const rect of zoom.outsideRects) drawOutside(rect, zoom.alpha);
}

/** ChannelSelect::initChanZoomParam and ChannelTitle::draw use the same Hermite.
 * Projection follows NW4R Rect convention (negative top, positive bottom).
 * Render the complete preview to a texture first: applying alpha separately to
 * its overlapping layers does not reproduce the native captured-image blend.
 */
export function channelZoom({
  frame = 0,
  direction = 'in',
  center,
  wide = false,
  projection = { left: -304, right: 304, top: -228, bottom: 228 },
}) {
  if (!center || center.length < 2 || !center.every(Number.isFinite))
    throw new TypeError('A finite channel center is required');
  if (!['in', 'out'].includes(direction)) throw new RangeError('Unknown zoom direction');
  const elapsed = Math.max(0, Math.min(CHANNEL_ZOOM_FRAMES, frame));
  const time =
    (direction === 'out' ? CHANNEL_ZOOM_FRAMES - elapsed : elapsed) / CHANNEL_ZOOM_FRAMES;
  const amount = time * time * (3 - 2 * time);
  const width = projection.right - projection.left,
    height = projection.bottom - projection.top;
  if (!(width > 0 && height > 0)) throw new RangeError('Projection must have positive dimensions');
  const halfX = wide ? 85 : 64,
    halfY = 48;
  const thumbnail = {
    left: center[0] - halfX,
    right: center[0] + halfX,
    top: center[1] + halfY,
    bottom: center[1] - halfY,
  };
  const camera = {
    left: mix(projection.left, thumbnail.left, amount),
    right: mix(projection.right, thumbnail.right, amount),
    top: mix(-projection.top, thumbnail.top, amount),
    bottom: mix(-projection.bottom, thumbnail.bottom, amount),
  };
  const scaleX = width / (camera.right - camera.left),
    scaleY = height / (camera.top - camera.bottom);
  const outputCenterX = (projection.left + projection.right) / 2,
    outputCenterY = -(projection.top + projection.bottom) / 2;
  const cameraMatrix = [
    scaleX,
    0,
    0,
    scaleY,
    outputCenterX - ((camera.left + camera.right) / 2) * scaleX,
    outputCenterY - ((camera.top + camera.bottom) / 2) * scaleY,
  ];
  // Maps default-projection preview pixels to the selected channel rectangle.
  const previewMatrix = multiply(cameraMatrix, [
    (halfX * 2) / width,
    0,
    0,
    (halfY * 2) / height,
    center[0] - (outputCenterX * halfX * 2) / width,
    center[1] - (outputCenterY * halfY * 2) / height,
  ]);
  const left = thumbnail.left * scaleX + cameraMatrix[4] - projection.left;
  const top = -projection.top - (thumbnail.top * scaleY + cameraMatrix[5]);
  const screenRect = { x: left, y: top, w: halfX * 2 * scaleX, h: halfY * 2 * scaleY };
  const right = Math.min(width, Math.max(0, left + screenRect.w)),
    bottom = Math.min(height, Math.max(0, top + screenRect.h));
  const x = Math.min(width, Math.max(0, left)),
    y = Math.min(height, Math.max(0, top));
  return {
    frame: elapsed,
    amount,
    camera,
    cameraMatrix,
    previewMatrix,
    screenRect,
    // ChannelTitle casts the opacity to u8 before GX drawing.
    alpha: Math.floor(255 * amount) / 255,
    outsideRects: [
      { x: 0, y: 0, w: width, h: y },
      { x: 0, y: bottom, w: width, h: height - bottom },
      { x: 0, y, w: x, h: bottom - y },
      { x: right, y, w: width - right, h: bottom - y },
    ].filter((rect) => rect.w > 0 && rect.h > 0),
    layoutFrame: 200 + (direction === 'out' ? CHANNEL_ZOOM_FRAMES - elapsed : elapsed),
    bannerStarts: direction === 'in' && elapsed === CHANNEL_ZOOM_FRAMES,
  };
}

/** Native clock::draw fetches even invisible anchor panes, then copies only XY.
 * mapPane allows the display adapter's NW4R widescreen adjustment before the
 * global transform is calculated. Apply the zoom camera after these matrices.
 */
export function sourceAnchorMatrices(
  layout,
  names = ['N_Clock0', 'N_Clock1', 'N_Clock2'],
  { mapPane = (pane) => pane } = {},
) {
  const wanted = new Set(names),
    result = new Map();
  const visit = (pane, parent, root) => {
    const matrix = multiply(parent, paneMatrix(mapPane(pane, root)));
    if (wanted.has(pane.name))
      result.set(pane.name, [
        1,
        0,
        0,
        1,
        matrix.length === 12 ? matrix[3] : matrix[4],
        matrix.length === 12 ? matrix[7] : matrix[5],
      ]);
    for (const child of pane.children || []) visit(child, matrix, false);
  };
  visit(layout.root, identity, true);
  return names
    .filter((name) => result.has(name))
    .map((name) => ({ name, matrix: result.get(name) }));
}
