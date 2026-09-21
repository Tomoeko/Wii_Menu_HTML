import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSDMenu, SD_MENU_LAYOUTS, SD_VISITED_KEY } from '../src/sd-menu.js';
import { createDisplay } from '../src/display.js';
import { indexLayout } from '../src/animation.js';
import { Renderer } from '../src/renderer.js';
import { createSceneFader } from '../src/scene-fader.js';
const manifestPath = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : null;
const layouts = Object.fromEntries(
  (manifest ? SD_MENU_LAYOUTS : []).map((key) => [
    key,
    JSON.parse(
      fs.readFileSync(new URL('../public/assets/' + manifest.layouts[key].url, import.meta.url)),
    ),
  ]),
);
const sourceTest = {
  skip: !manifest && 'Prepare a local menu WAD to test its original resources.',
};
test('SD menu renders its native twelve empty slots, footer and twenty-page counter', sourceTest, () => {
  const menu = createSDMenu(layouts),
    view = menu.presentation();
  assert.equal(view.pageCount, 20);
  assert.equal(view.layers.filter((layer) => layer.prefix.startsWith('sd-empty-0-')).length, 12);
  assert.deepEqual(
    view.controls.map((control) => control.id),
    ['back', 'help', 'next'],
  );
  assert.equal(
    indexLayout(view.layers.find((layer) => layer.prefix === 'sd-page-1:').layout).panes.get(
      'TextBox_00',
    ).text,
    '1',
  );
});
test('SD pages run the original twenty-frame scroll and reveal the previous arrow', sourceTest, () => {
  const sounds = [],
    menu = createSDMenu(layouts, { onSound: (s) => sounds.push(s) });
  assert.equal(menu.activate('prev'), false);
  assert.equal(menu.activate('next'), true);
  menu.advance(10);
  const grid = menu.presentation().layers.find((layer) => layer.prefix === 'sd-grid:').layout;
  assert.equal(indexLayout(grid).panes.get('N_ChAll').translation[0], -256);
  assert.equal(menu.presentation().locked, true);
  menu.advance(10);
  assert.equal(menu.getState().page, 1);
  assert.equal(menu.presentation().locked, false);
  assert.equal(
    menu.presentation().controls.some((item) => item.id === 'prev'),
    true,
  );
  assert.deepEqual(sounds, ['page']);
  for (let page = 2; page < 20; page++) {
    menu.activate('next');
    menu.advance(20);
  }
  assert.equal(menu.getState().page, 19);
  assert.equal(menu.activate('next'), false);
});
test('SD Wii Menu requests the global fade immediately and locks repeated actions', sourceTest, () => {
  const navigations = [],
    menu = createSDMenu(layouts, { onNavigate: (to) => navigations.push(to) });
  assert.equal(menu.activate('back'), true);
  assert.deepEqual(navigations, ['grid']);
  assert.equal(menu.presentation().locked, true);
  assert.equal(menu.activate('next'), false);
  menu.open();
  menu.advance(49);
  assert.equal(menu.presentation().locked, false);
});
test('widescreen SD grid installs original donor textures without mutating imported layouts', sourceTest, () => {
  const original = structuredClone(layouts.mn_SdcardMenu_a);
  const menu = createSDMenu(layouts, { display: createDisplay() });
  const grid = menu.presentation().layers.find((layer) => layer.prefix === 'sd-grid:').layout,
    panes = indexLayout(grid).panes;
  assert.deepEqual(
    grid.materials[panes.get('Picture_00').material].textureMaps[0],
    grid.materials[panes.get('ChangeTex16x9').material].textureMaps[0],
  );
  assert.deepEqual(layouts.mn_SdcardMenu_a, original);
});
test('SD background precedes tiles and returning preserves the remembered page', sourceTest, () => {
  const menu = createSDMenu(layouts);
  menu.activate('next');
  menu.advance(20);
  menu.activate('back');
  menu.open();
  const view = menu.presentation();
  assert.equal(view.page, 1);
  assert.equal(view.layers[0].prefix, 'sd-background:');
  assert.ok(view.layers.find((layer) => layer.prefix === 'sd-footer:').exclude.has('background'));
  const tiles = view.layers.filter((layer) => layer.prefix.startsWith('sd-empty-0-'));
  assert.deepEqual(tiles[0].layout.root, tiles[1].layout.root);
});
test('SD Help uses original page dialog and back closes it before leaving SD', sourceTest, () => {
  const sounds = [],
    navigations = [],
    menu = createSDMenu(layouts, {
      onSound: (s) => sounds.push(s),
      onNavigate: (s) => navigations.push(s),
    });
  menu.activate('help');
  assert.deepEqual(sounds, ['confirm', 'infoWindow']);
  assert.deepEqual(
    menu.presentation().controls.map((x) => x.id),
    ['help-back', 'help-next'],
  );
  assert.equal(menu.back(), false);
  menu.advance(25);
  assert.equal(menu.back(), true);
  menu.advance(42);
  assert.equal(menu.presentation().controls[0].id, 'back');
  assert.deepEqual(navigations, []);
  assert.equal(menu.back(), true);
  assert.deepEqual(navigations, ['grid']);
});
test('first SD welcome waits for scene advance and persists only after its four pages close', sourceTest, () => {
  const saved = new Map(),
    storage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const readableStates = [];
  const menu = createSDMenu(layouts, { storage, onStateChange: (state) => readableStates.push(state) });
  menu.open();
  assert.equal(
    menu.presentation().layers.some((layer) => layer.prefix === 'sd-help:'),
    false,
  );
  menu.advance(1);
  assert.equal(menu.presentation().controls.length, 1);
  menu.advance(25);
  for (let page = 1; page <= 3; page++) {
    menu.activate('help-next');
    menu.advance(41);
  }
  assert.equal(saved.has(SD_VISITED_KEY), false);
  menu.activate('help-next');
  menu.advance(42);
  assert.equal(saved.get(SD_VISITED_KEY), 'true');
  assert.deepEqual(readableStates, [{ page: 0, helpSeen: true }]);
  const next = createSDMenu(layouts, { storage });
  next.open();
  next.advance(30);
  assert.equal(
    next.presentation().layers.some((layer) => layer.prefix === 'sd-help:'),
    false,
  );
});

