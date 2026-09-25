import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createMenuScenes, MENU_SCENE_LAYOUTS } from '../src/menu-scenes.js';
import { activateSceneControl } from '../src/menu-scene-actions.js';
import { createFooterController } from '../src/footer-controller.js';
import { createDisplay } from '../src/display.js';
import { identity, indexLayout, multiply, paneMatrix } from '../src/animation.js';
import { renderedArrow } from './helpers/rendered-arrow.js';
import { deferredDictionary, flushDictionary } from './helpers/deferred-dictionary.js';
import { defaultStorageFixture } from '../src/storage-state.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && MENU_SCENE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      MENU_SCENE_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
      ]),
    )
  : {};

function worldX(layout, paneName) {
  let coordinate;
  function visit(pane, parentMatrix) {
    const matrix = multiply(parentMatrix, paneMatrix(pane));
    if (pane.name === paneName) coordinate = matrix.length === 12 ? matrix[3] : matrix[4];
    for (const child of pane.children || []) visit(child, matrix);
  }
  visit(layout.root, identity);
  assert.ok(Number.isFinite(coordinate), `Missing pane ${paneName}`);
  return coordinate;
}

test('Board retires the arrival timer at the grid boundary before hidden-footer updates',
  { skip: !available }, () => {
    const sounds = [];
    const balloon = JSON.parse(readFileSync(new URL(
      '../public/assets/layouts/balloon/my_IplTopBalloon_a.json', import.meta.url)));
    const footer = createFooterController(layouts.my_IplTop_e, balloon, () => 0,
      { onSound: (id) => sounds.push(id) });
    const notifications = [];
    const scenes = createMenuScenes(layouts, {
      memos: [{ kind: 'letter', id: 'arrival-letter', createdAt: new Date().toISOString(),
        header: 'Synthetic arrival', text: 'Local incoming message', readAt: null,
        sender: { kind: 'email', address: 'synthetic@example.invalid', nickname: 'Synthetic' },
        photo: { id: 'arrival-photo', width: 512, height: 256, sha256: 'a'.repeat(64),
          localSrc: '/assets/local-letters/arrival-photo.png' } }],
      onBoardReady() {
        notifications.push(scenes.snapshot().frame);
        footer.stopNewMail();
      },
    });
    footer.pose({ newMail: true, messageCount: 1 });
    footer.advance(160);
    scenes.open('board');
    scenes.advance(19);
    footer.advance(19);
    assert.deepEqual(notifications, []);
    assert.equal(sounds.filter((id) => id === 'WIPL_SE_NEW_ARRIVAL').length, 1);
    scenes.advance(1);
    footer.advance(1); // old stale active flag would emit again here
    assert.deepEqual(notifications, [20]);
    assert.equal(scenes.snapshot().transition, 'enter');
    scenes.advance(20);
    scenes.presentation();
    assert.equal(scenes.activate('memo-open-arrival-letter'), true);
    scenes.advance(26);
    assert.equal(scenes.snapshot().readingMemo, true);
    footer.advance(360);
    assert.equal(scenes.activate('incoming-photo'), true);
    scenes.advance(100);
    // The Board and its readers do not draw footer.pose(); persistent timer
    // updates must remain silent without relying on render-time clearing.
    for (let index = 0; index < 10; index += 1) {
      scenes.advance(180);
      footer.advance(180);
    }
    assert.equal(sounds.filter((id) => id === 'WIPL_SE_NEW_ARRIVAL').length, 1);
    assert.deepEqual(notifications, [20]);
    scenes.back();
    scenes.advance(100);
    scenes.back();
    scenes.advance(100);
    assert.equal(scenes.snapshot().readingMemo, false);
    scenes.back();
    scenes.advance(40);
    footer.pose({ newMail: false, messageCount: 1 });
    footer.advance(360);
    assert.equal(sounds.filter((id) => id === 'WIPL_SE_NEW_ARRIVAL').length, 1);
  });

test('Board readiness splits coarse steps at retirement and never survives an aborted entry',
  { skip: !available }, () => {
    const notifications = [];
    const scenes = createMenuScenes(layouts, {
      onBoardReady: () => notifications.push(scenes.snapshot().frame),
    });
    scenes.open('board');
    scenes.advance(100);
    assert.deepEqual(notifications, [20]);
    assert.equal(scenes.snapshot().transition, null);
    scenes.open('board');
    scenes.advance(19.5);
    scenes.open('options');
    scenes.advance(100);
    assert.deepEqual(notifications, [20]);
    scenes.open('board');
    scenes.advance(19.5);
    scenes.advance(0.5);
    assert.deepEqual(notifications, [20, 20]);
  });

