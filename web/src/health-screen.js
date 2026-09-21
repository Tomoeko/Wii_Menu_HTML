import { indexLayout, poseLayout } from './animation.js';

/** skHealth: SeenIn, one-second wait, original looping prompt, SeenOut. */
export function createHealthScreen(source, { enabled = true, locale = 'US_ENG' } = {}) {
  const animation = (suffix) => source.animations[`it_Has_a_${suffix}`];
  const enterFrames = animation('SeenIn').frames;
  const exitFrames = animation('SeenOut').frames;
  let elapsed = 0;
  let phase = enabled ? 'enter' : 'done';
  let exitStart = 0;
  return {
    get active() {
      return phase !== 'done';
    },
    get ready() {
      return phase === 'wait';
    },
    advance(frames) {
      elapsed += frames;
      if (phase === 'enter' && elapsed >= enterFrames + 60) phase = 'wait';
      if (phase === 'wait' && elapsed >= enterFrames + 60 + 3600) this.accept();
      if (phase === 'leave' && elapsed - exitStart >= exitFrames) phase = 'done';
    },
    accept() {
      if (phase !== 'wait') return false;
      phase = 'leave';
      exitStart = elapsed;
      return true;
    },
    pose() {
      const clips = [
        { animation: animation('SeenIn'), frame: elapsed, group: 'G_All', loop: false },
      ];
      if (phase === 'wait')
        clips.push({
          animation: animation('Push'),
          frame: elapsed - enterFrames - 60,
          group: 'G_Push',
          loop: true,
        });
      // advance() observes completion before this last draw. Retain SeenOut's
      // terminal pose until the scene is replaced; restoring SeenIn here would
      // flash the fully opaque warning for one frame just before black.
      if (phase === 'leave' || (phase === 'done' && exitStart > 0))
        clips.push({
          animation: animation('SeenOut'),
          frame: elapsed - exitStart,
          group: 'G_All',
          loop: false,
        });
      const layout = poseLayout(source, clips);
      for (const [name, pane] of indexLayout(layout).panes) {
        if (name.startsWith('Has_'))
          pane.flags = name === `Has_${locale}` ? pane.flags | 1 : pane.flags & ~1;
        if (name.startsWith('Push_'))
          pane.flags =
            name === `Push_${locale}` && ['wait', 'leave'].includes(phase)
              ? pane.flags | 1
              : pane.flags & ~1;
      }
      return layout;
    },
  };
}