function renderedArrow(menu, side = 'R') {
  const footer = menu.presentation().layers.find((layer) => layer.prefix === 'sd-footer:').layout;
  const renderer = Object.create(Renderer.prototype);
  renderer.display = createDisplay();
  renderer.bounds = new Map();
  const drawn = new Map();
  renderer.window = () => {};
  renderer.quad = (layout, pane, _matrix, alpha) => {
    const material = layout.materials[pane.material];
    drawn.set(pane.name, alpha * material.colors[1][3]);
  };
  renderer.draw(footer);
  return {
    bubble: drawn.get(`ArwBtn${side}`) ?? 0,
    pressed: drawn.get(`ArwBtn${side}_Ac`) ?? 0,
    hit: renderer.rect(`B_Arw${side}`),
  };
}

test('SD arrow bubble stays effectively visible during click/scroll until pointer departure', sourceTest, () => {
  const sounds = [];
  const menu = createSDMenu(layouts, { firstVisit: false, onSound: (id) => sounds.push(id) });
  menu.open();
  menu.advance(49);
  menu.hover('next');
  menu.advance(8);
  const hovered = renderedArrow(menu);
  assert.equal(hovered.bubble, 255);
  assert.equal(menu.activate('next'), true);
  menu.advance(3);
  assert.ok(renderedArrow(menu).pressed > 0);
  for (const frames of [7, 10, 1000]) {
    menu.hover('next');
    menu.advance(frames);
    const arrow = renderedArrow(menu);
    assert.equal(arrow.bubble, 255, 'ancestors, pane and material keep the bubble visible');
    assert.deepEqual(
      [arrow.hit.w, arrow.hit.h],
      [hovered.hit.w, hovered.hit.h],
      'the expanded vicinity does not collapse while the idle arrow continues moving',
    );
  }
  assert.deepEqual(sounds, ['buttonHover', 'page'], 'polling hover must not replay its sound');
  menu.hover(null);
  menu.advance(12);
  assert.equal(renderedArrow(menu).bubble, 0);
  assert.ok(renderedArrow(menu).hit.w < hovered.hit.w);
});

test('SD arrows retire at page bounds and an actual departure during scroll is respected', sourceTest, () => {
  const menu = createSDMenu(layouts, { firstVisit: false });
  menu.open();
  menu.advance(49);
  menu.hover('next');
  menu.advance(8);
  menu.activate('next');
  menu.hover(null);
  menu.advance(100);
  assert.equal(renderedArrow(menu).bubble, 0);
  for (let page = 2; page <= 19; page++) {
    menu.hover('next');
    menu.activate('next');
    menu.advance(20);
  }
  menu.advance(12);
  menu.hover('next');
  assert.equal(renderedArrow(menu).bubble, 0);
  assert.equal(
    menu.presentation().controls.some((control) => control.id === 'next'),
    false,
  );
  menu.hover('prev');
  menu.advance(8);
  assert.equal(renderedArrow(menu, 'L').bubble, 255);
});

test('SD loading blocks input and starts after welcome closes on the first visit', sourceTest, () => {
  const menu = createSDMenu(layouts, { firstVisit: true });
  menu.open();
  menu.advance(1);
  assert.equal(menu.getState().loading, null);
  menu.advance(25);
  for (let page = 0; page < 4; page++) {
    menu.activate('help-next');
    menu.advance(42);
  }
  assert.equal(menu.getState().loading.phase, 'enter');
  assert.equal(menu.presentation().controls.length, 0);
  assert.equal(menu.activate('next'), false);
  assert.equal(menu.back(), false);
  menu.advance(49);
  assert.equal(menu.getState().loading, null);
  assert.equal(menu.presentation().locked, false);
  assert.equal(menu.activate('next'), true);
});

