import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  createStorageScene,
  isManageableChannel,
  STORAGE_PAGE_TRANSITION_UPDATES,
  STORAGE_LAYOUTS,
} from '../src/channel-management.js';
import { indexLayout, poseLayout } from '../src/animation.js';
import { createDisplay } from '../src/display.js';
import { paneForDisplay } from '../src/display.js';
import { sourceAnchorMatrices } from '../src/channel-zoom.js';
import { Renderer } from '../src/renderer.js';
import { renderedArrow } from './helpers/rendered-arrow.js';
import { defaultStorageFixture } from '../src/storage-state.js';
const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && STORAGE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      STORAGE_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
      ]),
    )
  : {};

test('native Channels excludes system titles while retaining downloadable and authored titles', () => {
  const icon = {};
  for (const id of ['0001000148414445', '0001000148434745', 'custom-example']) {
    assert.equal(isManageableChannel({ id, icon }), true, id);
  }
  for (const id of ['disc', '0001000248414341', '0001000248414241', '0001000161626364']) {
    assert.equal(isManageableChannel({ id, icon }), false, id);
  }
  assert.equal(isManageableChannel({ id: 'custom-without-icon' }), false);
});

test('Wii storage follows title enumeration independently of menu order and keeps IMET title lines', {
  skip: !available,
}, () => {
  const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
  const channels = [
    { id: 'custom-first', title: 'Authored channel', icon },
    { id: '0001000148434c45', title: 'Netflix', icon },
    { id: '0001000148414445', title: 'First second', icon,
      titleLines: { ENG: ['First', 'second'] } },
  ];
  const before = channels.map(({ id }) => id);
  const scene = createStorageScene(layouts, { kind: 'channels', channels, sdChannels: channels });
  scene.advance(100);
  const labels = () => scene.presentation().controls
    .filter(({ id }) => id.startsWith('storage-channel-')).map(({ label }) => label);
  assert.deepEqual(labels(), ['First second', 'Netflix', 'Authored channel']);
  assert.deepEqual(channels.map(({ id }) => id), before, 'HOME Menu order is not mutated');
  scene.activate('storage-channel-0');
  scene.advance(100);
  const detail = indexLayout(scene.presentation().layers
    .find(({ prefix }) => prefix === 'storage-detail:').layout).panes;
  assert.equal(detail.get('T_Title_00').text, 'First');
  assert.equal(detail.get('T_Title_01').text, 'second');
  scene.back();
  scene.advance(100);
  scene.activate('storage-sd');
  scene.advance(100);
  assert.deepEqual(labels(), ['Authored channel', 'Netflix', 'First second'],
    'SD membership retains its separate fixture enumeration');
});

test('Wii and SD capacity uses declared free blocks and the original localized prefix and suffix', {
  skip: !available,
}, () => {
  const capacity = (scene) => {
    const base = scene.presentation().layers.find(({ prefix }) => prefix === 'scene-storage:');
    const panes = indexLayout(base.layout).panes;
    return { text: panes.get('T_Capa_00').text,
      visible: Boolean((panes.get('N_Capa_00').flags & 1) && (panes.get('T_Capa_00').flags & 1)) };
  };
  for (const kind of ['wii', 'channels']) {
    const storageFixture = { ...defaultStorageFixture(), freeBlocks: { wii: 0, sd: 1007 } };
    const scene = createStorageScene(layouts, { kind, storageFixture });
    scene.advance(100);
    assert.deepEqual(capacity(scene), { text: 'Blocks Open: 0', visible: true });
    scene.activate('storage-sd');
    scene.advance(100);
    assert.deepEqual(capacity(scene), { text: 'Blocks Open: 1007', visible: true });
    scene.activate('storage-wii');
    scene.advance(100);
    assert.deepEqual(capacity(scene), { text: 'Blocks Open: 0', visible: true });
    for (const status of ['absent', 'read-error', 'unsupported']) {
      const fixture = structuredClone(storageFixture);
      fixture.sd.status = fixture.sdSaves.status = status;
      const unavailable = createStorageScene(layouts, {
        kind, storageFixture: fixture, initialTab: 'sd',
      });
      unavailable.advance(100);
      assert.equal(capacity(unavailable).visible, false, `${kind} ${status} cannot show capacity`);
    }
    for (const initialTab of ['wii', 'sd']) {
      const compatible = createStorageScene(layouts, { kind, initialTab });
      compatible.advance(100);
      assert.deepEqual(capacity(compatible), { text: 'Blocks Open: 905', visible: true });
      const override = createStorageScene(layouts, { kind, initialTab, virtualBlocks: 321 });
      override.advance(100);
      assert.equal(capacity(override).text, 'Blocks Open: 321');
    }
    const localized = createStorageScene(layouts, {
      kind, storageFixture, initialTab: 'sd', messages: { 156: '', 242: ' blokken vrij' },
    });
    localized.advance(100);
    assert.equal(capacity(localized).text, '1007 blokken vrij');
  }
});

