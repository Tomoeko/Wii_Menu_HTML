import { indexLayout, poseLayout } from './animation.js';
import { standardDisplay } from './display.js';

// ChannelObj::{setBalloonText,calcBalloon,setBalloonAnim,calcBalloonAnim}.
export function createChannelBalloon(
  source,
  measure,
  { onAppear = () => {}, display = standardDisplay } = {},
) {
  const animation = source.animations.my_IplTopBalloon_a_BalloonInOut;
  const textPane = indexLayout(source).panes.get('T_Balloon');
  let selected = null;
  const balloons = new Map();
  return {
    target(index) {
      if (selected === index) return;
      const old = balloons.get(selected);
      if (old) {
        if (old.phase === 'wait') balloons.delete(selected);
        else old.leaving = true;
      }
      selected = index;
      if (index !== null) {
        const existing = balloons.get(index);
        if (existing) existing.leaving = false;
        else balloons.set(index, { phase: 'wait', frame: 0, leaving: false });
      }
    },
    advance(frames) {
      for (const [index, item] of balloons) {
        item.frame += frames;
        if (item.phase === 'wait' && item.frame >= 20) {
          item.phase = 'enter';
          item.frame -= 20;
          onAppear(index);
        }
        if (item.phase === 'enter' && item.frame >= animation.frames) {
          item.phase = 'hold';
          item.frame = animation.frames;
        }
        if (item.phase === 'hold' && item.leaving) {
          item.phase = 'leave';
          item.frame = 0;
        }
        if (item.phase === 'leave' && item.frame >= animation.frames) {
          balloons.delete(index);
          if (selected === index) balloons.set(index, { phase: 'wait', frame: 0, leaving: false });
        }
      }
    },
    poses(channels) {
      const result = [];
      for (const [index, item] of balloons) {
        if (item.phase === 'wait' || !channels[index]) continue;
        let title = channels[index].title;
        while (measure(title, textPane) > 390.32 && title.length > 3)
          title = title.replace(/\.{3}$/, '').slice(0, -1) + '...';
        const width = Math.max(160 * display.rootScaleX, measure(title, textPane) + 40);
        const frame = item.phase === 'leave' ? animation.frames - item.frame : item.frame;
        const layout = poseLayout(source, [{ animation, frame, loop: false }]);
        const panes = indexLayout(layout).panes;
        panes.get('W_Base').size[0] = width;
        panes.get('W_Shade').size[0] = width;
        const x = (-192 + (index % 4) * 128) * display.rootScaleX;
        const y = 145 - Math.floor((index % 12) / 4) * 96;
        const margin = display.halfWidth - 60;
        layout.root.translation = [
          Math.max(-margin + width / 2, Math.min(margin - width / 2, x)),
          y - 70,
          0,
        ];
        result.push({ layout, title });
      }
      return result;
    },
    clear() {
      selected = null;
      balloons.clear();
    },
  };
}