test('Address parent adapters preserve saved contacts after a rejected nickname commit',
  { skip: !available }, async () => {
    let reject;
    const errors = [];
    const scenes = createMenuScenes(layouts, {
      contacts: [{ kind: 'wii', address: '1234567812345678', nickname: 'Original' }],
      onContacts: () => new Promise((_resolve, fail) => { reject = fail; }),
      onContactsError: (error) => errors.push(error.message),
    });
    const openContact = () => {
      scenes.open('board');
      scenes.advance(40);
      scenes.activate('create');
      scenes.advance(39);
      scenes.activate('address');
      scenes.advance(29);
      scenes.activate('address-next');
      scenes.advance(15);
      scenes.activate('address-entry-0');
      scenes.advance(53);
    };
    openContact();
    scenes.activate('address-edit-name');
    scenes.advance(61);
    scenes.activate('address-edit');
    for (let index = 0; index < 10; index++) scenes.keyInput('Backspace');
    for (const letter of 'Changed') scenes.keyInput(letter);
    scenes.activate('key-ok');
    scenes.activate('submit');
    scenes.advance(21);
    assert.equal(scenes.snapshot().locked, true);
    assert.deepEqual(scenes.presentation().controls, []);
    reject(new Error('Synthetic parent storage rejection'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, ['Synthetic parent storage rejection']);
    const form = scenes.presentation().layers.find(({ prefix }) => prefix === 'address-form:');
    assert.equal(indexLayout(form.layout).panes.get('T_name_00').text, 'Changed');
    scenes.open('options');
    openContact();
    const card = scenes.presentation().layers.find(({ prefix }) => prefix === 'address-card:');
    assert.equal(indexLayout(card.layout).panes.get('T_name_00').text, 'Original');
  });

test('forced scene entry disposes an active Memo dictionary before accepting late results',
  { skip: !available }, async () => {
    const { provider, sessions } = deferredDictionary();
    const drafts = [];
    const scenes = createMenuScenes(layouts, {
      predict: provider, onDraft: (value) => drafts.push(value),
      getKeyboardPreferences: () => ({ predictionEnabled: true, layoutMode: 'phone' }),
    });
    scenes.open('board');
    scenes.advance(40);
    scenes.activate('create');
    scenes.advance(39);
    scenes.activate('memo');
    scenes.advance(27);
    scenes.activate('memo-edit');
    scenes.advance(30);
    assert.equal(scenes.activate('key-phone-5'), true);
    scenes.presentation();
    assert.ok(sessions[0].requests.length);
    const savedDrafts = [...drafts];
    scenes.open('options');
    assert.equal(sessions[0].closeCalls, 1);
    sessions[0].requests.at(-1).resolve({ engine: 'synthetic-predictor', candidates: ['stale'] });
    await flushDictionary();
    scenes.advance(100);
    assert.deepEqual(drafts, savedDrafts);
    assert.equal(scenes.snapshot().scene, 'options');
    assert.equal(scenes.snapshot().boardChild, null);
  });

test('Board arrows browse a crowded date before changing days, including calendar boundaries',
  { skip: !available }, () => {
    const date = new Date(2000, 0, 1, 12);
    const memos = Array.from({ length: 11 }, (_, index) => ({
      id: `crowded-${index}`, text: `Message ${index}`, createdAt: date.toISOString(),
      position: { x: 0, y: 53 },
    }));
    const scenes = createMenuScenes(layouts, { memos });
    scenes.open('board');
    scenes.presentation({ date });
    scenes.advance(40);
    const dateLabel = () => indexLayout(scenes.presentation({ date }).layers.find(
      (entry) => entry.prefix === 'scene-board:',
    ).layout).panes.get('T_Day_b').text;
    const initialDate = dateLabel();
    assert.equal(scenes.presentation().controls.find((entry) => entry.id === 'prev').label,
      'Older messages');
    assert.equal(scenes.activate('prev'), true);
    assert.equal(scenes.activate('calendar'), false);
    assert.equal(scenes.back(), false);
    scenes.advance(15);
    assert.equal(scenes.snapshot().messagePage, 1);
    assert.equal(dateLabel(), initialDate);
    assert.equal(scenes.presentation().controls.find((entry) => entry.id === 'prev').disabled, true);
    assert.equal(scenes.activate('prev'), false);
    assert.equal(scenes.activate('next'), true);
    scenes.advance(15);
    assert.equal(scenes.snapshot().messagePage, 0);
    assert.equal(dateLabel(), initialDate);
    assert.equal(scenes.activate('next'), true);
    scenes.advance(20);
    assert.notEqual(dateLabel(), initialDate);
  });

test(
  'Board owns accepted arrow and scene-transition cues, including keyboard Back',
  { skip: !available },
  () => {
    const sounds = [];
    const scenes = createMenuScenes(layouts, { onSound: (symbol) => sounds.push(symbol) });
    scenes.open('board');
    scenes.presentation({ date: new Date(2035, 11, 30, 12) });
    assert.equal(scenes.activate('next'), false);
    scenes.advance(40);
    assert.equal(scenes.activate('next'), true);
    assert.equal(scenes.activate('next'), false);
    assert.deepEqual(sounds, ['WSD_SELECT']);
    scenes.advance(30);
    assert.equal(scenes.activate('next'), false);
    assert.deepEqual(sounds, ['WSD_SELECT']);
    assert.equal(scenes.back(), true);
    assert.equal(scenes.back(), false);
    assert.deepEqual(sounds, ['WSD_SELECT', 'WIPL_SE_DECIDE']);
    for (const child of ['create', 'calendar']) {
      scenes.open('board');
      scenes.advance(40);
      assert.equal(scenes.activate(child), true);
      assert.equal(sounds.at(-1), 'WIPL_SE_DECIDE');
    }
    assert.deepEqual(sounds, ['WSD_SELECT', 'WIPL_SE_DECIDE', 'WIPL_SE_DECIDE', 'WIPL_SE_DECIDE']);
  },
);

test(
  'Board day arrows preserve focus through scrolling and retire at departure or the date limit',
  { skip: !available },
  () => {
    const scenes = createMenuScenes(layouts);
    const date = new Date(2035, 11, 29, 12);
    scenes.open('board');
    scenes.presentation({ date });
    scenes.advance(40);
    const arrow = () =>
      renderedArrow(
        scenes
          .presentation({ date })
          .layers.find((layer) => layer.prefix === 'scene-board-buttons:').layout,
      );
    scenes.hover('next');
    scenes.advance(15);
    assert.ok(arrow().bubble > 0);
    scenes.activate('next');
    scenes.advance(3);
    assert.ok(arrow().pressed > 0);
    assert.ok(arrow().bubble > 0);
    scenes.advance(300);
    assert.ok(arrow().bubble > 0);
    scenes.activate('prev');
    scenes.advance(3);
    scenes.hover(null);
    scenes.advance(15);
    assert.equal(arrow().bubble, 0);
    scenes.advance(12);
    scenes.hover('next');
    scenes.advance(15);
    scenes.activate('next');
    scenes.advance(30);
    scenes.activate('next');
    scenes.advance(45);
    assert.equal(arrow().bubble, 0);
    assert.equal(scenes.activate('next'), false);
    assert.equal(
      scenes.presentation({ date }).controls.find((control) => control.id === 'next').disabled,
      true,
    );
  },
);
test(
  'options use authored phases and restore retained hierarchy on Back',
  { skip: !available },
  () => {
    const events = [],
      scenes = createMenuScenes(layouts, {
        onNavigate: (value) => events.push(value),
      });
    assert.equal(scenes.activate('data'), false);
    scenes.advance(31);
    assert.equal(scenes.snapshot().locked, true);
    scenes.advance(1);
    assert.equal(scenes.snapshot().locked, false);
    assert.deepEqual(
      scenes.presentation().controls.map((control) => control.id),
      ['data', 'system', 'back'],
    );
    const immutable = JSON.stringify(layouts.it_ObjSetUp_a);
    assert.equal(scenes.activate('data'), true);
    scenes.advance(39);
    assert.equal(scenes.snapshot().scene, 'options');
    scenes.advance(1);
    assert.equal(scenes.snapshot().scene, 'data');
    scenes.advance(16);
    assert.equal(scenes.snapshot().locked, false);
    assert.equal(scenes.activate('save'), true);
    scenes.advance(56);
    assert.equal(scenes.snapshot().scene, 'save');
    scenes.back();
    scenes.advance(39);
    assert.equal(scenes.snapshot().scene, 'data');
    assert.equal(scenes.snapshot().locked, false);
    scenes.back();
    scenes.advance(39);
    assert.equal(scenes.snapshot().scene, 'options');
    scenes.back();
    scenes.advance(19);
    assert.deepEqual(events, ['grid']);
    assert.equal(JSON.stringify(layouts.it_ObjSetUp_a), immutable);
  },
);
test(
  'storage remains local and every resource control has a native pane',
  { skip: !available },
  () => {
    const scenes = createMenuScenes(layouts);
    scenes.advance(32);
    scenes.activate('data');
    scenes.advance(56);
    scenes.activate('save');
    scenes.advance(56);
    scenes.activate('wii');
    scenes.advance(108);
    assert.equal(scenes.snapshot().scene, 'wii');
    assert.equal(scenes.snapshot().locked, false);
    let view = scenes.presentation();
    for (const control of view.controls)
      assert.ok(
        indexLayout(view.layers.find((layer) => layer.prefix === control.prefix).layout).panes.has(
          control.pane,
        ),
      );
    scenes.activate('storage-sd');
    scenes.advance(48);
    assert.equal(scenes.snapshot().selectedTab, 'sd');
    scenes.back();
    scenes.advance(45);
    scenes.advance(20);
    assert.equal(scenes.snapshot().scene, 'save');
    assert.equal(scenes.snapshot().locked, false);
  },
);

test('menu scenes forwards declared capacity to restored and switched storage tabs',
  { skip: !available }, () => {
    const scenes = createMenuScenes(layouts, {
      storageFixture: { ...defaultStorageFixture(), freeBlocks: { wii: 0, sd: 1007 } },
      storageTabs: { channels: 'sd' },
      messages: { 156: 'Open fixture blocks: ', 242: '' },
    });
    scenes.advance(32);
    scenes.activate('data');
    scenes.advance(56);
    scenes.activate('channels');
    scenes.advance(108);
    const caption = () => {
      const base = scenes.presentation().layers.find(({ prefix }) => prefix === 'scene-storage:');
      return indexLayout(base.layout).panes.get('T_Capa_00').text;
    };
    assert.equal(scenes.snapshot().selectedTab, 'sd');
    assert.equal(caption(), 'Open fixture blocks: 1007');
    scenes.activate('storage-wii');
    scenes.advance(100);
    assert.equal(caption(), 'Open fixture blocks: 0');
  });

test(
  'system settings navigation follows original flash and board buttons retain original forty-frame transition',
  { skip: !available },
  () => {
    const events = [],
      scenes = createMenuScenes(layouts, {
        onNavigate: (value) => events.push(value),
      });
    scenes.advance(32);
    scenes.activate('system');
    scenes.advance(39);
    assert.deepEqual(events, []);
    scenes.advance(1);
    assert.deepEqual(events, ['system-settings']);
    scenes.back();
    scenes.advance(20);
    assert.equal(scenes.snapshot().scene, 'options');
    scenes.open('board');
    assert.equal(scenes.presentation().gridFrame, 70);
    scenes.advance(20);
    assert.equal(scenes.snapshot().gridFrame, 90);
    scenes.advance(19);
    assert.equal(scenes.back(), false);
    scenes.advance(1);
    assert.equal(scenes.back(), true);
    assert.equal(scenes.snapshot().gridFrame, 100);
    assert.equal(scenes.snapshot().transition, 'exit');
    scenes.advance(40);
    assert.deepEqual(events, ['system-settings', 'grid']);
  },
);
test(
  'Message Board nests native Calendar and Create pages without external dummy actions',
  { skip: !available },
  () => {
    const actions = [],
      scenes = createMenuScenes(layouts, {
        onAction: (action) => actions.push(action),
      });
    scenes.open('board');
    scenes.advance(40);
    scenes.presentation({ date: new Date(2026, 8, 17) });
    assert.equal(scenes.activate('calendar'), true);
    scenes.advance(50);
    assert.equal(scenes.snapshot().boardChild, 'calendar');
    assert.ok(scenes.presentation().controls.some((control) => control.id.startsWith('date-')));
    assert.equal(scenes.activate('date-0'), true);
    scenes.advance(80);
    assert.equal(scenes.snapshot().boardChild, null);
    const board = scenes
      .presentation()
      .layers.find((layer) => layer.prefix === 'scene-board:').layout;
    assert.equal(indexLayout(board).panes.get('T_Day_b').text, 'Sun 8/30');
    assert.equal(scenes.activate('create'), true);
    scenes.advance(39);
    assert.equal(scenes.snapshot().boardChild, 'create');
    assert.equal(scenes.activate('memo'), true);
    scenes.advance(27);
    assert.equal(scenes.snapshot().childPage, 'memo');
    scenes.back();
    scenes.advance(73);
    scenes.back();
    scenes.advance(46);
    assert.equal(scenes.snapshot().boardChild, null);
    assert.deepEqual(actions, []);
  },
);
test('Create Message return brings Board arrows inward at their original size',
  { skip: !available }, () => {
    for (const aspect of ['4:3', '16:9']) {
      const display = createDisplay(aspect);
      const scenes = createMenuScenes(layouts, { display });
      const arrows = () => {
        const footer = scenes.presentation().layers.find(
          (layer) => layer.prefix === 'scene-board-buttons:',
        ).layout;
        const panes = indexLayout(footer).panes;
        return Object.fromEntries(['L', 'R'].map((side) => [side, {
          offset: panes.get(side === 'L' ? 'N_ArwL_End' : 'N_ArwR__End').translation[0],
          hit: renderedArrow(footer, side, display).hit,
        }]));
      };

      scenes.open('board', new Date(2026, 8, 17, 12));
      scenes.advance(40);
      const settled = arrows();
      assert.equal(scenes.activate('create'), true);
      scenes.advance(39);
      assert.equal(scenes.back(), true);
      scenes.advance(46);
      assert.equal(scenes.snapshot().boardChild, null);

      const entering = arrows();
      assert.equal(entering.L.offset, -200);
      assert.equal(entering.R.offset, 200);
      scenes.advance(5);
      const midpoint = arrows();
      assert.equal(midpoint.L.offset, -100);
      assert.equal(midpoint.R.offset, 100);
      scenes.advance(5);
      const arrived = arrows();
      assert.equal(arrived.L.offset, 0);
      assert.equal(arrived.R.offset, 0);

      for (const side of ['L', 'R']) {
        assert.ok(Math.abs(midpoint[side].hit.x - entering[side].hit.x) > 0);
        // The independent idle loop shifts arrow geometry slightly as its
        // clock continues through the Create page.
        assert.ok(Math.abs(arrived[side].hit.x - settled[side].hit.x) < 3);
        for (const step of [entering, midpoint, arrived]) {
          assert.ok(Math.abs(step[side].hit.w - settled[side].hit.w) < 1e-8);
          assert.ok(Math.abs(step[side].hit.h - settled[side].hit.h) < 1e-8);
        }
      }
    }
  });
test('Calendar date tiles play one date cue while other controls keep their host cue',
  { skip: !available }, () => {
    const sounds = [];
    const scenes = createMenuScenes(layouts, {
      onSound: (sound) => sounds.push(sound),
    });
    const playHostSound = (sound) => sounds.push(sound);

    scenes.open('board', new Date(2026, 8, 17, 12));
    scenes.advance(40);
    assert.equal(activateSceneControl(scenes, 'calendar', playHostSound), true);
    assert.deepEqual(sounds, ['WIPL_SE_DECIDE']);
    scenes.advance(50);
    sounds.length = 0;
    assert.equal(activateSceneControl(scenes, 'date-3', playHostSound), true);
    assert.deepEqual(sounds, ['WIPL_SE_DATE_SELECT']);

    scenes.open('board', new Date(2026, 8, 17, 12));
    scenes.advance(40);
    assert.equal(activateSceneControl(scenes, 'calendar', playHostSound), true);
    scenes.advance(50);
    sounds.length = 0;
    assert.equal(activateSceneControl(scenes, 'next', playHostSound), true);
    assert.deepEqual(sounds, ['confirm']);
    scenes.advance(30);
    sounds.length = 0;
    assert.equal(activateSceneControl(scenes, 'back', playHostSound), true);
    assert.deepEqual(sounds, ['cancel']);
  });
test(
  'posted corner Memos remain under the Wii Menu at their saved position after Board return',
  { skip: !available },
  () => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    const scenes = createMenuScenes(layouts, {
      memos: [{
        id: 'corner-memo',
        text: 'Corner Memo',
        createdAt: date.toISOString(),
        position: { x: -230, y: -80 },
        readAt: date.toISOString(),
      }],
    });
    scenes.open('board');
    scenes.advance(40);
    scenes.presentation({ date });
    const before = scenes.presentation({ date }).layers.find(
      ({ prefix }) => prefix === 'memo-card-corner-memo:',
    ).layout.root.translation;

    assert.equal(scenes.activate('back'), true);
    scenes.advance(40);
    assert.equal(scenes.snapshot().scene, 'closed');
    assert.deepEqual(scenes.memoReturnLayers()[0].layout.root.translation, before);
    assert.equal(scenes.memoReturnLayers()[0].prefix, 'memo-card-corner-memo:');
    scenes.setMemos([]);
    assert.deepEqual(scenes.memoReturnLayers(), []);
  },
);
test(
  'Home Menu Memo underlay is restored from persisted records after a date refresh',
  { skip: !available },
  () => {
    const date = new Date(2026, 8, 17, 12);
    const scenes = createMenuScenes(layouts, {
      memos: [{
        id: 'persisted-memo',
        text: 'Persisted Memo',
        createdAt: date.toISOString(),
        position: { x: -230, y: -80 },
        readAt: date.toISOString(),
      }],
    });
    scenes.refreshMemoReturnLayers(date);
    assert.equal(scenes.memoReturnLayers().length, 1);
    assert.deepEqual(scenes.memoReturnLayers()[0].layout.root.translation, [-230, -80, 0]);
  },
);
test(
  're-entering the Message Board keeps persisted Memos at their neutral pose',
  { skip: !available },
  () => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    const scenes = createMenuScenes(layouts, {
      memos: [{
        id: 'settled-memo',
        text: 'Settled Memo',
        createdAt: date.toISOString(),
        position: { x: -230, y: -80 },
        readAt: date.toISOString(),
      }],
    });
    scenes.open('board');
    scenes.advance(40);
    scenes.back();
    scenes.advance(40);
    scenes.open('board');
    const card = scenes.presentation({ date }).layers.find(
      ({ prefix }) => prefix === 'memo-card-settled-memo:',
    ).layout;
    assert.deepEqual(indexLayout(card).panes.get('N_Letter').scale, [1, 1]);
  },
);
test('Board footer hover and activation work before requesting its first presentation',
  { skip: !available }, () => {
    for (const id of ['calendar', 'create']) {
      const scenes = createMenuScenes(layouts);
      scenes.open('board');
      scenes.advance(40);
      assert.equal(scenes.hover(id), true);
      assert.equal(scenes.activate(id), true);
      scenes.advance(50);
      assert.equal(scenes.snapshot().boardChild, id);
      assert.ok(scenes.presentation().controls.length > 0);
    }
  });

