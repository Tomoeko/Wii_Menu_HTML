import { materialShaderKey } from './renderer.js';

const CAPTURE_KEY_FIELDS = [
  'index',
  'channel',
  'date',
  'rasterWidth',
  'rasterHeight',
  'displayWidth',
  'displayHeight',
];

function matchingCaptureKey(left, right) {
  return Boolean(left && right) &&
    CAPTURE_KEY_FIELDS.every((field) =>
      Object.hasOwn(left, field) && Object.hasOwn(right, field) && left[field] === right[field]);
}

/** Compile only distinct programs used by loaded preview layouts before the
 * first channel press. Texture loading alone does not compile these programs,
 * which otherwise stalls the first offscreen draw. */
export function warmChannelZoomPrograms(renderer, layouts, onError = () => {}) {
  const seen = new Set();
  let warmed = 0;
  for (const layout of layouts) {
    if (!layout) continue;
    for (const material of layout.materials) {
      try {
        const key = materialShaderKey(material);
        if (seen.has(key)) continue;
        seen.add(key);
        renderer.program(material);
        warmed++;
      } catch (error) {
        onError(error, layout.name, material?.name);
      }
    }
  }
  return warmed;
}

/** Retain one offscreen target across channel visits. A hovered channel may
 * supply frame-zero content for SELECT; Back replaces it on every update. */
export function createChannelZoomCapture(renderer) {
  let handle = null;
  let contentValid = false;
  let contentKey = null;

  return {
    prewarm() {
      if (handle) return;
      handle = renderer.capture(() => {});
      contentValid = false;
    },
    update(draw, { refresh = false, key = null } = {}) {
      if (!contentValid || refresh || (key && !matchingCaptureKey(contentKey, key))) {
        handle = renderer.capture(draw, { reuse: handle });
        contentValid = true;
        contentKey = key;
      }
      return handle;
    },
    matches(key) {
      return contentValid && matchingCaptureKey(contentKey, key);
    },
    invalidate() {
      contentValid = false;
      contentKey = null;
    },
    release() {
      if (handle) renderer.releaseCapture(handle);
      handle = null;
      contentValid = false;
      contentKey = null;
    },
    get current() {
      return contentValid ? handle : null;
    },
  };
}
