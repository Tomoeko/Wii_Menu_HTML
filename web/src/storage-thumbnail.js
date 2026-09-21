import { indexLayout, poseLayout } from './animation.js';
import { channelFrame } from './channel-animation.js';

const languageGroups = new Set(['JPN', 'ENG', 'GER', 'FRA', 'SPA', 'ITA', 'NED', 'CHN', 'KOR']);
const usaFallback = ['ENG', 'FRA', 'SPA'];
const languageBases = new WeakMap();

function normalizedLanguage(language) {
  // The supplied USA driver's language table at 0x8164E300 maps CHT to ENG.
  return languageGroups.has(language) ? language : 'ENG';
}

function languageBase(source, language) {
  let variants = languageBases.get(source);
  if (!variants) {
    variants = new Map();
    languageBases.set(source, variants);
  }
  if (variants.has(language)) return variants.get(language);

  const base = poseLayout(source);
  const { panes } = indexLayout(base);
  const groups = base.groups ?? {};
  const setGroupVisible = (name, visible) => {
    for (const member of groups[name] ?? []) {
      const pane = panes.get(member);
      if (pane) pane.flags = visible ? pane.flags | 1 : pane.flags & ~1;
    }
  };
  for (const name of Object.keys(groups)) {
    // ChannelObj::setLangPane (0x813B24C0) exempts Rso0–Rso15 using
    // strncmp(..., 5); the two-digit names therefore match five-byte prefixes.
    if (name !== language && !/^Rso(?:[0-9]$|1[0-5])/.test(name)) {
      setGroupVisible(name, false);
    }
  }
  const selected = Object.hasOwn(groups, language)
    ? language
    : usaFallback.find((name) => Object.hasOwn(groups, name));
  if (selected) setGroupVisible(selected, true);
  variants.set(language, base);
  return base;
}

/** Original Data Management thumbnail pose; imported channel resources stay immutable. */
export function poseStorageThumbnail(channel, frame, { language = 'ENG' } = {}) {
  const source = channel?.icon;
  if (!source) return null;
  const base = languageBase(source, normalizedLanguage(language));
  // Thumbnail::create (0x813AA23C) selects exactly these two archive members.
  // It never starts icon_Start, RSO clips, or the HOME Menu's channel scripts.
  const animation = source.animations?.icon ?? source.animations?.icon_Whole;
  if (!animation) return poseLayout(base);
  const sampled = channelFrame(frame, {
    min: 0,
    max: Math.max(0, animation.frames - (animation.loop ? 0 : 1)),
    loop: animation.loop,
  });
  return poseLayout(base, [{ animation, frame: sampled, loop: false }]);
}
