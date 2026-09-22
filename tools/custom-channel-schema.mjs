// A deliberately small, declarative subset of the exported BRLYT/BRLAN schema.
// It uses the existing renderer without executing channel programs or scripts.
const own = Object.hasOwn;
const paneTypes = ['pan1', 'pic1', 'txt1'];
const trackLimits = { RLPA: 9, RLVI: 0, RLVC: 16, RLMC: 31, RLTS: 4, RLTP: 0 };

function fail(label, description) {
  throw new Error(`${label}: ${description}`);
}

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label, 'expected object');
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(label, `unsupported field ${key}`);
  }
  return value;
}

function number(value, label, min = -32768, max = 32768, integer = false) {
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    fail(label, `expected ${integer ? 'integer' : 'number'} from ${min} to ${max}`);
  }
}

function string(value, label, max = 128) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    fail(label, `expected nonempty string of at most ${max} characters`);
  }
}

function list(value, label, max = 128) {
  if (!Array.isArray(value) || value.length > max) fail(label, `expected array of at most ${max}`);
  return value;
}

function vector(value, length, label, min, max) {
  if (!Array.isArray(value) || value.length !== length) fail(label, `expected ${length} numbers`);
  value.forEach((component) => number(component, label, min, max));
}

function colors(value, count, label, signed = false) {
  if (!Array.isArray(value) || value.length !== count) fail(label, `expected ${count} RGBA colors`);
  value.forEach((color) => vector(color, 4, label, signed ? -1024 : 0, signed ? 1023 : 255));
}

export function relativeResource(value, label = 'Resource') {
  string(value, label, 240);
  if (
    !/^[A-Za-z0-9_./-]+$/.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    fail(label, 'use a relative package path with no parent traversal');
  }
  return value;
}

export function validateChannelManifest(value) {
  object(value, 'channel.json', [
    'schemaVersion',
    'id',
    'title',
    'iconLayout',
    'bannerLayout',
    'audio',
  ]);
  if (value.schemaVersion !== 1) fail('channel.json', 'schemaVersion must be 1');
  if (!/^custom-[a-z0-9][a-z0-9_-]{0,55}$/.test(value.id)) {
    fail('id', 'use custom- followed by a lowercase slug, up to 63 characters total');
  }
  string(value.title, 'title', 80);
  for (const key of ['iconLayout', 'bannerLayout']) {
    relativeResource(value[key], key);
    if (!value[key].endsWith('.json')) fail(key, 'expected .json');
  }
  if (value.audio !== undefined) {
    object(value.audio, 'audio', ['src', 'loop', 'loopStart', 'loopEnd']);
    relativeResource(value.audio.src, 'audio.src');
    if (!value.audio.src.endsWith('.wav')) fail('audio.src', 'expected PCM .wav');
    if (value.audio.loop !== undefined && typeof value.audio.loop !== 'boolean') {
      fail('audio.loop', 'expected boolean');
    }
    for (const key of ['loopStart', 'loopEnd']) {
      if (own(value.audio, key)) number(value.audio[key], `audio.${key}`, 0, 3600);
    }
    if (value.audio.loopEnd !== undefined && value.audio.loopEnd <= (value.audio.loopStart ?? 0)) {
      fail('audio.loopEnd', 'must be after loopStart');
    }
  }
  return structuredClone(value);
}

