import { indexLayout, poseLayout } from './animation.js';

// Clock pane bindings and animation curves come from the supplied WAD resources.
// The numeral panes above the screen are resource donors, not visible controls.
export function createClock(source, { region = 'USA', showIntro = true } = {}) {
  const original = indexLayout(source).panes;
  const textureFor = (name) => {
    const pane = original.get(name);
    return source.materials[pane.material].textureMaps[0].texture;
  };
  const numeralTextures = Array.from({ length: 10 }, (_, i) => textureFor(`Num${i}`));
  const amTexture = textureFor('AM'),
    pmTexture = textureFor('PM');
  const only = (name, targets) => {
    const animation = source.animations[name];
    return (
      animation && {
        ...animation,
        targets: animation.targets.filter((target) => targets.includes(target.name)),
      }
    );
  };
  const change = only('my_Clock_a_Change', ['T_WiiMenu', 'N_Clock']);
  const blink = only('my_Clock_a_Min', ['ClockTen']);
  let changeStart = showIntro ? null : -Infinity;

  return {
    pose(date, elapsedFrames = 0) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime()))
        throw new TypeError('Clock requires a valid Date');
      // Original startup holds "Wii Menu" for three seconds, then waits for an odd second.
      if (changeStart === null && elapsedFrames >= 180 && date.getSeconds() % 2)
        changeStart = elapsedFrames;
      const clips = [
        {
          animation: change,
          frame:
            changeStart === null ? 0 : Math.min(change?.frames || 0, elapsedFrames - changeStart),
        },
      ];
      if (changeStart !== null) {
        const phase = ((date.getSeconds() % 2) + date.getMilliseconds() / 1000) * 60;
        clips.push({ animation: blink, frame: Math.min(phase, blink?.frames || 0) });
      }
      const result = poseLayout(source, clips);
      const panes = indexLayout(result).panes;
      const visible = (name, show) => {
        const pane = panes.get(name);
        pane.flags = show ? pane.flags | 1 : pane.flags & ~1;
      };
      const setTexture = (name, texture) => {
        result.materials[panes.get(name).material].textureMaps[0].texture = texture;
      };
      let hour = date.getHours();
      if (region !== 'EUR' && region !== 'CHN') {
        hour %= 12;
        if ((region === 'USA' || region === 'KOR') && hour === 0) hour = 12;
      }
      const minute = date.getMinutes();
      for (const [name, value] of [
        ['Clock0', minute % 10],
        ['Clock1', Math.floor(minute / 10)],
        ['Clock2', hour % 10],
        ['Clock3', Math.floor(hour / 10)],
      ]) {
        setTexture(name, numeralTextures[value]);
      }
      setTexture('AM_PM', date.getHours() >= 12 ? pmTexture : amTexture);
      setTexture('AM_PM_R', date.getHours() >= 12 ? pmTexture : amTexture);
      visible('Clock3', Math.floor(hour / 10) !== 0);
      visible('AM_PM', region === 'JPN' || region === 'KOR');
      visible('AM_PM_R', region === 'USA');
      panes.get('T_WiiMenu').text = 'Wii Menu';
      // clock::draw renders only this subtree, at the caller's N_Clock1 matrix.
      result.root = panes.get('N_WiiMenu');
      return result;
    },
  };
}