test('Channels redraws focused page bubbles above every cell and below the detail dialog', {
  skip: !available,
}, () => {
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    const source = layouts.it_ObjChannelEdit_b;
    const animation = source.animations.it_ObjChannelEdit_b_SaveDataIn;
    const icon = poseLayout(source, [{ animation, frame: animation.frames - 1, loop: false }]);
    icon.groups = {};
    icon.animations = {};
    const channels = Array.from({ length: 17 }, (_, index) => ({
      id: `custom-arrow-${index}`,
      title: `Arrow fixture ${index}`,
      icon,
    }));
    const scene = createStorageScene(layouts, { kind: 'channels', display, channels });
    scene.advance(100);
    for (const [direction, side] of [['next', 'R'], ['prev', 'L']]) {
      scene.hover(`storage-${direction}`);
      scene.advance(12);
      const view = scene.presentation();
      const overlay = view.layers.find((layer) => layer.prefix === 'storage-arrows:');
      assert.ok(renderedArrow(overlay.layout, side).bubble > 0, `${aspect} ${side} bubble`);
      const renderer = Object.create(Renderer.prototype);
      renderer.display = display;
      renderer.bounds = new Map();
      const draws = [];
      for (const layer of view.layers) {
        renderer.quad = (_layout, pane) => draws.push({ prefix: layer.prefix, name: pane.name });
        renderer.window = renderer.quad;
        renderer.draw(layer.layout, layer);
      }
      const lastGridDraw = draws.findLastIndex(({ prefix }) =>
        /^storage-(box|channel|cover)-/.test(prefix));
      const bubbleDraw = draws.findIndex(({ prefix, name }) =>
        prefix === 'storage-arrows:' && name === `ArwBtn${side}`);
      assert.ok(bubbleDraw > lastGridDraw, `${aspect} ${side}: bubble overlays the whole grid`);
      assert.equal(new Set(draws.filter(({ prefix }) => prefix.startsWith('storage-box-'))
        .map(({ prefix }) => prefix)).size, 15, 'empty cells participate in the draw-order check');
      assert.ok(draws.some(({ prefix }) => prefix.startsWith('storage-channel-')));
      assert.ok(draws.some(({ prefix }) => prefix.startsWith('storage-cover-')));
      assert.deepEqual(renderer.rect(`storage-arrows:B_Arw${side}`),
        renderer.rect(`scene-storage:B_Arw${side}`), 'redraw preserves source hit geometry');
      const control = view.controls.find(({ id }) => id === `storage-${direction}`);
      assert.ok(renderer.rect(control.prefix + control.pane), 'control targets the final arrow pass');
      assert.equal(indexLayout(overlay.layout).panes.has('N_DataAll'), false,
        'the redraw cannot cover the grid with another background pass');
      if (direction === 'next') {
        scene.activate('storage-next');
        scene.advance(100);
      }
    }
    scene.activate('storage-channel-0');
    scene.advance(100);
    let layers = scene.presentation().layers;
    assert.ok(layers.findIndex(({ prefix }) => prefix === 'storage-detail:')
      > layers.findIndex(({ prefix }) => prefix === 'storage-arrows:'));
    scene.activate('storage-erase');
    scene.advance(100);
    layers = scene.presentation().layers;
    assert.ok(layers.findIndex(({ prefix }) => prefix === 'storage-dialog:')
      > layers.findIndex(({ prefix }) => prefix === 'storage-arrows:'));
  }
});

test('all storage page changes retain arrow focus and accept departure while activation is locked', {
  skip: !available,
}, () => {
  const scenarios = ['channels', 'wii', 'gamecube'].flatMap((kind) =>
    ['4:3', '16:9'].map((aspect) => ({ kind, aspect })),
  );
  for (const { kind, aspect } of scenarios) {
    for (const direction of ['next', 'prev']) {
      const sounds = [];
      const channels = Array.from({ length: 61 }, (_, index) => ({
        id: `page-focus-${index}`, title: `Page focus ${index}`,
        icon: { ...layouts.it_ObjChannelEdit_b, animations: {} },
      }));
      const records = channels.map(({ id, title }) => ({ id, title, blocks: 1 }));
      const storageFixture = defaultStorageFixture();
      storageFixture.wiiSaves.records = records;
      storageFixture.gamecube.a.records = records;
      const scene = createStorageScene(layouts, {
        kind, display: createDisplay(aspect), channels, storageFixture,
        onSound: (name) => sounds.push(name),
      });
      scene.advance(100);
      for (let page = 0; page < 2; page++) {
        scene.activate('storage-next');
        scene.advance(100);
      }
      const id = `storage-${direction}`;
      const side = direction === 'next' ? 'R' : 'L';
      const arrow = () => renderedArrow(scene.presentation().layers.find(
        ({ prefix }) => prefix === (kind === 'channels' ? 'storage-arrows:' : 'scene-storage:'),
      ).layout, side);
      scene.hover(id);
      scene.advance(15);
      const focused = arrow().bubble;
      assert.ok(focused > 0);
      sounds.length = 0;
      assert.equal(scene.activate(id), true);
      for (let update = 0; update <= 47; update++) {
        assert.equal(arrow().bubble, focused, `${kind} ${aspect} ${direction} update ${update}`);
        scene.hover(id);
        if (scene.snapshot().locked) {
          assert.equal(scene.activate(id), false, 'focus does not unlock another page action');
        }
        scene.advance(1);
      }
      assert.deepEqual(sounds, ['WSD_SELECT'], 'stationary paging cannot replay the hover cue');
      assert.equal(scene.hover(null), true);
      scene.advance(15);
      assert.equal(arrow().bubble, 0, 'real departure completes the original FocusOff');
      assert.equal(scene.hover(id), true);
      scene.advance(15);
      sounds.length = 0;
      assert.equal(scene.activate(id), true);
      assert.equal(scene.hover(null), true, 'departure is accepted during page-out');
      scene.advance(8);
      assert.equal(arrow().bubble, 0);
      assert.equal(scene.snapshot().phase, 'page-out');
      scene.advance(STORAGE_PAGE_TRANSITION_UPDATES - 8);
      assert.equal(scene.snapshot().locked, false,
        'the complete page change fits the Home Menu twenty-update budget');
      scene.advance(100);
      assert.deepEqual(sounds, ['WSD_SELECT']);
      assert.equal(scene.presentation().controls.some((control) => control.id === id), false);
      assert.equal(arrow().bubble, 0, 'a page boundary retires its unavailable arrow');
      assert.equal(scene.hover(id), false);

      scene.activate(direction === 'next' ? 'storage-prev' : 'storage-next');
      scene.advance(100);
      scene.hover(id);
      scene.advance(15);
      sounds.length = 0;
      scene.activate(id);
      scene.advance(9);
      assert.equal(scene.snapshot().phase, 'boxes-in');
      assert.equal(scene.presentation().controls.some((control) => control.id === id), false);
      assert.equal(arrow().bubble, 0, 'an unavailable arrow also retires a stationary pointer');
      scene.advance(STORAGE_PAGE_TRANSITION_UPDATES - 9);
      assert.equal(scene.hover(id), false);
      assert.deepEqual(sounds, ['WSD_SELECT']);
    }
  }
});

