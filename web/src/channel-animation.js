import { indexLayout, poseLayout } from './animation.js';
import { poseImageAnimations } from './channel-artwork.js';

// These schedules are transcribed from the local channels' RCHE scripts. See
// tools/assets/CHANNEL_SCRIPTS.md for source members, offsets, and branch choices.
// They use the no-save-data/no-WiiConnect24 branches, as the browser has no NAND.
const seatHolders = new Set(['HADE', 'HAJE', 'HAPE', 'HATE', 'HCLE']);
const languageCodes = { JPN: 'J', ENG: 'E', GER: 'G', FRA: 'F', SPA: 'Sp', ITA: 'I', NED: 'N' };
const animationAt = (layout, name) =>
  Object.entries(layout.animations || {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
const maximum = (animation) => Math.max(0, animation.frames - (animation.loop ? 0 : 1));

/** FrameController::calc permits a first pass below min before looping to min. */
export function channelFrame(elapsed, { min = 0, max, initial = min, speed = 1, loop = false }) {
  let frame = initial + Math.max(0, elapsed) * speed;
  if (loop && max > min && frame >= max) frame = min + ((frame - max) % (max - min));
  return loop ? frame : Math.min(frame, max);
}

function clip(layout, name, frame, options = {}) {
  const animation = animationAt(layout, name);
  if (!animation) return null;
  const controller = {
    min: 0,
    initial: options.min ?? 0,
    speed: 1,
    max: maximum(animation),
    loop: animation.loop,
    ...options,
  };
  const sampled = channelFrame(frame, controller);
  // Scripts may extend a controller beyond the final BRLAN key, which holds
  // its last value. Disable poseLayout's implicit clamp/wrap after scheduling.
  const index = /_Rso(\d+)$/i.exec(name)?.[1],
    group = index === undefined ? undefined : `Rso${index}`;
  return {
    name,
    controller,
    animation: { ...animation, frames: Math.max(animation.frames, sampled), loop: false },
    frame: sampled,
    group: group && Object.hasOwn(layout.groups || {}, group) ? group : undefined,
    recursive: false,
  };
}

function baseClips(layout, kind, frame) {
  if (kind === 'icon') {
    for (const name of ['icon_Start', 'icon', 'icon_Whole']) {
      if (animationAt(layout, name)) return [clip(layout, name, frame)];
    }
    return [];
  }
  const start = animationAt(layout, 'banner_Start'),
    loop = animationAt(layout, 'banner_Loop');
  if (start) {
    const end = maximum(start);
    // Start keeps its final values for properties absent from the loop track.
    return [
      clip(layout, 'banner_Start', Math.min(frame, end), { loop: false }),
      ...(loop && frame >= end ? [clip(layout, 'banner_Loop', frame - end, { loop: true })] : []),
    ];
  }
  if (loop) return [clip(layout, 'banner_Loop', frame, { loop: true })];
  return animationAt(layout, 'banner') ? [clip(layout, 'banner', frame, { loop: true })] : [];
}

/** Source schedules, exposed separately so controller timing can be verified. */
export function channelClips(channel, kind, frame, options = {}) {
  const layout = channel[kind];
  if (!layout) return [];
  const clips = baseClips(layout, kind, options.baseFrame ?? frame),
    id = channel.shortId;
  const rso = (index, elapsed = frame, settings = {}) =>
    clips.push(clip(layout, `${kind}_Rso${index}`, elapsed, settings));
  if (id === 'HAYA') {
    // Photo banner restart preserves its initial 0, then repeats from frame 40.
    rso(0, frame, kind === 'banner' ? { min: 40, initial: 0 } : {});
  } else if (id === 'HAFE') {
    rso(0);
    if (kind === 'icon') rso(1, 0);
  } else if (id === 'HAGE') {
    if (kind === 'icon') {
      rso(1, 0);
      rso(2, 0);
    } else {
      const animation = animationAt(layout, 'banner_Rso0');
      if (animation) rso(0, frame, { min: maximum(animation) - 1, initial: 0, loop: true });
    }
  } else if (id === 'HABA' && kind === 'icon') {
    for (let i = 0; i < 16; i++) rso(i, i === 0 ? frame : 0, i === 0 ? { max: 630 } : {});
  } else if (seatHolders.has(id)) {
    if (kind === 'icon') {
      const length = 30 + 200 + 60 + 180,
        speed = 1024 / (30 + 200 + 60);
      rso(0, frame, { min: 1, max: length + 1, initial: 180, loop: true });
      rso(1, frame, { max: length, initial: length + 60, loop: true });
      rso(2, frame, { max: length, initial: length - 230, loop: true });
      rso(3, frame, { max: length * speed, initial: length * speed, speed, loop: true });
    } else {
      rso(0, frame, { max: 40, loop: false });
      rso(2, frame, { min: 40, max: 190, initial: 0, loop: true });
      // The default script hides the telop's entire N_base_00 branch. When a
      // source-font measurement is available, retain even its hidden motion.
      const pane = indexLayout(layout).panes.get(
        `T_telop${languageCodes[options.language || 'ENG'] || 'E'}_00`,
      );
      if (pane && options.measureText) {
        const duration = Math.max(
          0,
          Math.ceil((options.measureText(pane.text, pane, layout) + 608) / (6262 / 5660)),
        );
        rso(1, frame, { max: duration + 40, initial: duration, loop: true });
      }
    }
  } else if (id === 'HCGE') {
    const min = options.networkConfigured ? 1 : 1000;
    rso(0, frame, kind === 'icon' ? { min, initial: min, loop: true } : { loop: false });
  }
  return clips.filter(Boolean);
}

/** Pose a loaded original icon/banner using the channel's own startup script. */
export function poseChannel(channel, kind, elapsedFrames, options = {}) {
  const source = channel[kind];
  if (!source) return null;
  const layout = poseLayout(source, channelClips(channel, kind, elapsedFrames, options));
  poseImageAnimations(layout, elapsedFrames);
  const { panes } = indexLayout(layout),
    code = languageCodes[options.language || 'ENG'] || 'E';
  const visible = (name, value) => {
    const pane = panes.get(name);
    if (pane) pane.flags = value ? pane.flags | 1 : pane.flags & ~1;
  };
  const languages = (prefix) => {
    for (const language of Object.values(languageCodes))
      for (const suffix of ['00', '01'])
        visible(`${prefix}${language}_${suffix}`, language === code);
  };
  if (channel.shortId === 'HABA' && kind === 'icon') {
    visible('N_SuperParent', true);
    for (const language of ['J', 'E', 'G', 'F', 'S', 'I', 'N'])
      for (const suffix of ['00', '01'])
        visible(`P_title_${language}_${suffix}`, language === (code === 'Sp' ? 'S' : code));
  }
  if (channel.shortId === 'HABA' && kind === 'banner') {
    // Original banner CS setRegionPanes (0x39): English branch 0x9a shows
    // font_e before beginRender. These are localized textures, not font text.
    const selected = (code === 'Sp' ? 'S' : code).toLowerCase();
    for (const language of ['j', 'e', 'g', 'f', 's', 'i', 'n'])
      visible(`font_${language}`, language === selected);
  }
  if (channel.shortId === 'HAFE' && kind === 'icon') visible('code', false);
  if (channel.shortId === 'HAFE' && kind === 'banner') {
    visible('all', true);
    visible('weather', false);
    visible('textB0', true);
    for (let i = 0; i < 3; i++) visible(`textT${i}`, i === 0);
  }
  if (channel.shortId === 'HAGE') {
    if (kind === 'icon') {
      const pane = panes.get('send_id');
      if (pane) pane.text = '';
    } else for (let i = 0; i < 4; i++) visible(`textT${i}`, i === 0);
  }
  if (seatHolders.has(channel.shortId)) {
    visible('N_base_00', false);
    languages('P_logo');
    if (kind === 'icon') {
      visible('P_BG_00', true);
      visible('P_BG_01', true);
    } else {
      languages('T_title');
      languages('T_telop');
      for (const language of Object.values(languageCodes)) {
        visible(`N_message${language}_00`, language === code);
        for (const suffix of ['00', '01'])
          visible(`T_message${language}_${suffix}`, language === code && suffix === '00');
      }
      for (const name of ['N_title_00', 'N_logoU_00', 'N_logoU_01', 'N_logoD_00', 'N_logoD_01'])
        visible(name, true);
      const pane = panes.get(`T_message${code}_00`),
        window = panes.get('W_messWindow_00');
      if (pane && window) {
        if (options.measureText) {
          const width = Math.max(
            ...pane.text.split('\n').map((line) => options.measureText(line, pane, layout)),
          );
          if (width > pane.size[0] - 3) {
            const ratio = (pane.size[0] / width) * 0.99;
            pane.fontSize[0] *= ratio;
            pane.charSpace *= ratio;
          }
        }
        window.size[1] = Math.max(100, 140 - (6 - pane.text.split('\n').length) * 20);
      }
    }
  }
  if (channel.shortId === 'HCGE' && kind === 'icon') {
    visible('fade', !!options.networkConfigured);
    visible('txt_3', !!options.networkConfigured);
    for (const name of [
      'bg170_96',
      'color',
      'wii',
      'txt_green',
      'txt_purple',
      'txt_yellow',
      'txt_orange',
    ])
      visible(name, true);
    if (code === 'E') {
      const labels = {
        txt_green: ['Get more\nchannels', 20],
        txt_purple: ['Get new\nsoftware', 20],
        txt_yellow: ['Get 100s\nof classic\ngames', 20],
        txt_orange: ['Play with\nfriends near\nand far', 18],
        txt_3: ['You can delete\nthis channel after\nwatching the video.', 12],
      };
      for (const [name, [text, width]] of Object.entries(labels)) {
        const pane = panes.get(name);
        if (pane) {
          pane.text = text;
          pane.fontSize = [width, 20];
        }
      }
    }
  }
  return layout;
}