test(
  'Message Board retains the initialized centered date and scrolls actual adjacent dates',
  { skip: !available },
  () => {
    const scenes = createMenuScenes(layouts),
      date = new Date(2026, 8, 17, 12);
    scenes.open('board');
    scenes.presentation({ date });
    scenes.advance(40);
    let view = scenes.presentation({ date });
    let board = view.layers.find((layer) => layer.prefix === 'scene-board:').layout;
    assert.equal(indexLayout(board).panes.get('T_Day_b').text, 'Thu 9/17');
    assert.deepEqual(
      view.controls.map((control) => control.id),
      ['back', 'calendar', 'create', 'prev', 'next'],
    );
    assert.equal(scenes.activate('next'), true);
    scenes.advance(30);
    board = scenes
      .presentation({ date })
      .layers.find((layer) => layer.prefix === 'scene-board:').layout;
    assert.equal(indexLayout(board).panes.get('T_Day_b').text, 'Fri 9/18');
    assert.equal(scenes.activate('prev'), true);
    scenes.advance(30);
    board = scenes
      .presentation({ date })
      .layers.find((layer) => layer.prefix === 'scene-board:').layout;
    assert.equal(indexLayout(board).panes.get('T_Day_b').text, 'Thu 9/17');
  },
);
test('Board date labels travel through the 20-frame page slide in both TV aspects',
  { skip: !available }, () => {
    const date = new Date(2026, 8, 17, 12);
    for (const aspect of ['4:3', '16:9']) {
      const display = createDisplay(aspect);
      const scenes = createMenuScenes(layouts, { display });
      const board = () => scenes.presentation({ date }).layers.find(
        (layer) => layer.prefix === 'scene-board:',
      ).layout;
      const label = (name) => indexLayout(board()).panes.get(name).text;
      const screenX = (name) => worldX(board(), name) * display.rootScaleX;
      scenes.open('board');
      scenes.advance(40);
      const center = screenX('T_Day_b');
      assert.equal(label('T_Day_b'), 'Thu 9/17');
      assert.equal(scenes.activate('next'), true);
      scenes.advance(10);
      assert.equal(label('T_Day_b'), 'Thu 9/17');
      assert.equal(label('T_Day_c'), 'Fri 9/18');
      assert.ok(screenX('T_Day_b') < center - 100);
      assert.ok(screenX('T_Day_c') > center + 100);
      scenes.advance(9);
      const incomingNext = screenX('T_Day_c');
      scenes.advance(1);
      assert.equal(label('T_Day_b'), 'Fri 9/18');
      assert.ok(Math.abs(incomingNext - screenX('T_Day_b')) < display.rootScaleX);
      assert.equal(scenes.activate('prev'), true);
      scenes.advance(10);
      assert.equal(label('T_Day_a'), 'Thu 9/17');
      assert.equal(label('T_Day_b'), 'Fri 9/18');
      assert.ok(screenX('T_Day_a') < center - 100);
      assert.ok(screenX('T_Day_b') > center + 100);
      scenes.advance(9);
      const incomingPrevious = screenX('T_Day_a');
      scenes.advance(1);
      assert.equal(label('T_Day_b'), 'Thu 9/17');
      assert.ok(Math.abs(incomingPrevious - screenX('T_Day_b')) < display.rootScaleX);
    }
  });