test('channel icon centers, clipping and border follow their own cell in both aspects', {
  skip: !available,
}, () => {
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
    const channels = Array.from({ length: 15 }, (_, index) => ({
      id: `custom-cell-${index}`,
      title: `Cell ${index}`,
      icon,
    }));
    const scene = createStorageScene(layouts, { kind: 'channels', display, channels });
    scene.advance(100);
    scene.hover('storage-channel-7');
    scene.advance(15);
    const layers = scene.presentation().layers;
    for (let index = 0; index < channels.length; index++) {
      const box = layers.find((layer) => layer.prefix === `storage-box-${index}:`);
      const thumbnail = layers.find((layer) => layer.prefix === `storage-channel-${index}:`);
      const cover = layers.find((layer) => layer.prefix === `storage-cover-${index}:`);
      const anchor = sourceAnchorMatrices(box.layout, ['N_All'], {
        mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
      })[0].matrix;
      assert.equal(thumbnail.matrix[4], anchor[4], `${aspect} cell ${index} X`);
      assert.equal(thumbnail.matrix[5], anchor[5], `${aspect} cell ${index} Y`);
      assert.equal(thumbnail.clip.x + thumbnail.clip.w / 2, display.halfWidth + anchor[4]);
      assert.equal(thumbnail.clip.y + thumbnail.clip.h / 2, display.halfHeight - anchor[5]);
      const drawable = [...indexLayout(cover.layout).panes.values()]
        .filter((pane) => pane.material !== undefined && (pane.flags & 1));
      assert.deepEqual(drawable.map((pane) => pane.name), [
        display.wide ? 'DataBaseCover_01' : 'DataBaseCover_00',
      ]);
      assert.ok(layers.indexOf(cover) > layers.indexOf(thumbnail));
    }
  }
});

test('Channels detail uses its original dialog, aspect panes and independent thumbnail draw order', {
  skip: !available,
}, () => {
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
    const channel = { id: 'custom-detail', title: 'Internet Channel', blocks: 28, icon };
    const scene = createStorageScene(layouts, { kind: 'channels', display, channels: [channel] });
    scene.advance(100);
    assert.equal(scene.activate('storage-channel-0'), true);
    scene.advance(15);
    assert.ok(!scene.presentation().layers.some((layer) => layer.prefix === 'storage-detail-thumbnail:'));
    scene.advance(1);
    let layers = scene.presentation().layers;
    let detail = layers.find((layer) => layer.prefix === 'storage-detail:');
    const thumbnail = layers.find((layer) => layer.prefix === 'storage-detail-thumbnail:');
    const mask = layers.find((layer) => layer.prefix === 'storage-detail-mask:');
    assert.equal(detail.layout.name, 'mn_ChannelDetail_a');
    const panes = indexLayout(detail.layout).panes;
    const selectedMask = display.wide ? 'N_Mask16x9' : 'N_Mask4x3';
    const otherMask = display.wide ? 'N_Mask4x3' : 'N_Mask16x9';
    assert.ok(panes.get(selectedMask).flags & 1);
    assert.equal(panes.get(otherMask).flags & 1, 0);
    assert.equal(panes.get(display.wide ? 'T_Title_02' : 'T_Title_00').text, 'Internet Channel');
    assert.equal(panes.get(display.wide ? 'T_Title_03' : 'T_Title_01').text, '');
    assert.equal(panes.get(display.wide ? 'T_Block_02' : 'T_Block_00').text, '28');
    const anchor = panes.get(display.wide ? 'N_Atari16x9' : 'N_Atari4x3');
    assert.deepEqual(thumbnail.matrix, [1, 0, 0, 1, ...anchor.translation.slice(0, 2)]);
    assert.equal(thumbnail.clip.w, display.wide ? 170 : 128);
    assert.equal(thumbnail.clip.h, 96);
    assert.ok(layers.indexOf(thumbnail) > layers.indexOf(detail));
    assert.ok(layers.indexOf(mask) > layers.indexOf(thumbnail));
    assert.ok(indexLayout(mask.layout).panes.has(selectedMask));
    assert.ok(!indexLayout(mask.layout).panes.has(otherMask));
    assert.ok(!indexLayout(mask.layout).panes.has('N_Select'));
    scene.advance(20);
    assert.equal(scene.snapshot().locked, false);
    assert.equal(scene.snapshot().page, 'detail');
    assert.deepEqual(scene.presentation().controls.map((control) => control.id), [
      'storage-move', 'storage-copy', 'storage-erase', 'back',
    ]);
    scene.back();
    scene.advance(layouts.it_Button_a.animations.it_Button_a_BtnFlash.frames);
    assert.equal(scene.snapshot().phase, 'detail-out');
    layers = scene.presentation().layers;
    assert.ok(!layers.some((layer) => layer.prefix === 'storage-detail-thumbnail:'));
  }
});

