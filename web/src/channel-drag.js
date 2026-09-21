import { indexLayout, poseLayout } from './animation.js';

/** ChannelSelect grab/drop controllers. Native occupied slots reject a drop. */
export function createChannelDrag({ mask, shade, drop }, { wide = false } = {}) {
  const clip = (source, suffix, frame) => ({
    animation: source.animations[`${source.name}_${suffix}`],
    frame,
    loop: false,
  });
  const length = (source, suffix) =>
    Math.max(0, source.animations[`${source.name}_${suffix}`].frames - 1);
  let state = null;
  let pendingRelease = false;
  const grabFrames = Math.max(length(mask, 'Apear'), length(shade, 'Apear'));

  function release(slots, { scrolling = false } = {}) {
    if (!state || !['grab', 'drag'].includes(state.phase)) return null;
    if (state.phase === 'grab' || scrolling) {
      pendingRelease = true;
      return null;
    }
    const valid =
      Number.isInteger(state.target) &&
      state.target > 0 &&
      state.target < slots.length &&
      (state.target === state.source || !slots[state.target]);
    state = { ...state, phase: valid ? 'drop-in' : 'cancel', frame: 0, releaseFrame: 0, valid };
    return valid ? 'drop' : 'invalidDrop';
  }

  return {
    getState: () => state && { ...state },
    start(index, slots, point) {
      if (state || !slots[index] || slots[index].id === 'disc') return false;
      state = {
        source: index,
        target: index,
        phase: 'grab',
        frame: 0,
        appearanceFrame: 0,
        point: { ...point },
        edge: 0,
        edgeFrames: 0,
      };
      pendingRelease = false;
      return true;
    },
    point(point, target, edge = 0) {
      if (!state || !['grab', 'drag'].includes(state.phase)) return;
      state.point = { ...point };
      state.target = target;
      if (edge !== state.edge) state.edgeFrames = 0;
      state.edge = edge;
    },
    release,
    cancel() {
      if (!state) return;
      state = { ...state, phase: 'cancel', frame: 0, releaseFrame: 0, valid: false };
      pendingRelease = false;
    },
    advance(frames, slots, { scrolling = false } = {}) {
      if (!state) return {};
      state.frame += frames;
      state.appearanceFrame += frames;
      if (state.releaseFrame !== undefined) state.releaseFrame += frames;
      const events = {};
      if (state.phase === 'grab' && state.frame >= grabFrames) {
        state.phase = 'drag';
        state.frame = 0;
      }
      if (state.phase === 'drag' && pendingRelease && !scrolling) {
        pendingRelease = false;
        events.sound = release(slots);
      }
      if (state.phase === 'drag' && state.edge && !scrolling) {
        state.edgeFrames += frames;
        if (state.edgeFrames >= 15) {
          events.page = state.edge;
          state.edgeFrames = 0;
        }
      }
      if (state.phase === 'drop-in' && state.frame >= length(drop, 'Apear')) {
        events.move = [state.source, state.target];
        state = { ...state, phase: 'drop-out', frame: 0 };
      }
      if (
        (state.phase === 'drop-out' && state.frame >= length(drop, 'Lost')) ||
        (state.phase === 'cancel' && state.frame >= 21 + length(mask, 'Lost'))
      )
        state = null;
      return events;
    },
    maskPose() {
      if (!state) return null;
      const leaving = ['drop-in', 'drop-out', 'cancel'].includes(state.phase);
      const frame =
        state.phase === 'cancel'
          ? Math.max(0, state.frame - 21)
          : state.phase === 'drop-out'
            ? length(mask, 'Lost')
            : leaving
              ? state.frame
              : state.appearanceFrame;
      return poseLayout(mask, [clip(mask, leaving ? 'Lost' : 'Apear', frame)]);
    },
    shadePose() {
      if (!state) return null;
      const leaving = ['drop-in', 'drop-out', 'cancel'].includes(state.phase);
      // The shade's Lost clip starts once on release. Drop-in and drop-out are
      // independent controllers; advancing between them must not restart it.
      const layout = poseLayout(shade, [
        clip(
          shade,
          leaving ? 'Lost' : 'Apear',
          leaving ? state.releaseFrame : state.appearanceFrame,
        ),
      ]);
      if (wide) {
        const panes = indexLayout(layout).panes;
        const donor = layout.materials[panes.get('16x9').material].textureMaps[0];
        for (const name of ['4x3', '4x3_dummy']) {
          Object.assign(layout.materials[panes.get(name).material].textureMaps[0], donor);
        }
      }
      return layout;
    },
    dropPose() {
      if (!state || !['drop-in', 'drop-out'].includes(state.phase)) return null;
      return poseLayout(drop, [
        clip(drop, state.phase === 'drop-in' ? 'Apear' : 'Lost', state.frame),
      ]);
    },
  };
}