test('Board return slides once toward today across several days in both TV aspects',
  { skip: !available }, () => {
    const today = new Date(2026, 9, 2, 12);
    for (const aspect of ['4:3', '16:9']) {
      for (const browseDirection of ['prev', 'next']) {
        const display = createDisplay(aspect);
        const navigation = [];
        const scenes = createMenuScenes(layouts, {
          display,
          onNavigate: (destination) => navigation.push(destination),
        });
        const board = () => scenes.presentation().layers.find(
          (layer) => layer.prefix === 'scene-board:',
        ).layout;
        const label = (name) => indexLayout(board()).panes.get(name).text;
        const screenX = (name) => worldX(board(), name) * display.rootScaleX;

        scenes.open('board', today);
        scenes.advance(40);
        const center = screenX('T_Day_b');
        for (let day = 0; day < 5; day += 1) {
          assert.equal(scenes.activate(browseDirection), true);
          scenes.advance(20);
          scenes.presentation();
        }
        assert.ok(label('T_Day_b').endsWith(
          browseDirection === 'prev' ? '9/27' : '10/7',
        ));

        assert.equal(scenes.back(), true);
        const incoming = browseDirection === 'next' ? 'T_Day_a' : 'T_Day_c';
        assert.ok(label(incoming).endsWith('10/2'));
        const initialDistance = Math.abs(screenX(incoming) - center);
        scenes.advance(10);
        assert.ok(Math.abs(screenX(incoming) - center) < initialDistance);
        scenes.advance(10);
        assert.ok(Math.abs(screenX(incoming) - center) < 2 * display.rootScaleX);
        scenes.advance(19);
        assert.equal(scenes.snapshot().scene, 'board');
        assert.ok(Math.abs(screenX(incoming) - center) < 2 * display.rootScaleX);
        scenes.advance(1);
        assert.deepEqual(navigation, ['grid']);
      }

      const scenes = createMenuScenes(layouts, { display: createDisplay(aspect) });
      scenes.open('board', today);
      scenes.advance(40);
      const board = () => scenes.presentation().layers.find(
        (layer) => layer.prefix === 'scene-board:',
      ).layout;
      const before = worldX(board(), 'T_Day_b');
      assert.equal(scenes.back(), true);
      scenes.advance(20);
      assert.equal(worldX(board(), 'T_Day_b'), before);
    }
  });