test('Channels entry retains native delayed window matrices and the independent Back caption queue', {
  skip: !available,
}, () => {
  const pristine = JSON.stringify(layouts);
  const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
  // Measured native white-panel centers in the retained 836x456 frames
  // 23013, 23016, 23017, 23019 and 23020. Texture edge filtering permits
  // two pixels around the analytical window center.
  const nativeCenters = new Map([[7, 263], [10, 329.5], [11, 351], [13, 395], [14, 416.5]]);
  const nativeBackAlpha = [1, 1, .97241, .89606, .78798, .65182, .50629,
    .35764, .21901, .10786, .0287, 0, 0, .0287, .10786, .21901,
    .35764, .50629, .65182, .78798, .89606, .97241, 1];
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    const scene = createStorageScene(layouts, {
      kind: 'channels', display, channels: [{ id: 'timing', title: 'Timing', icon }],
      messages: { 252: 'Detail return', 315: 'Grid return' },
    });
    scene.advance(100);
    scene.activate('storage-channel-0');
    let initialTranslation;
    for (let frame = 0; frame <= 22; frame++) {
      const layers = scene.presentation().layers;
      const detail = layers.find(({ prefix }) => prefix === 'storage-detail:').layout;
      const window = indexLayout(detail).panes.get('N_Window');
      const back = indexLayout(layers.find(({ prefix }) => prefix === 'storage-back:').layout).panes;
      initialTranslation ??= window.translation;
      assert.equal(window.alpha, frame === 0 ? 0 : 255);
      if (frame <= 2) assert.deepEqual(window.translation, initialTranslation);
      if (frame === 12) assert.notEqual(window.translation[0], 0, 'scale and movement use separate clocks');
      if (frame === 14) assert.equal(Math.abs(window.translation[0]), 0);
      if (display.wide && nativeCenters.has(frame)) {
        const matrix = sourceAnchorMatrices(detail, ['N_Window'], {
          mapPane: (pane, root) => paneForDisplay(pane, display, { root }),
        })[0].matrix;
        const nativeRasterX = (display.halfWidth + matrix[4]) * 836 / display.width;
        assert.ok(Math.abs(nativeRasterX - nativeCenters.get(frame)) < 2, `native center at ${frame}`);
      }
      assert.ok(Math.abs(back.get('N_Button_00').alpha / 255 - nativeBackAlpha[frame]) < .008,
        `native Back alpha at ${frame}`);
      assert.equal(back.get('T_Button_00').text, frame < 12 ? 'Grid return' : 'Detail return');
      assert.equal(layers.filter(({ prefix }) => prefix === 'storage-channel-0:').length, 1);
      scene.advance(1);
    }
    scene.advance(13);
    assert.equal(scene.back(), true);
    scene.advance(19);
    assert.equal(scene.snapshot().phase, 'detail-out');
    scene.advance(11);
    assert.equal(scene.snapshot().page, 'grid');
    assert.equal(scene.presentation().controls.find(({ id }) => id === 'back').disabled, true);
    assert.equal(scene.back(), false, 'native common button is still changing captions');
    const back = indexLayout(scene.presentation().layers.find(
      ({ prefix }) => prefix === 'storage-back:',
    ).layout).panes;
    assert.equal(back.get('N_Button_00').alpha, 0);
    assert.equal(back.get('T_Button_00').text, 'Grid return');
    scene.advance(10);
    assert.equal(scene.presentation().controls.find(({ id }) => id === 'back').disabled, false);
  }
  assert.equal(JSON.stringify(layouts), pristine);
});

test('Channels Back replaces the thumbnail with the first calculated SeenOut cover without a hole', {
  skip: !available,
}, () => {
  const pristine = JSON.stringify(layouts);
  const source = layouts.mn_ChannelDetail_a;
  const outgoing = source.animations.mn_ChannelDetail_a_SeenOut;
  assert.equal(outgoing.frames, 11);
  const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
  const channels = Array.from({ length: 6 }, (_, index) => ({
    id: `departure-${index}`, title: `Channel ${index}`, icon,
  }));
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    const scene = createStorageScene(layouts, { kind: 'channels', display, channels });
    const detailLayer = () => scene.presentation().layers.find(
      ({ prefix }) => prefix === 'storage-detail:',
    );
    scene.advance(100);
    scene.activate('storage-channel-0');
    scene.advance(100);
    const settledDetail = detailLayer().layout;
    const coverName = display.wide ? 'Cover_16x9' : 'Cover_4x3';
    const sourcePanes = (frame) => indexLayout(poseLayout(settledDetail, [{
      animation: outgoing, group: 'G_Mask', frame, loop: false,
    }])).panes;
    assert.equal(sourcePanes(0).get(coverName).alpha, 0,
      'reset pose would expose the underlying grid if drawn after thumbnail deletion');
    assert.equal(sourcePanes(1).get(coverName).alpha, 255);
    scene.back();
    scene.advance(layouts.it_Button_a.animations.it_Button_a_BtnFlash.frames - 1);
    assert.ok(scene.presentation().layers.some(
      ({ prefix }) => prefix === 'storage-detail-thumbnail:',
    ), 'the thumbnail belongs to the complete Back press');
    scene.advance(1);
    const backPanes = () => indexLayout(scene.presentation().layers.find(
      ({ prefix }) => prefix === 'storage-back:',
    ).layout).panes;
    const outgoingBack = layouts.it_Button_a.animations.it_Button_a_AlphOut;
    for (let frame = 1; frame < outgoing.frames - 1; frame += 1) {
      assert.equal(scene.snapshot().phase, 'detail-out');
      const view = scene.presentation();
      const actual = indexLayout(detailLayer().layout).panes;
      const expected = sourcePanes(frame);
      assert.equal(actual.get(coverName).alpha, 255, `${aspect} cover at ${frame}`);
      assert.deepEqual(actual.get('N_Window').scale, expected.get('N_Window').scale);
      assert.equal(actual.get('N_Window').alpha, expected.get('N_Window').alpha);
      const expectedBack = indexLayout(poseLayout(layouts.it_Button_a, [{
        animation: outgoingBack, group: 'G_FocusBtnA', frame: frame - 1, loop: false,
      }])).panes;
      assert.equal(backPanes().get('N_Button_00').alpha, expectedBack.get('N_Button_00').alpha,
        'Hide advances on the first update after the completed Back press');
      const cover = actual.get(coverName);
      assert.deepEqual(detailLayer().layout.materials[cover.material], source.materials[cover.material],
        'the gray cover uses its unchanged original material');
      if (frame === 1) {
        const renderer = Object.create(Renderer.prototype);
        renderer.display = display;
        renderer.bounds = new Map();
        const draws = [];
        renderer.quad = (_layout, pane, _matrix, alpha) => draws.push({ name: pane.name, alpha });
        renderer.window = renderer.quad;
        renderer.draw(detailLayer().layout);
        assert.ok(draws.some(({ name, alpha }) => name === coverName && alpha > 0),
          'the first drawable departure includes the original cover primitive');
      }
      assert.ok(!view.layers.some(({ prefix }) => prefix === 'storage-detail-thumbnail:'));
      assert.equal(view.layers.filter(({ prefix }) => /^storage-channel-\d+:$/.test(prefix)).length, 6);
      scene.advance(1);
    }
    assert.equal(sourcePanes(10).get('N_Window').alpha, 0);
    assert.equal(scene.snapshot().page, 'grid', 'the native parent observes completion at frame 10');
    assert.equal(detailLayer(), undefined);
    assert.equal(scene.presentation().controls.find(({ id }) => id === 'back').disabled, true,
      'the independently queued Back caption remains locked after detail completion');
    scene.advance(1);
    assert.equal(backPanes().get('N_Button_00').alpha, 0, 'Hide reaches its original endpoint');
    scene.advance(1);
    assert.equal(backPanes().get('N_Button_00').alpha, 0, 'SetText retains the hidden pose');
    scene.advance(1);
    assert.ok(backPanes().get('N_Button_00').alpha > 0, 'Show begins on the following update');
    scene.advance(9);
    assert.equal(scene.presentation().controls.find(({ id }) => id === 'back').disabled, false);
  }
  assert.equal(JSON.stringify(layouts), pristine);
});

