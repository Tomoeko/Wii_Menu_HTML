import { indexLayout, poseLayout } from './animation.js';

export const SD_LOADING_LAYOUTS = ['mn_Nocard'];
export const SD_LOADING_MINIMUM_SECONDS = 1;

/** USA 4.3 SD message controller, 0x813DCAC4. Request 8/message 170 uses
 * IN_02, Group_01, then Wait/G_Wait, then OUT_02.
 * Empty-card completion at 0x813DBEB8 closes as soon as the entry request
 * clears. Populated-list reconciliation at 0x813DC01C additionally waits one
 * timebase second after IN_02 completes.
 */
export function createSDLoading(
  layouts,
  { messages = {}, isReady = () => true, hasChannels = false } = {},
) {
  const source = layouts.mn_Nocard;
  const messageMap = messages.messages || messages;
  const animation = (suffix) => source.animations[`mn_Nocard_${suffix}`];
  let phase = 'enter';
  let frame = 0;
  const minimumFrames = hasChannels ? SD_LOADING_MINIMUM_SECONDS * 60 : 0;
  const clip = (suffix, group, value, loop = false) => ({
    animation: animation(suffix),
    group,
    frame: loop ? value : Math.min(value, animation(suffix).frames),
    loop,
  });
  return {
    get active() {
      return phase !== 'done';
    },
    advance(frames) {
      if (phase === 'done') return;
      const wasWaiting = phase === 'wait';
      const previousWait = phase === 'wait' ? frame : 0;
      frame += frames;
      if (phase === 'enter' && frame >= animation('IN_02').frames) {
        frame -= animation('IN_02').frames;
        phase = 'wait';
      }
      if (phase === 'wait' && frame >= minimumFrames && isReady()) {
        // A worker that completes late begins its exit now; elapsed waiting
        // must never skip the exit animation.
        frame = wasWaiting && previousWait >= minimumFrames ? 0 : frame - minimumFrames;
        phase = 'exit';
      }
      if (phase === 'exit' && frame >= animation('OUT_02').frames) {
        frame = animation('OUT_02').frames;
        phase = 'done';
      }
    },
    presentation() {
      if (phase === 'done') return { layers: [], controls: [], locked: false };
      const clips = [
        clip('IN_02', 'Group_01', phase === 'enter' ? frame : animation('IN_02').frames),
      ];
      // The native queue clears request 8 on the completion update; its next
      // update starts the independent spinner without disturbing the panel.
      if (phase === 'wait') clips.push(clip('Wait', 'G_Wait', Math.max(0, frame - 1), true));
      if (phase === 'exit') clips.push(clip('OUT_02', 'Group_01', frame));
      const layout = poseLayout(source, clips);
      indexLayout(layout).panes.get('T_TimerMes_01').text = messageMap[170] ?? '';
      return {
        layers: [{ layout, prefix: 'sd-loading:' }],
        controls: [],
        locked: true,
      };
    },
    getState() {
      return { phase, frame };
    },
  };
}
