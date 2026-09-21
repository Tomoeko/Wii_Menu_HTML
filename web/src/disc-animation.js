import { poseLayout } from './animation.js';
import { channelFrame } from './channel-animation.js';

/** The native empty banner is both the Disc layout and active channel layout.
 * ChannelTitle::calcCommon (4.3U 0x813B4D10) advances that same object twice. */
export function poseEmptyDiscBanner(layout, updates) {
  const animation = layout.animations.my_DiskCh_a_Start;
  const frame = channelFrame(updates, {
    max: Math.max(0, animation.frames - 1),
    speed: 2,
  });
  return poseLayout(layout, [{ animation, frame, loop: false }]);
}