test('Board return restores the current date Memo underlay after browsing another day',
  { skip: !available }, () => {
    const today = new Date(2026, 9, 2, 12);
    const earlier = new Date(2026, 8, 27, 12);
    const scenes = createMenuScenes(layouts, {
      memos: [
        { id: 'today', text: 'Current day', createdAt: today.toISOString(),
          position: { x: 0, y: 0 } },
        { id: 'earlier', text: 'Earlier day', createdAt: earlier.toISOString(),
          position: { x: 0, y: 0 } },
      ],
    });
    scenes.open('board', today);
    scenes.advance(40);
    for (let day = 0; day < 5; day += 1) {
      assert.equal(scenes.activate('prev'), true);
      scenes.advance(20);
      scenes.presentation();
    }
    const cardX = () => scenes.presentation().layers.find(
      (layer) => layer.prefix === 'memo-card-earlier:',
    )?.layout.root.translation[0];
    const pageX = () => indexLayout(scenes.presentation().layers.find(
      (layer) => layer.prefix === 'scene-board:',
    ).layout).panes.get('N_TopBack').translation[0];
    const originalX = cardX();
    assert.ok(Number.isFinite(originalX));
    assert.equal(scenes.back(), true);
    assert.equal(cardX(), originalX);
    scenes.advance(10);
    assert.ok(cardX() < originalX - 200);
    assert.ok(Math.abs(cardX() - originalX - pageX()) < 1e-6);
    scenes.advance(10);
    assert.ok(cardX() < originalX - 500);
    assert.ok(Math.abs(cardX() - originalX - pageX()) < 1e-6);
    scenes.advance(20);
    assert.deepEqual(scenes.memoReturnLayers().map((layer) => layer.prefix),
      ['memo-card-today:']);
  });

