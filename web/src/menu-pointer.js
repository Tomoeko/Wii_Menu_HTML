import { screenPoint } from './display.js';

/**
 * Track the physical pointer independently of scene input locks. A Health or
 * reboot transition may ignore actions, but its next scene still needs the
 * current hotspot. The P1 layout itself owns the hand and shadow offsets.
 */
export function createMenuPointer({ surface, getDisplay, windowTarget = globalThis.window }) {
  const pointer = { x: 304, y: 228, visible: false };
  const removals = [];
  let client = null;
  let active = false;

  function captured() {
    return client && surface.hasPointerCapture?.(client.pointerId) === true;
  }

  function refresh() {
    const display = getDisplay();
    if (!active || !client || !display) {
      pointer.visible = false;
      return;
    }
    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      pointer.visible = false;
      return;
    }
    const point = screenPoint(display, bounds, client.x, client.y);
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.visible = Boolean(captured()) || (
      point.x >= 0 && point.x <= display.width &&
      point.y >= 0 && point.y <= display.height
    );
  }

  function track(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    client = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    active = true;
    refresh();
  }

  function hide() {
    active = false;
    pointer.visible = false;
  }

  function listen(target, type, callback, capture = false) {
    const options = { capture };
    target?.addEventListener(type, callback, options);
    removals.push(() => target?.removeEventListener(type, callback, options));
  }

  for (const type of ['pointerenter', 'pointermove', 'pointerdown']) {
    listen(surface, type, track, true);
  }
  listen(surface, 'pointerleave', () => {
    if (!captured()) hide();
  });
  listen(surface, 'pointercancel', hide);
  listen(surface, 'lostpointercapture', refresh);
  listen(windowTarget, 'blur', hide);
  listen(windowTarget, 'resize', refresh);

  return {
    pointer,
    refresh,
    destroy() {
      for (const remove of removals) remove();
      hide();
    },
  };
}