test('grid icons survive detail and operation transitions but obey their own box entry and exit', {
  skip: !available,
}, () => {
  const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
  const channels = Array.from({ length: 6 }, (_, index) => ({
    id: `custom-lifetime-${index}`, title: `Channel ${index}`, blocks: 28, icon,
  }));
  const scene = createStorageScene(layouts, { kind: 'channels', channels });
  const count = () => scene.presentation().layers
    .filter((layer) => /^storage-channel-\d+:$/.test(layer.prefix)).length;
  scene.advance(42);
  assert.equal(scene.snapshot().phase, 'boxes-in');
  assert.equal(count(), 0);
  scene.advance(26);
  assert.equal(count(), 6);
  scene.activate('storage-channel-0');
  for (let frame = 0; frame < 36; frame += 1) {
    assert.equal(count(), 6, `detail entry ${frame}`);
    scene.advance(1);
  }
  scene.activate('storage-copy');
  for (let frame = 0; frame < 100; frame += 1) {
    assert.equal(count(), 6, `operation/dialog ${frame}`);
    scene.advance(1);
  }
  assert.equal(scene.snapshot().page, 'dialog');
  scene.activate('storage-no');
  scene.advance(200);
  assert.equal(scene.snapshot().page, 'detail');
  assert.equal(count(), 6);
  scene.back();
  for (let frame = 0; frame < 50; frame += 1) {
    assert.equal(count(), 6, `detail return ${frame}`);
    scene.advance(1);
  }
  assert.equal(scene.snapshot().page, 'grid');
  scene.activate('storage-sd');
  assert.equal(count(), 0);
});

test(
  'Wii storage and Channels enter Data, tabs and blocks in separate authored stages',
  { skip: !available },
  () => {
    for (const kind of ['wii', 'channels']) {
      const scene = createStorageScene(layouts, { kind });
      assert.equal(scene.snapshot().phase, 'data-in');
      scene.advance(26);
      assert.equal(scene.snapshot().phase, 'tabs-in');
      assert.equal(
        scene.presentation().layers.filter((layer) => layer.prefix.startsWith('storage-box'))
          .length,
        0,
      );
      scene.advance(16);
      assert.equal(scene.snapshot().phase, 'boxes-in');
      scene.advance(26);
      assert.equal(scene.snapshot().locked, false);
      const view = scene.presentation();
      assert.equal(
        view.layers.filter((layer) => layer.prefix.startsWith('storage-box')).length,
        15,
      );
      for (const control of view.controls)
        assert.ok(
          indexLayout(
            view.layers.find((layer) => layer.prefix === control.prefix).layout,
          ).panes.has(control.pane),
        );
      assert.equal(
        indexLayout(
          view.layers.find((layer) => layer.prefix === 'scene-storage:').layout,
        ).panes.get('N_ArwR').flags & 1,
        0,
      );
    }
  },
);
test(
  'Channels selects the authored aspect-specific outline and retains distinct anchors',
  { skip: !available },
  () => {
    for (const aspect of ['4:3', '16:9']) {
      const display = createDisplay(aspect),
        scene = createStorageScene(layouts, { kind: 'channels', display });
      scene.advance(68);
      const boxes = scene
        .presentation()
        .layers.filter((layer) => layer.prefix.startsWith('storage-box'));
      const first = indexLayout(boxes[0].layout).panes,
        last = indexLayout(boxes[14].layout).panes;
      assert.equal(first.get('N_Data16x9').flags & 1, display.wide ? 1 : 0);
      assert.equal(first.get('N_Data4x3').flags & 1, display.wide ? 0 : 1);
      assert.ok(first.get('N_All').translation[0] < last.get('N_All').translation[0]);
      assert.ok(first.get('N_All').translation[1] > last.get('N_All').translation[1]);
    }
  },
);
test(
  'dummy save supports native details and all three confirmation paths without changing storage',
  { skip: !available },
  () => {
    const actions = [],
      scene = createStorageScene(layouts, { onAction: (...args) => actions.push(args) });
    const original = JSON.stringify(layouts);
    scene.advance(68);
    assert.equal(scene.activate('storage-save'), true);
    scene.advance(35);
    assert.equal(scene.snapshot().locked, true);
    scene.advance(1);
    assert.equal(scene.snapshot().page, 'detail');
    for (const operation of ['move', 'copy', 'erase']) {
      assert.equal(scene.activate(`storage-${operation}`), true);
      scene.advance(19 + 46 + 26);
      assert.equal(scene.snapshot().page, 'dialog');
      assert.equal(scene.snapshot().locked, false);
      scene.activate('storage-yes');
      scene.advance(21 + 26 + 46);
      assert.equal(scene.snapshot().page, 'detail');
      assert.equal(scene.snapshot().locked, false);
    }
    assert.deepEqual(
      actions.map(([, payload]) => payload),
      ['move', 'copy', 'erase'].map((operation) => ({ operation, changed: false })),
    );
    scene.back();
    scene.advance(19 + 11);
    assert.equal(scene.snapshot().page, 'grid');
    assert.equal(scene.snapshot().dummyAvailable, true);
    assert.equal(JSON.stringify(layouts), original);
  },
);
test(
  'tab switch waits for selection then reintroduces boxes; dummy stays only on Wii',
  { skip: !available },
  () => {
    const scene = createStorageScene(layouts);
    scene.advance(68);
    scene.activate('storage-sd');
    scene.advance(21);
    assert.equal(scene.snapshot().selectedTab, 'wii');
    scene.advance(1);
    assert.equal(scene.snapshot().selectedTab, 'sd');
    assert.equal(scene.snapshot().locked, true);
    scene.advance(26);
    assert.equal(scene.snapshot().locked, false);
    assert.equal(scene.snapshot().dummyAvailable, false);
    assert.equal(scene.activate('storage-save'), false);
  },
);