test(
  'Options opaque bars draw before breadcrumb headings and preserve outgoing fade contents',
  { skip: !available },
  () => {
    const scenes = createMenuScenes(layouts);
    scenes.advance(32);
    const view = scenes.presentation();
    assert.ok(
      view.layers.findIndex((layer) => layer.prefix === 'scene-back:') <
        view.layers.findIndex((layer) => layer.prefix === 'scene-options:'),
    );
    scenes.back();
    scenes.advance(19);
    assert.equal(scenes.snapshot().locked, true);
    assert.ok(scenes.presentation().layers.some((layer) => layer.prefix === 'scene-options:'));
  },
);

test(
  'posting a local Memo returns to today and opens the original reader without duplicate persistence',
  { skip: !available },
  () => {
    const writes = [],
      actions = [],
      date = new Date(2026, 8, 17, 12);
    const scenes = createMenuScenes(layouts, {
      onMemos: (value) => writes.push(value),
      onAction: (value) => actions.push(value),
    });
    scenes.open('board');
    scenes.advance(40);
    scenes.presentation({ date });
    scenes.activate('prev');
    scenes.advance(30);
    scenes.presentation({ date });
    scenes.activate('create');
    scenes.advance(39);
    scenes.activate('memo');
    scenes.advance(27);
    scenes.activate('memo-edit');
    scenes.advance(30);
    scenes.keyInput('h');
    scenes.keyInput('i');
    scenes.back();
    scenes.advance(30);
    scenes.activate('submit');
    scenes.advance(98);
    const view = scenes.presentation({ date });
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].text, 'hi');
    assert.equal(new Date(writes[0][0].createdAt).getDate(), 17);
    assert.deepEqual(actions, []);
    assert.equal(indexLayout(view.layers[0].layout).panes.get('T_Day_b').text, 'Thu 9/17');
    const memo = view.controls.find((control) => control.id.startsWith('memo-open-'));
    assert.ok(memo);
    scenes.advance(layouts.LetterS_a.animations.LetterS_a_PasteLetter.frames);
    assert.equal(scenes.activate(memo.id), true);
    scenes.advance(26);
    const readView = scenes.presentation({ date });
    assert.equal(readView.readingMemo, true);
    assert.ok(readView.layers.some((layer) => layer.prefix === 'memo-reader:'));
    assert.equal(
      readView.layers.some((layer) => layer.prefix === 'scene-board-buttons:'),
      false,
    );
    scenes.back();
    scenes.advance(46);
    assert.equal(scenes.presentation({ date }).readingMemo, false);
    assert.equal(writes.length, 2);
    assert.ok(writes[1][0].readAt);
  },
);

