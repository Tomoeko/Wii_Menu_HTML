import { poseLayout } from './animation.js';
import { nativeFadeSample } from './native-fader.js';

// These two service waits are an explicit browser fixture, fitted to the
// supplied USA4.3 HOME-return capture. They are not constants in the executable:
// BackMenu waits on system readiness flags before and after its outgoing fade.
export const RESTART_SERVICE_FIXTURE = Object.freeze({ readyFrames: 94, blackFrames: 43 });

/** Resolve HOME's completion callback before choosing the drawing owner.
 * A restart started during this update receives only HOME's unused time. */
export function advanceHomeBoundary(home, restart, frames) {
  if (restart.active) return frames;
  const remainder = home.advance(frames);
  return restart.active ? remainder : null;
}

/** BackMenu's original embedded layout owns the loading display. HOME has
 * already completed its own black fade before this controller starts. */
export function createMenuRestart(
  source,
  {
    readyFrames = RESTART_SERVICE_FIXTURE.readyFrames,
    blackFrames = RESTART_SERVICE_FIXTURE.blackFrames,
    onGrid = () => {},
    onComplete = () => {},
    onError = () => {},
  } = {},
) {
  for (const value of [readyFrames, blackFrames])
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid restart service wait');
  const animation = source?.animations?.my_BackToWiiMenu;
  if (!animation) throw new Error('Missing original Back-to-Wii-Menu animation');
  let state = null;

  return {
    get active() {
      return state !== null;
    },
    start({ ready = Promise.resolve() } = {}) {
      if (state) return false;
      const request = { phase: 'loading', frame: 0, animationFrame: 1, ready: false, error: null };
      state = request;
      Promise.resolve(ready).then(
        () => {
          if (state === request) request.ready = true;
        },
        (error) => {
          if (state !== request) return;
          request.error = error.message;
          onError(error);
        },
      );
      return true;
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0) throw new RangeError('Invalid restart delta');
      // Preserve frame remainder across phase boundaries, including fractional
      // browser ticks. Every full update runs the native phase transition once.
      let remaining = frames;
      while (state && remaining > 0) {
        const step = Math.min(remaining, 1 - (state.frame % 1));
        state.frame += step;
        if (['loading', 'out'].includes(state.phase)) state.animationFrame += step;
        remaining -= step;
        if (state.phase === 'loading' && state.ready && state.frame >= Math.max(22, readyFrames)) {
          state.phase = 'out';
          state.frame = 0;
        } else if (state.phase === 'out' && nativeFadeSample(state.frame, 'out').complete) {
          state.phase = blackFrames === 0 ? 'grid' : 'black';
          state.frame = 0;
          if (blackFrames === 0) onGrid({ remainingFrames: remaining });
        } else if (state.phase === 'black' && state.frame >= blackFrames) {
          state.phase = 'grid';
          state.frame = 0;
          onGrid({ remainingFrames: remaining });
        } else if (state.phase === 'grid' && nativeFadeSample(state.frame, 'in').complete) {
          state = null;
          onComplete();
        }
      }
    },
    sample() {
      if (!state) return { phase: 'complete', alpha: 0, complete: true };
      const { phase, frame, animationFrame, error } = state;
      const direction = phase === 'out' ? 'out' : 'in';
      const alpha = phase === 'black' ? 255 : nativeFadeSample(frame, direction).alpha;
      return { phase, frame, animationFrame, alpha, complete: false, error };
    },
    pose() {
      if (!state || !['loading', 'out'].includes(state.phase)) return null;
      return poseLayout(source, [{ animation, frame: state.animationFrame, loop: true }]);
    },
  };
}