test('repeat SD entry advances its loading animation beneath the global fade-in', sourceTest, () => {
  const fader = createSceneFader();
  const menu = createSDMenu(layouts, { firstVisit: false });
  let scene = 'grid';
  fader.start(() => {
    scene = 'sd';
    menu.open();
  });
  const update = () => {
    if (scene === 'sd' && (!fader.active || fader.revealing))
      menu.advance(1, { revealing: fader.revealing });
    fader.advance(1);
  };
  for (let i = 0; i < 23; i++) update();
  assert.deepEqual(menu.getState().loading, { phase: 'enter', frame: 0 });
  for (let i = 0; i < 22; i++) update();
  assert.equal(fader.active, false);
  assert.deepEqual(menu.getState().loading, { phase: 'enter', frame: 22 });
  for (let i = 0; i < 11; i++) update();
  assert.deepEqual(menu.getState().loading, { phase: 'exit', frame: 0 });
  for (let i = 0; i < 16; i++) update();
  assert.equal(menu.getState().loading, null);
  assert.equal(menu.presentation().locked, false);
});

test('SD page is saved only after completed scrolling and restored in a fresh controller', sourceTest, () => {
  const saved = [];
  const menu = createSDMenu(layouts, {
    state: { page: 18, helpSeen: true },
    onStateChange: (state) => saved.push(state),
  });
  menu.open();
  menu.advance(49);
  menu.activate('next');
  menu.advance(19);
  assert.deepEqual(saved, []);
  menu.advance(1);
  assert.deepEqual(saved, [{ page: 19, helpSeen: true }]);
  const restored = createSDMenu(layouts, { state: saved[0] });
  restored.open();
  restored.advance(49);
  assert.equal(restored.getState().page, 19);
  assert.deepEqual(restored.presentation().controls.map(({ id }) => id), ['back', 'help', 'prev']);
  assert.equal(restored.activate('next'), false);
  assert.equal(restored.activate('prev'), true);
});

test('populated SD slots retain sparse page mappings, authored hit panes and focus after loading', sourceTest, () => {
  const channels = Array(240).fill(null);
  for (const slot of [0, 13, 239]) channels[slot] = {
    id: `synthetic-${slot}`, title: `Synthetic ${slot}`, icon: layouts.mn_SdcardMenu_d,
  };
  const original = JSON.stringify(channels);
  const actions = [];
  const menu = createSDMenu(layouts, {
    channels, state: { page: 0, helpSeen: true }, onAction: (...args) => actions.push(args),
  });
  menu.open();
  menu.advance(108);
  assert.equal(menu.presentation().locked, true);
  menu.advance(1);
  assert.equal(menu.presentation().locked, false);
  assert.equal(menu.getState().channelCount, 3);
  assert.equal(menu.presentation().layers.filter(({ prefix }) => prefix === 'sd-channel-0-0:').length, 1);
  const control = menu.presentation().controls.find(({ id }) => id === 'channel-0');
  assert.equal(control.pane, 'N_Ch_c01');
  assert.equal(control.prefix, 'sd-grid:');
  menu.hover('channel-0');
  menu.advance(8);
  assert.ok(menu.presentation().layers.some(({ prefix }) => prefix === 'sd-focus-0:'));
  assert.equal(menu.activate('channel-0'), true);
  assert.deepEqual(actions, [['sd-channel-selected', { id: 'synthetic-0', changed: false, fixture: true }]]);
  assert.equal(menu.activate('channel-1'), false);
  menu.activate('next');
  menu.advance(20);
  assert.deepEqual(menu.presentation().controls.filter(({ id }) => id.startsWith('channel-'))
    .map(({ id, label }) => ({ id, label })), [{ id: 'channel-1', label: 'Synthetic 13' }]);
  assert.equal(menu.activate('channel-1'), true);
  assert.equal(actions[1][1].id, 'synthetic-13');
  const last = createSDMenu(layouts, { channels, state: { page: 19, helpSeen: true } });
  assert.equal(last.presentation().controls.find(({ id }) => id === 'channel-11').label, 'Synthetic 239');
  assert.equal(JSON.stringify(channels), original);
});

test('SD absent, unreadable and unsupported fixtures expose original messages and a working exit', sourceTest, () => {
  for (const [mediaStatus, messageId] of [['absent', 169], ['read-error', 195], ['unsupported', 171]]) {
    const exited = [];
    const menu = createSDMenu(layouts, {
      mediaStatus, state: { page: 8, helpSeen: true },
      channels: [{ id: 'synthetic', title: 'Hidden while unavailable', icon: layouts.mn_SdcardMenu_d }],
      messages: { [messageId]: `Original resource ${messageId}` },
      onNavigate: (target) => exited.push(target),
    });
    menu.open();
    menu.advance(49);
    const view = menu.presentation();
    const error = view.layers.find(({ prefix }) => prefix === 'sd-error:');
    assert.equal(indexLayout(error.layout).panes.get('T_TimerMes').text, `Original resource ${messageId}`);
    assert.equal(menu.getState().channelCount, 0);
    assert.deepEqual(view.controls.map(({ id }) => id), ['back', 'help']);
    assert.equal(menu.activate('next'), false);
    assert.equal(menu.activate('channel-0'), false);
    assert.equal(menu.back(), true);
    assert.deepEqual(exited, ['grid']);
  }
});