test(
  'Memo dragging owns input and keyup does not retrigger reader scrolling',
  { skip: !available },
  () => {
    const date = new Date(2026, 8, 17, 12);
    const scenes = createMenuScenes(layouts, {
      memos: [
        {
          id: 'a',
          text: 'Long memo',
          createdAt: date.toISOString(),
          position: { x: 0, y: 53 },
          readAt: null,
        },
      ],
      measureTextLines: () => 20,
    });
    scenes.presentation(date);
    scenes.open('board');
    scenes.advance(40);
    assert.equal(scenes.pointerDown('memo-open-a', { x: 0, y: 53 }), true);
    assert.equal(scenes.activate('calendar'), false);
    assert.equal(scenes.activate('next'), false);
    assert.equal(
      scenes.presentation().controls.some((control) => control.id === 'calendar'),
      false,
    );
    scenes.cancelPointer();
    assert.equal(scenes.snapshot().draggingMemo, false);
    assert.equal(scenes.activate('memo-open-a'), true);
    scenes.advance(26);
    assert.equal(scenes.keyInput('ArrowDown', { type: 'keyup' }), false);
    assert.equal(scenes.keyInput('ArrowDown', { type: 'keydown' }), true);
  },
);

test('Options focus survives rapid re-entry and neighboring icon rollouts finish', { skip: !available }, () => {
  const scene = createMenuScenes(layouts);
  scene.advance(100);
  const scale = (name) => indexLayout(scene.presentation().layers.find(
    (layer) => layer.prefix === 'scene-options:',
  ).layout).panes.get(name).scale[0];
  scene.hover('data');
  scene.advance(3);
  const before = scale('P_DataManage_00');
  scene.hover(null);
  scene.hover('data');
  assert.equal(scale('P_DataManage_00'), before);
  scene.advance(20);
  scene.hover('system');
  scene.advance(1);
  scene.hover(null);
  scene.advance(30);
  assert.equal(scale('P_DataManage_00'), 1);
  assert.equal(scale('P_Setting_00'), 1);
});

