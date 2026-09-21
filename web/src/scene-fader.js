import { nativeFadeSample } from './native-fader.js';

/** Keep the outgoing scene alive until black; initialize the next scene behind
 * the fader. Most scene entrances wait until reveal finishes, while the SD
 * loading controller explicitly runs beneath the incoming fade. */
export function createSceneFader() {
  let state = null;
  return {
    get active() {
      return state !== null;
    },
    get revealing() {
      return state?.phase === 'in';
    },
    start(switchScene) {
      if (state) return false;
      state = { phase: 'out', frame: 0, switchScene };
      return true;
    },
    advance(frames) {
      if (!state || state.phase === 'wait') return;
      state.frame += frames;
      if (!nativeFadeSample(state.frame, state.phase).complete) return;
      if (state.phase === 'out') {
        const next = state.switchScene;
        const waiting = { phase: 'wait', frame: 0 };
        state = waiting;
        const ready = next();
        if (ready?.then)
          ready.then(() => {
            if (state === waiting) state = { phase: 'in', frame: 0 };
          });
        else state = { phase: 'in', frame: 0 };
      } else state = null;
    },
    sample() {
      if (state?.phase === 'wait') return { alpha: 255, complete: false };
      return state ? nativeFadeSample(state.frame, state.phase) : { alpha: 0, complete: true };
    },
  };
}