test('save hover and rollout never change any empty block pose', { skip: !available }, () => {
  const scene = createStorageScene(layouts);
  scene.advance(68);
  const emptyBlocks = () =>
    scene
      .presentation()
      .layers.filter((layer) => /^storage-box-(?:[1-9]|1[0-4]):$/.test(layer.prefix))
      .map((layer) => layer.layout);
  const resting = emptyBlocks();
  for (let cycle = 0; cycle < 3; cycle++) {
    scene.hover('storage-save');
    scene.advance(20);
    assert.deepEqual(emptyBlocks(), resting);
    scene.hover(null);
    for (const frames of [1, 3, 20]) {
      scene.advance(frames);
      assert.deepEqual(emptyBlocks(), resting);
    }
  }
});

test(
  'every empty block owns a hover pose and native cue without selecting a save',
  { skip: !available },
  () => {
    for (const kind of ['wii', 'channels', 'gamecube']) {
      const sounds = [];
      const scene = createStorageScene(layouts, { kind, onSound: (name) => sounds.push(name) });
      scene.advance(68);
      const boxes = () =>
        scene.presentation().layers.filter((layer) => layer.prefix.startsWith('storage-box'));
      const original = boxes().map((layer) => layer.layout);
      assert.equal(scene.hover('storage-block-7'), true);
      scene.advance(8);
      const hovered = boxes().map((layer) => layer.layout);
      assert.notDeepEqual(hovered[7], original[7]);
      for (let i = 0; i < 15; i++) if (i !== 7) assert.deepEqual(hovered[i], original[i]);
      assert.deepEqual(sounds, ['WIPL_SE_BT_TARGETTING']);
      assert.equal(scene.activate('storage-block-7'), false);
      scene.hover(null);
      scene.advance(30);
      const resting = boxes().map((layer) => layer.layout);
      for (let i = 0; i < 15; i++) if (i !== 7) assert.deepEqual(resting[i], original[i]);
    }
  },
);

test(
  'tab destination uses the source opposite-named Flash and Slot B shows its absent-card message',
  { skip: !available },
  () => {
    const scene = createStorageScene(layouts, { kind: 'gamecube' });
    scene.advance(68);
    assert.equal(scene.hover('storage-wii'), false);
    assert.equal(scene.activate('storage-sd'), true);
    scene.advance(100);
    let view = scene.presentation();
    assert.equal(view.selectedTab, 'sd');
    assert.equal(
      view.controls.some((control) => control.id.startsWith('storage-block')),
      false,
    );
    let panes = indexLayout(
      view.layers.find((layer) => layer.prefix === 'scene-storage:').layout,
    ).panes;
    assert.equal(panes.get('T_Error_00').text, 'Nothing is inserted in Slot B.');
    assert.ok(panes.get('N_SelectSd_00').scale[0] > panes.get('N_SelectWii_00').scale[0]);
    scene.activate('storage-wii');
    scene.advance(100);
    view = scene.presentation();
    panes = indexLayout(
      view.layers.find((layer) => layer.prefix === 'scene-storage:').layout,
    ).panes;
    assert.equal(view.selectedTab, 'wii');
    assert.equal(
      view.controls.filter((control) => control.id.startsWith('storage-block')).length,
      15,
    );
    assert.ok(panes.get('N_SelectWii_00').scale[0] > panes.get('N_SelectSd_00').scale[0]);
  },
);

test(
  'dummy save title uses the original delayed balloon and disappears on activation',
  { skip: !available },
  () => {
    const sounds = [];
    const scene = createStorageScene(layouts, { onSound: (cue) => sounds.push(cue) });
    scene.advance(68);
    scene.hover('storage-save');
    scene.advance(16);
    assert.equal(
      scene.presentation().layers.some((layer) => layer.prefix === 'storage-balloon:'),
      false,
    );
    scene.advance(7);
    const balloon = scene
      .presentation()
      .layers.find((layer) => layer.prefix === 'storage-balloon:');
    assert.equal(indexLayout(balloon.layout).panes.get('T_Balloon').text, 'Dummy Save');
    assert.deepEqual(sounds, ['WIPL_SE_BT_TARGETTING', 'WIPL_SE_BALLOON']);
    scene.activate('storage-save');
    assert.equal(
      scene.presentation().layers.some((layer) => layer.prefix === 'storage-balloon:'),
      false,
    );
  },
);

test('rapid sweeps let every departed save block finish its rollout', { skip: !available }, () => {
  for (const kind of ['wii', 'channels', 'gamecube']) {
    const scene = createStorageScene(layouts, { kind });
    scene.advance(100);
    for (let index = 0; index < 15; index++) {
      scene.hover(index === 0 && kind === 'wii' ? 'storage-save' : `storage-block-${index}`);
      scene.advance(1);
    }
    scene.hover(null);
    scene.advance(30);
    for (const layer of scene.presentation().layers) {
      if (!layer.prefix.startsWith('storage-box-')) continue;
      const panes = indexLayout(layer.layout).panes;
      assert.deepEqual(panes.get('N_Data_01').scale, [1, 1], `${kind} ${layer.prefix}`);
    }
  }
});

test('a brief exit and re-entry do not restart an unfinished storage focus', { skip: !available }, () => {
  for (const kind of ['wii', 'channels', 'gamecube']) {
    const scene = createStorageScene(layouts, { kind });
    scene.advance(100);
    scene.hover('storage-block-7');
    scene.advance(3);
    const scale = () => indexLayout(scene.presentation().layers.find(
      (layer) => layer.prefix === 'storage-box-7:',
    ).layout).panes.get('N_Data_01').scale[0];
    const before = scale();
    scene.hover(null);
    assert.equal(scale(), before);
    scene.hover('storage-block-7');
    assert.equal(scale(), before);
    scene.advance(10);
    assert.ok(scale() > before);
    scene.hover(null);
    scene.advance(10);
    assert.equal(scale(), 1);
  }
});