test('explicit console fixture reaches both managed Address and recipient picker covers',
  { skip: !available }, () => {
    const ownWiiNumber = '7053433507880718'; // Generated structural fixture, not a console ID.
    for (const branch of ['address', 'letter']) {
      const scenes = createMenuScenes(layouts, {
        ownWiiNumber, localRegistration: true, letterService: 'local',
      });
      scenes.open('board');
      scenes.advance(40);
      scenes.activate('create');
      scenes.advance(39);
      scenes.activate(branch);
      scenes.advance(80);
      const book = scenes.presentation().layers.find(({ layout }) =>
        indexLayout(layout).panes.has('T_wii_name'));
      assert.ok(book);
      assert.equal(indexLayout(book.layout).panes.get('T_wii_name').text, '7053 4335 0788 0718');
      scenes.open('options');
    }
  });

test('scene thumbnail load failures hide the card image without disabling its loaded reader photo',
  { skip: !available }, () => {
    const date = new Date(2026, 8, 21, 12);
    const photo = { id: 'scene-thumbnail', width: 512, height: 256, sha256: 'a'.repeat(64),
      localSrc: '/assets/local-letters/scene-thumbnail.png',
      thumbnail: { width: 64, height: 48, sha256: 'b'.repeat(64),
        localSrc: '/assets/local-letters/thumbnails/scene-thumbnail.png' } };
    const scenes = createMenuScenes(layouts, {
      unavailableThumbnailIds: new Set([photo.id]),
      memos: [{ kind: 'letter', id: 'thumbnail-letter', createdAt: date.toISOString(),
        header: 'Synthetic photo', text: 'Readable text', photo,
        sender: { kind: 'email', address: 'synthetic@example.invalid', nickname: 'Synthetic' } }],
    });
    scenes.open('board', date);
    scenes.advance(40);
    const card = scenes.presentation().layers.find(({ prefix }) => prefix === 'memo-card-thumbnail-letter:');
    assert.ok(card);
    assert.equal(indexLayout(card.layout).panes.get('N_Pic').flags & 1, 0);
    assert.equal(scenes.activate('memo-open-thumbnail-letter'), true);
    scenes.advance(26);
    assert.ok(scenes.presentation().controls.some(({ id }) => id === 'incoming-photo'));
  });
