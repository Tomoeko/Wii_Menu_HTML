/** The HTML form selection is frozen behind the independent software keyboard.
 * Keep it outside the raster cache so dismissal removes it in the same frame. */
export function createSettingsInputMarker() {
  let pending = null;
  let marker = null;
  let requestId = null;
  return {
    prepare(value) {
      if (requestId !== null) return;
      const valid = value && ['x', 'y', 'width', 'height'].every((key) =>
        Number.isFinite(value[key]));
      pending = valid && value.width > 0 && value.height > 0 ? { ...value } : null;
    },
    open(request) {
      requestId = request.requestId;
      marker = request.profile === 'console-nickname' ? pending : null;
      pending = null;
    },
    close(id = requestId) {
      if (id !== requestId) return false;
      pending = null;
      marker = null;
      requestId = null;
      return true;
    },
    get value() {
      return marker;
    },
  };
}