test('unselected storage tabs roll back to their idle size on every medium and departure target',
  { skip: !available }, () => {
    const original = JSON.stringify(layouts);
    for (const kind of ['wii', 'channels', 'gamecube']) {
      for (const initialTab of ['wii', 'sd']) {
        const active = initialTab === 'wii' ? 'Wii' : 'Sd';
        const inactive = initialTab === 'wii' ? 'Sd' : 'Wii';
        const inactiveId = `storage-${initialTab === 'wii' ? 'sd' : 'wii'}`;
        for (const destination of [null, `storage-${initialTab}`, 'back']) {
          const scene = createStorageScene(layouts, { kind, initialTab });
          scene.advance(100);
          const scales = () => {
            const panes = indexLayout(scene.presentation().layers.find(
              (layer) => layer.prefix === 'scene-storage:',
            ).layout).panes;
            return [active, inactive].map((tab) => panes.get(`N_Select${tab}_00`).scale[0]);
          };
          const idle = scales();
          assert.ok(idle[0] > idle[1], `${kind} ${initialTab} has one selected tab`);
          scene.hover(inactiveId);
          scene.advance(7);
          assert.ok(scales()[1] > idle[1], `${kind} inactive tab responds to focus`);
          scene.hover(destination);
          scene.advance(3);
          assert.ok(scales()[1] > idle[1] && scales()[1] < idle[0],
            `${kind} tab shrinks during its authored rollout`);
          scene.advance(4);
          assert.deepEqual(scales(), idle, `${kind} ${initialTab} departure ${destination}`);
          assert.equal(scene.snapshot().selectedTab, initialTab);
        }
      }
    }
    assert.equal(JSON.stringify(layouts), original);
  });

test('brief tab hover queues its reverse rollout and switching cannot leave the old tab enlarged',
  { skip: !available }, () => {
    for (const kind of ['wii', 'channels', 'gamecube']) {
      const scene = createStorageScene(layouts, { kind });
      scene.advance(100);
      const scale = (tab) => indexLayout(scene.presentation().layers.find(
        (layer) => layer.prefix === 'scene-storage:',
      ).layout).panes.get(`N_Select${tab}_00`).scale[0];
      scene.hover('storage-sd');
      scene.advance(2);
      const entering = scale('Sd');
      scene.hover(null);
      assert.equal(scale('Sd'), entering, 'leaving preserves the in-flight entrance');
      scene.advance(5);
      assert.ok(scale('Sd') > entering);
      scene.advance(7);
      assert.equal(scale('Sd'), 1);
      scene.hover('storage-sd');
      scene.advance(3);
      scene.activate('storage-sd');
      scene.advance(100);
      assert.equal(scale('Wii'), 1, 'selection change supersedes old tab focus');
      assert.ok(scale('Sd') > 1);
      scene.hover('storage-wii');
      scene.advance(7);
      scene.hover(null);
      scene.advance(7);
      assert.equal(scale('Wii'), 1);
      assert.ok(scale('Sd') > 1);
    }
  });

test('channel block hit targets belong to the visible aspect branch on both tabs', { skip: !available }, () => {
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    const scene = createStorageScene(layouts, { kind: 'channels', display });
    scene.advance(100);
    for (const tab of ['wii', 'sd']) {
      if (tab === 'sd') {
        scene.activate('storage-sd');
        scene.advance(100);
      }
      const view = scene.presentation();
      for (const control of view.controls.filter((control) => control.id.startsWith('storage-block-'))) {
        const layout = view.layers.find((layer) => layer.prefix === control.prefix).layout;
        const visibleNames = new Set();
        const visit = (pane) => {
          if (!(pane.flags & 1)) return;
          visibleNames.add(pane.name);
          for (const child of pane.children ?? []) visit(child);
        };
        visit(layout.root);
        assert.ok(visibleNames.has(control.pane), `${aspect} ${tab} ${control.pane}`);
      }
    }
  }
});

test('Channels lists installed icons, pages without duplicates and isolates SD contents', { skip: !available }, () => {
  const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
  const channels = Array.from({ length: 17 }, (_, index) => ({
    id: `test-${index}`,
    title: `Installed ${index}`,
    icon,
  }));
  const scene = createStorageScene(layouts, {
    kind: 'channels',
    channels: [{ id: 'disc', title: 'Disc Channel', icon }, ...channels],
    sdChannels: [{ id: 'sd-test', title: 'SD Test Channel', icon }],
  });
  scene.advance(100);
  const populated = () => scene.presentation().controls.filter(
    (control) => control.id.startsWith('storage-channel-'),
  );
  assert.equal(populated().length, 15);
  assert.equal(scene.snapshot().channelCount, 17);
  assert.equal(populated()[0].label, 'Installed 0');
  scene.hover('storage-channel-3');
  scene.advance(23);
  const balloon = scene.presentation().layers.find((layer) => layer.prefix === 'storage-balloon:');
  assert.equal(indexLayout(balloon.layout).panes.get('T_Balloon').text, 'Installed 3');
  scene.hover('back');
  scene.advance(30);
  assert.equal(scene.presentation().layers.some((layer) => layer.prefix === 'storage-balloon:'), false);
  assert.equal(scene.activate('storage-next'), true);
  scene.advance(100);
  assert.deepEqual(populated().map((control) => control.label), ['Installed 15', 'Installed 16']);
  assert.equal(scene.activate('storage-next'), false);
  scene.activate('storage-sd');
  scene.advance(100);
  assert.equal(scene.snapshot().channelPage, 0);
  assert.deepEqual(populated().map((control) => control.label), ['SD Test Channel']);
  assert.equal(scene.activate('storage-channel-0'), true);
  scene.advance(100);
  const detail = scene.presentation().layers.find((layer) => layer.prefix === 'storage-detail:');
  assert.equal(indexLayout(detail.layout).panes.get('T_Title_00').text, 'SD Test Channel');
});