export function validateChannelLayout(value, kind) {
  object(value, kind, [
    'width',
    'height',
    'originType',
    'name',
    'textures',
    'fonts',
    'materials',
    'groups',
    'root',
    'animations',
    'artwork',
    'imageAnimations',
  ]);
  number(value.width, `${kind}.width`, 1, 4096);
  number(value.height, `${kind}.height`, 1, 4096);
  number(value.originType, `${kind}.originType`, 0, 1, true);
  string(value.name, `${kind}.name`);
  const textureNames = new Set();
  list(value.textures, 'textures', 256).forEach((texture) => {
    object(texture, 'texture', ['name', 'url', 'width', 'height']);
    string(texture.name, 'texture.name');
    if (textureNames.has(texture.name)) fail('textures', `duplicate ${texture.name}`);
    textureNames.add(texture.name);
    relativeResource(texture.url, 'texture.url');
    if (!/\.(?:png|jpg|jpeg|gif|svg)$/i.test(texture.url))
      fail('texture.url', 'expected PNG, JPEG, GIF, or SVG');
    number(texture.width, 'texture.width', 1, 4096, true);
    number(texture.height, 'texture.height', 1, 4096, true);
  });
  list(value.fonts, 'fonts', 16).forEach((font) => string(font, 'font'));
  const materialNames = new Set();
  list(value.materials, 'materials', 64).forEach((material) => {
    object(material, 'material', [
      'name',
      'colors',
      'konstColors',
      'materialColor',
      'channelControl',
      'textureMaps',
      'textureSRTs',
      'texCoordGens',
    ]);
    string(material.name, 'material.name');
    if (materialNames.has(material.name)) fail('materials', `duplicate ${material.name}`);
    materialNames.add(material.name);
    colors(material.colors, 3, 'material.colors', true);
    if (material.konstColors) colors(material.konstColors, 4, 'material.konstColors');
    if (material.materialColor) vector(material.materialColor, 4, 'materialColor', 0, 255);
    if (material.channelControl) vector(material.channelControl, 2, 'channelControl', 0, 1);
    list(material.textureMaps ?? [], 'textureMaps', 1).forEach((map) => {
      object(map, 'textureMap', ['texture', 'wrapS', 'wrapT']);
      number(map.texture, 'texture index', 0, value.textures.length - 1, true);
      number(map.wrapS, 'wrapS', 0, 2, true);
      number(map.wrapT, 'wrapT', 0, 2, true);
    });
    list(material.textureSRTs ?? [], 'textureSRTs', 1).forEach((srt) => {
      object(srt, 'textureSRT', ['translate', 'rotation', 'scale']);
      vector(srt.translate, 2, 'texture translate');
      number(srt.rotation, 'texture rotation');
      vector(srt.scale, 2, 'texture scale', -128, 128);
    });
    list(material.texCoordGens ?? [], 'texCoordGens', 1).forEach((generator) => {
      object(generator, 'texCoordGen', ['type', 'source', 'matrix']);
      number(generator.type, 'generator.type', 1, 1, true);
      number(generator.source, 'generator.source', 4, 4, true);
      number(generator.matrix, 'generator.matrix', 30, 60, true);
    });
  });
  const panes = new Map();
  function pane(current, depth = 0) {
    if (depth > 16 || panes.size >= 128) fail('panes', 'limit is 128 panes and 16 levels');
    object(current, 'pane', [
      'name',
      'type',
      'flags',
      'origin',
      'alpha',
      'translation',
      'rotation',
      'scale',
      'size',
      'children',
      'material',
      'vertexColors',
      'texCoords',
      'text',
      'font',
      'fontSize',
      'textPosition',
      'textColors',
      'charSpace',
      'lineSpace',
    ]);
    string(current.name, 'pane.name');
    if (panes.has(current.name)) fail('pane', `duplicate ${current.name}`);
    panes.set(current.name, current);
    if (!paneTypes.includes(current.type)) fail(current.name, `expected ${paneTypes.join('/')}`);
    number(current.flags, 'pane.flags', 0, 7, true);
    number(current.origin, 'pane.origin', 0, 8, true);
    number(current.alpha, 'pane.alpha', 0, 255);
    vector(current.translation, 3, 'pane.translation');
    vector(current.rotation, 3, 'pane.rotation');
    vector(current.scale, 2, 'pane.scale', -128, 128);
    vector(current.size, 2, 'pane.size', 0, 8192);
    if (current.type !== 'pan1') {
      number(current.material, 'pane.material', 0, value.materials.length - 1, true);
    }
    if (current.type === 'pic1') {
      colors(current.vertexColors, 4, 'vertexColors');
      list(current.texCoords, 'texCoords', 1).forEach((coordinates) => {
        if (list(coordinates, 'texture coordinates', 4).length !== 4) {
          fail('texCoords', 'expected four UV pairs');
        }
        coordinates.forEach((uv) => vector(uv, 2, 'UV'));
      });
    }
    if (current.type === 'txt1') {
      if (typeof current.text !== 'string' || current.text.length > 2000) {
        fail('pane.text', 'expected text up to 2000 characters');
      }
      number(current.font, 'pane.font', 0, value.fonts.length - 1, true);
      vector(current.fontSize, 2, 'fontSize', 1, 256);
      number(current.textPosition, 'textPosition', 0, 8, true);
      colors(current.textColors, 2, 'textColors');
      for (const key of ['charSpace', 'lineSpace']) {
        if (own(current, key)) number(current[key], key, -256, 256);
      }
    }
    list(current.children, 'children').forEach((child) => pane(child, depth + 1));
  }
  pane(value.root);
  if (!value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups)) {
    fail('groups', 'expected object');
  }
  for (const [name, members] of Object.entries(value.groups)) {
    string(name, 'group name');
    list(members, name).forEach((member) => {
      if (!panes.has(member)) fail(name, `unknown pane ${member}`);
    });
  }
  if (value.artwork !== undefined) {
    object(value.artwork, 'artwork', ['kind', 'width', 'height']);
    if (value.artwork.kind !== kind) fail('artwork.kind', 'must match the layout kind');
    number(value.artwork.width, 'artwork.width', 1, 4096, true);
    number(value.artwork.height, 'artwork.height', 1, 4096, true);
    for (const name of ['Artwork', 'ArtworkBorder', 'Background']) {
      if (!panes.has(name)) fail('artwork', `missing ${name} pane`);
    }
  }
  list(value.imageAnimations ?? [], 'imageAnimations', 128).forEach((animation) => {
    object(animation, 'image animation', ['texture', 'frames', 'repetitions']);
    number(animation.texture, 'image animation texture', 0, value.textures.length - 1, true);
    number(animation.repetitions, 'image repetitions', 0, 65536, true);
    const frames = list(animation.frames, 'image frames', 128);
    if (!frames.length) fail('image frames', 'at least one frame is required');
    frames.forEach((frame) => {
      object(frame, 'image frame', ['texture', 'durationMs']);
      number(frame.texture, 'image frame texture', 0, value.textures.length - 1, true);
      number(frame.durationMs, 'image frame duration', 1, 655350);
    });
  });
  const allowedAnimations =
    kind === 'icon'
      ? ['icon', 'icon_Start', 'icon_Whole']
      : ['banner', 'banner_Start', 'banner_Loop'];
  object(value.animations, 'animations', allowedAnimations);
  let keyCount = 0;
  for (const [name, animation] of Object.entries(value.animations)) {
    object(animation, name, ['frames', 'loop', 'targets', 'textures']);
    number(animation.frames, `${name}.frames`, 1, 216000, true);
    if (typeof animation.loop !== 'boolean') fail(name, 'loop must be boolean');
    list(animation.textures ?? [], 'animation textures').forEach((texture) => {
      if (!textureNames.has(texture)) fail(name, `unknown texture ${texture}`);
    });
    list(animation.targets, 'targets', 256).forEach((target) => {
      object(target, 'target', ['name', 'type', 'tracks']);
      number(target.type, 'target.type', 0, 1, true);
      const found = target.type === 1 ? materialNames.has(target.name) : panes.has(target.name);
      if (!found) fail(name, `unknown target ${target.name}`);
      list(target.tracks, 'tracks', 64).forEach((track) => {
        object(track, 'track', ['kind', 'id', 'target', 'curveType', 'keys']);
        if (!own(trackLimits, track.kind)) fail(name, `unsupported track ${track.kind}`);
        if (['RLMC', 'RLTS', 'RLTP'].includes(track.kind) !== (target.type === 1)) {
          fail(name, 'track kind does not match pane/material target');
        }
        number(track.id, 'track.id', 0, 0, true);
        number(track.target, 'track.target', 0, trackLimits[track.kind], true);
        number(track.curveType, 'curveType', 1, 2, true);
        const material =
          target.type === 1 ? value.materials.find((entry) => entry.name === target.name) : null;
        if (track.kind === 'RLTS' && !material.textureSRTs?.[track.id]) {
          fail(name, 'texture transform track needs the corresponding material textureSRT');
        }
        if (track.kind === 'RLTP' && !material.textureMaps?.[track.id]) {
          fail(name, 'texture pattern track needs the corresponding material textureMap');
        }
        let previous = -Infinity;
        const keys = list(track.keys, 'keys', 2000);
        if (!keys.length) fail(name, 'track needs at least one key');
        keyCount += keys.length;
        if (keyCount > 10000) fail(name, 'layout exceeds 10000 animation keys');
        keys.forEach((key) => {
          object(key, 'key', ['frame', 'value', 'slope']);
          number(key.frame, 'key.frame', 0, animation.frames);
          number(key.value, 'key.value');
          if (own(key, 'slope')) number(key.slope, 'key.slope');
          if (key.frame <= previous) fail(name, 'key frames must increase');
          previous = key.frame;
          if (track.kind === 'RLVI') number(key.value, 'visibility key', 0, 1, true);
          if (track.kind === 'RLTP') {
            number(key.value, 'texture key', 0, (animation.textures?.length ?? 0) - 1, true);
            if (track.curveType !== 1) fail(name, 'texture patterns need step interpolation');
          }
        });
      });
    });
  }
  return structuredClone(value);
}
