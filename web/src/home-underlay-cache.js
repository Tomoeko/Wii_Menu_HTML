import { createFramebufferSnapshot } from './framebuffer-snapshot.js';

// Keep this optional optimization below a modest memory budget. At native
// 640×456 it uses about 1.1 MiB; larger supersample targets fall back to the
// ordinary renderer when they exceed the budget.
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export function homeUnderlayEligible({
  state,
  homeActive,
  startupComplete,
  entranceComplete,
  settingsVisible,
  dragging,
  sceneTransition,
  sceneFaderActive,
  restartActive,
  notice,
  keyboardActive,
  dialogActive,
}) {
  return Boolean(
    homeActive &&
      startupComplete &&
      entranceComplete &&
      state.overlay === 'home' &&
      ['grid', 'preview'].includes(state.screen) &&
      !state.transition &&
      !settingsVisible &&
      !dragging &&
      !sceneTransition &&
      !sceneFaderActive &&
      !restartActive &&
      !notice &&
      !keyboardActive &&
      !dialogActive,
  );
}

function sameKey(left, right) {
  return Boolean(
    left &&
      left.length === right.length &&
      left.every((value, index) => value === right[index]),
  );
}

/**
 * Cache only a stable grid/preview underlay while HOME owns the foreground.
 * The caller continues to draw HOME, the pointer, notices and faders each frame.
 */
export function createHomeUnderlayCache(renderer, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error('HOME snapshot budget must be a nonnegative byte count.');
  let snapshot = null;
  let key = null;
  let disabledReason = null;
  let contextLost = false;
  let destroyed = false;
  const statistics = { captures: 0, restores: 0, underlayDraws: 0, releases: 0 };

  function release() {
    if (snapshot) {
      snapshot.release();
      snapshot = null;
      statistics.releases++;
    }
    key = null;
  }

  function reset() {
    release();
    disabledReason = null;
  }

  function loseContext() {
    contextLost = true;
    release();
    disabledReason = 'WebGL context lost';
  }

  renderer.canvas.addEventListener('webglcontextlost', loseContext);

  return {
    draw(sceneKey, drawUnderlay) {
      if (sceneKey === null) reset();
      if (destroyed || contextLost || sceneKey === null || disabledReason) {
        statistics.underlayDraws++;
        drawUnderlay();
        return;
      }
      const nextKey = [
        renderer.display,
        renderer.display.width,
        renderer.display.height,
        renderer.canvas.width,
        renderer.canvas.height,
        renderer.rasterWidth,
        renderer.rasterHeight,
        ...sceneKey,
      ];
      if (!sameKey(key, nextKey)) release();
      if (snapshot) {
        snapshot.restore();
        statistics.restores++;
        return;
      }
      statistics.underlayDraws++;
      drawUnderlay();
      const bytes = renderer.rasterWidth * renderer.rasterHeight * 4;
      if (bytes > maxBytes) {
        disabledReason = `Snapshot requires ${bytes} bytes; budget is ${maxBytes}.`;
        return;
      }
      try {
        snapshot = createFramebufferSnapshot(renderer);
        key = nextKey;
        statistics.captures++;
      } catch (error) {
        // Do not retry allocation every frame. The completed ordinary draw is
        // already correct, and reset() will re-enable the cache next episode.
        disabledReason = error.message;
      }
    },
    reset,
    destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      renderer.canvas.removeEventListener('webglcontextlost', loseContext);
    },
    status() {
      return {
        ...statistics,
        bytes: snapshot ? snapshot.width * snapshot.height * 4 : 0,
        disabledReason,
        contextLost,
        destroyed,
      };
    },
  };
}