test('GameCube tabs and save blocks enter together and wait for the longer block clip', {
  skip: !available,
}, () => {
  const scene = createStorageScene(layouts, { kind: 'gamecube' });
  const boxes = () => scene.presentation().layers.filter((layer) =>
    layer.prefix.startsWith('storage-box'));
  scene.advance(25);
  assert.equal(boxes().length, 0);
  scene.advance(1);
  assert.equal(scene.snapshot().phase, 'tabs-and-boxes-in');
  assert.equal(boxes().length, 15);
  scene.advance(8);
  const base = scene.presentation().layers.find((layer) => layer.prefix === 'scene-storage:');
  const panes = indexLayout(base.layout).panes;
  assert.ok(panes.get('N_Select_00').alpha > 0);
  assert.ok(indexLayout(boxes()[0].layout).panes.get('N_Data_00').alpha > 0);
  scene.advance(8);
  assert.equal(scene.snapshot().locked, true, 'settled tabs do not unlock unfinished save blocks');
  scene.advance(9);
  assert.equal(scene.snapshot().locked, true);
  scene.advance(1);
  assert.equal(scene.snapshot().locked, false);
  scene.back();
  assert.equal(scene.snapshot().phase, 'back-select');
  scene.advance(layouts.it_Button_a.animations.it_Button_a_BtnFlash.frames);
  assert.equal(scene.snapshot().phase, 'data-out', 'exit retains its existing shared timing');
});

test('remembered SD and Slot B tabs restore both the record source and authored selection pose',
  { skip: !available }, () => {
    for (const kind of ['wii', 'channels', 'gamecube']) {
      const switched = createStorageScene(layouts, { kind });
      switched.advance(100);
      switched.activate('storage-sd');
      switched.advance(100);
      const restored = createStorageScene(layouts, { kind, initialTab: 'sd' });
      restored.advance(100);
      assert.equal(restored.snapshot().selectedTab, 'sd');
      assert.equal(restored.snapshot().recordCount, switched.snapshot().recordCount);
      const selection = (scene) => {
        const panes = indexLayout(scene.presentation().layers.find(({ prefix }) => prefix === 'scene-storage:').layout).panes;
        return ['N_SelectSd_00', 'N_SelectWii_00'].map((name) => panes.get(name).scale);
      };
      assert.deepEqual(selection(restored), selection(switched));
    }
  });

test('synthetic save media supports populated Slot B, paging and unchanged operation fixtures',
  { skip: !available }, async () => {
    const { defaultStorageFixture } = await import('../src/storage-state.js');
    const fixture = defaultStorageFixture();
    fixture.gamecube.b = { status: 'ready', records: Array.from({ length: 16 }, (_, i) => ({
      id: `save-${i}`, title: `Synthetic Save ${i}`, blocks: i + 1,
    })) };
    const before = structuredClone(fixture);
    const tabs = [];
    const actions = [];
    const scene = createStorageScene(layouts, {
      kind: 'gamecube', storageFixture: fixture, initialTab: 'sd',
      onTabChange: (tab) => tabs.push(tab), onAction: (...args) => actions.push(args),
    });
    scene.advance(100);
    assert.equal(scene.snapshot().recordCount, 16);
    assert.equal(scene.snapshot().mediaStatus, 'ready');
    assert.equal(scene.presentation().controls.filter(({ id }) => id.startsWith('storage-save-')).length, 15);
    assert.equal(scene.activate('storage-next'), true);
    scene.advance(100);
    assert.equal(scene.presentation().controls.find(({ id }) => id === 'storage-save-0').label, 'Synthetic Save 15');
    assert.equal(scene.activate('storage-save-0'), true);
    scene.advance(100);
    const detail = indexLayout(scene.presentation().layers.find(({ prefix }) => prefix === 'storage-detail:').layout).panes;
    assert.ok([...detail.values()].some((pane) => pane.text === 'Synthetic Save 15'));
    assert.ok([...detail.values()].some((pane) => pane.text === '16'));
    scene.activate('storage-erase');
    scene.advance(100);
    scene.activate('storage-yes');
    scene.advance(100);
    assert.deepEqual(actions[0][1], { operation: 'erase', changed: false });
    assert.deepEqual(fixture, before);
    scene.back();
    scene.advance(100);
    scene.activate('storage-wii');
    scene.advance(100);
    assert.deepEqual(tabs, ['wii']);
    assert.equal(scene.snapshot().recordCount, 0);
  });

test('storage error fixtures retain tab navigation and never expose unavailable records',
  { skip: !available }, async () => {
    const { defaultStorageFixture } = await import('../src/storage-state.js');
    for (const [kind, status, messageId] of [
      ['wii', 'absent', 169], ['channels', 'read-error', 195], ['gamecube', 'unsupported', 235],
    ]) {
      const fixture = defaultStorageFixture();
      fixture.sd.status = fixture.sdSaves.status = fixture.gamecube.b.status = status;
      fixture.sdSaves.records = [{ id: 'hidden', title: 'Unavailable synthetic save', blocks: 1 }];
      const scene = createStorageScene(layouts, {
        kind, storageFixture: fixture, initialTab: 'sd', messages: { [messageId]: 'Original media error' },
      });
      scene.advance(100);
      assert.equal(scene.snapshot().mediaStatus, status);
      assert.equal(scene.snapshot().recordCount, 0);
      const view = scene.presentation();
      assert.ok(!view.controls.some(({ id }) => id.startsWith('storage-save') || id.startsWith('storage-block')));
      assert.equal(indexLayout(view.layers.find(({ prefix }) => prefix === 'scene-storage:').layout)
        .panes.get('T_Error_00').text, 'Original media error');
      assert.equal(scene.activate('storage-wii'), true);
      scene.advance(100);
      assert.equal(scene.snapshot().mediaStatus, 'ready');
    }
  });


test('imported channels with unknown allocation show a dash while authored fixtures retain defaults', {
  skip: !available,
}, () => {
  for (const [id, blocks, expected] of [
    ['0001000148414445', undefined, '-'],
    ['0001000148414445', 28, '28'],
    ['custom-local', undefined, '1'],
  ]) {
    const icon = { ...layouts.it_ObjChannelEdit_b, animations: {} };
    const scene = createStorageScene(layouts, {
      kind: 'channels', channels: [{ id, title: 'Allocation fixture', icon, blocks }],
    });
    scene.advance(100);
    scene.activate('storage-channel-0');
    scene.advance(100);
    const panes = indexLayout(scene.presentation().layers
      .find(({ prefix }) => prefix === 'storage-detail:').layout).panes;
    assert.equal(panes.get('T_Block_00').text, expected, id);
    assert.equal(panes.get('T_Block_02').text, expected, id);
  }
});
