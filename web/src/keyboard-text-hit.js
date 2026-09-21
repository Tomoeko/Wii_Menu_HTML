import { identity, multiply, paneMatrix } from './animation.js';
import { createDisplay, paneForDisplay } from './display.js';

/** Hit-test the same projected pane and glyph caret positions used for drawing. */
export function keyboardCaretAtPoint({
  layout,
  paneName,
  hitPaneName = paneName,
  text,
  point,
  display = { width: 832 },
  measure,
  clip,
}) {
  if (!point || !measure) return null;
  if (clip && (point.x < clip.x || point.x > clip.x + clip.w ||
      point.y < clip.y || point.y > clip.y + clip.h)) return null;
  const projection = createDisplay(display.width > 700 ? '16:9' : '4:3');
  let target = null;
  let hitTarget = null;
  const visit = (pane, parent, root = false) => {
    if (!(pane.flags & 1)) return;
    const matrix = multiply(parent, paneMatrix(paneForDisplay(pane, projection, { root })));
    if (pane.name === paneName) target = { pane, matrix };
    if (pane.name === hitPaneName) hitTarget = { pane, matrix };
    for (const child of pane.children || []) visit(child, matrix);
  };
  visit(layout.root, identity, true);
  if (!target || !hitTarget) return null;
  const localPoint = ({ matrix }) => {
    const affine = matrix.length === 12
      ? [matrix[0], matrix[4], matrix[1], matrix[5], matrix[3], matrix[7]]
      : matrix;
    const [a, b, c, d, tx, ty] = affine;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 1e-8) return null;
    const projectedX = point.x - projection.halfWidth - tx;
    const projectedY = projection.halfHeight - point.y - ty;
    return {
      x: (d * projectedX - c * projectedY) / determinant,
      y: (a * projectedY - b * projectedX) / determinant,
    };
  };
  const { pane } = target;
  const position = localPoint(target);
  const hit = localPoint(hitTarget);
  if (!position || !hit) return null;
  const { x, y } = position;
  const bounds = hitTarget.pane;
  const left = -(bounds.origin % 3) * bounds.size[0] / 2;
  const top = Math.floor(bounds.origin / 3) * bounds.size[1] / 2;
  if (!clip && (hit.x < left || hit.x > left + bounds.size[0] ||
      hit.y > top || hit.y < top - bounds.size[1]))
    return null;
  const measured = measure(text, pane, layout);
  if (!measured.lines.length) return 0;
  const line = measured.lines.reduce((nearest, candidate) => {
    const center = candidate.y - measured.lineHeight / 2;
    const previousCenter = nearest.y - measured.lineHeight / 2;
    return Math.abs(y - center) < Math.abs(y - previousCenter) ? candidate : nearest;
  });
  if (!line.carets?.length) return line.start;
  return line.carets.reduce((nearest, candidate) =>
    Math.abs(candidate.x - x) < Math.abs(nearest.x - x) ? candidate : nearest,
  ).index;
}


/** Visible controls occlude the text pane beneath them, including candidate
 * words while their page movement disables input. Preserve the hit control's
 * disabled state for callers to gate actions independently from occlusion.
 * Match the DOM's last-drawn control precedence.
 */
function topControlAtPoint(point, controls) {
  return controls.findLast((item) => {
    const rect = item.rect;
    return rect && point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h;
  });
}

export function routeKeyboardTextPointer(point, controls, selectText) {
  const control = topControlAtPoint(point, controls);
  const textOpener = ['memo-edit', 'scene-memo-edit', 'letter-edit', 'scene-letter-edit']
    .includes(control?.id);
  return {
    control,
    selected: (!control || (textOpener && !control.disabled)) && Boolean(selectText(point)),
  };
}

/** Native B applies only to phone keytops. A higher dialog, disabled key or
 * other control must block it rather than forwarding a secondary scene action.
 */
export function keyboardSecondaryTarget(point, controls) {
  const control = topControlAtPoint(point, controls);
  if (!control || control.disabled) return null;
  const match = /^(scene-|settings-keyboard-)(key-phone-\d+)$/.exec(control.id);
  return match ? { prefix: match[1], id: match[2] } : null;
}
