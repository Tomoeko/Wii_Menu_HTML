import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CREATE_LAYOUTS, createBoardCreate } from '../src/board-create.js';
import { indexLayout, transform } from '../src/animation.js';
import { isPersistentArrowControl } from '../src/arrow-interaction.js';
import { normalizeKeyboardPreferences } from '../src/keyboard-preferences.js';
import { renderedArrow } from './helpers/rendered-arrow.js';
import { Renderer } from '../src/renderer.js';
import { BitmapFont } from '../src/font.js';
import { routeKeyboardTextPointer } from '../src/keyboard-text-hit.js';
import { createDisplay, screenPoint } from '../src/display.js';
import { deferredDictionary, flushDictionary } from './helpers/deferred-dictionary.js';

const url = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(url) ? JSON.parse(readFileSync(url)) : null;
const available = manifest && CREATE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      CREATE_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, url))),
      ]),
    )
  : {};

test('Create reads Address status without contact copies while retaining its public scene state',
  { skip: !available }, (t) => {
    const contacts = Array.from({ length: 100 }, (_, index) => ({
      kind: 'email', address: `synthetic${index}@example.invalid`, nickname: `Local ${index}`,
    }));
    const create = createBoardCreate(layouts, { contacts });
    create.advance(39);
    assert.equal(create.activate('address'), true);
    const clone = globalThis.structuredClone;
    let contactCopies = 0;
    t.mock.method(globalThis, 'structuredClone', (value, ...args) => {
      if (Array.isArray(value) && value.length === 100 && value[0]?.kind === 'email')
        contactCopies += 1;
      return clone(value, ...args);
    });
    const check = (locked) => {
      contactCopies = 0;
      const state = create.snapshot();
      assert.equal(contactCopies, 0);
      assert.equal(state.page, 'address');
      assert.equal(state.locked, locked);
      const { layers, controls, ...viewState } = create.presentation();
      assert.equal(contactCopies, 1, 'the public Address presentation still copies contacts');
      assert.deepEqual(viewState, state);
      assert.ok(layers.some(layer => layer.prefix === 'address-book:'));
      assert.ok(controls.length > 0);
    };
    check(true);
    create.advance(29);
    check(false);
    contactCopies = 0;
    assert.equal(create.hover('address-next'), true);
    assert.equal(contactCopies, 0);
    assert.equal(create.activate('address-next'), true);
    create.advance(7);
    check(true);
    create.advance(8);
    check(false);
    assert.equal(create.activate('address-entry-0'), true);
    create.advance(53);
    assert.equal(create.snapshot().addressStep, 'contact');
  });

test('Create disposal releases nested Address and Letter dictionaries and can reopen cleanly',
  { skip: !available }, async () => {
    for (const child of ['address', 'letter']) {
      const { provider, sessions } = deferredDictionary();
      const events = [];
      const create = createBoardCreate(layouts, {
        contacts: [{ kind: 'wii', address: '1234567812345678', nickname: 'Synthetic' }],
        letterService: 'local', predict: provider,
        getKeyboardPreferences: () => ({ predictionEnabled: true, layoutMode: 'phone' }),
        onSound: (sound) => events.push(sound), onContacts: (value) => events.push(value),
        onBack: () => events.push('back'),
      });
      create.advance(39);
      create.activate('address');
      create.advance(29);
      create.activate('address-next');
      create.advance(15);
      create.activate('address-entry-0');
      create.advance(53);
      if (child === 'address') {
        assert.equal(create.activate('address-edit-name'), true);
        create.advance(100);
        assert.equal(create.activate('address-edit'), true);
      } else {
        assert.equal(create.activate('address-send'), true);
        create.advance(40);
        create.advance(17);
        assert.equal(create.activate('letter-edit'), true);
        create.advance(30);
      }
      assert.equal(create.activate('key-phone-5'), true);
      create.presentation();
      if (child === 'letter') assert.ok(sessions[0].requests.length, child);
      else assert.equal(sessions[0].requests.length, 0, 'native Address nickname has no prediction');
      const before = [...events];
      create.dispose();
      create.dispose();
      assert.equal(sessions[0].closeCalls, 1, child);
      sessions[0].requests.at(-1)?.resolve({ engine: 'original-zi8', candidates: ['stale'] });
      await flushDictionary();
      create.advance(100);
      assert.deepEqual(events, before, child);
      assert.equal(create.snapshot().page, 'closed');
      assert.equal(create.back(), false);
      create.open();
      create.advance(39);
      assert.equal(create.snapshot().page, 'selector');
      assert.equal(create.snapshot().editing, false);
      assert.equal(create.snapshot().addressStep, undefined);
      assert.equal(create.activate('memo'), true);
    }
  });

test(
  'Address entry and Back run original arrow appearance and disappearance',
  { skip: !available },
  () => {
    const create = createBoardCreate(layouts);
    const arrowOffset = () =>
      indexLayout(
        create.presentation().layers.find((layer) => layer.prefix === 'scene-create-footer:')
          .layout,
      ).panes.get('N_ArwR__End').translation[0];
    create.advance(39);
    create.activate('address');
    assert.equal(arrowOffset(), 200);
    create.advance(6);
    assert.equal(arrowOffset(), 100);
    create.advance(22);
    assert.equal(arrowOffset(), 0);
    create.back();
    assert.equal(arrowOffset(), 0);
    create.advance(5);
    assert.equal(arrowOffset(), 100);
    create.advance(5);
    assert.equal(arrowOffset(), 200);
    create.advance(38);
    assert.equal(create.snapshot().page, 'selector');
    assert.equal(arrowOffset(), 200);
  },
);

test(
  'Address arrows retain the original idle loop independently of focus and page actions',
  { skip: !available },
  () => {
    const create = createBoardCreate(layouts);
    create.advance(39);
    create.activate('address');
    create.advance(28);
    const arrow = () =>
      indexLayout(
        create.presentation().layers.find((layer) => layer.prefix === 'scene-create-footer:')
          .layout,
      ).panes.get('N_ArwR_Roop').translation;
    const start = [...arrow()];
    create.hover('address-next');
    assert.deepEqual(arrow(), start);
    create.advance(12);
    assert.notDeepEqual(arrow(), start);
    create.activate('address-next');
    create.advance(43);
    assert.deepEqual(arrow(), start);
  },
);

test(
  'Address separately recalculated sheets retain one fade factor and the face retains two',
  { skip: !available },
  () => {
    const source = JSON.stringify(layouts.th_Adress_a);
    const create = createBoardCreate(layouts);
    create.advance(39);
    create.activate('address');
    create.advance(9);
    const layer = create.presentation().layers.find((item) => item.prefix === 'address-book:');
    const renderer = Object.create(Renderer.prototype);
    renderer.bounds = new Map();
    renderer.quad = () => {};
    renderer.window = () => {};
    const opacity = new Map();
    renderer.draw(layer.layout, {
      ...layer,
      onPane: (pane, _matrix, alpha) => opacity.set(pane.name, alpha),
    });
    assert.equal(opacity.get('N_note_a'), 0.5);
    assert.equal(opacity.get('N_note_a:stack-19'), 0.5);
    assert.equal(opacity.get('N_note_e'), 0.5);
    assert.equal(opacity.get('T_wii_name'), 0.5);
    assert.equal(opacity.get('N_note_b'), 0.25);
    assert.equal(opacity.get('T_nmbr_b'), 0.25);
    assert.equal(layer.alphaContextRoots.has('N_note_b'), false);
    assert.equal(layer.alphaContextRoots.has('N_note_c'), false);
    assert.equal(JSON.stringify(layouts.th_Adress_a), source);
  },
);

test(
  'Address shared arrow accepts departure and re-entry during a locked page turn',
  { skip: !available },
  () => {
    const create = createBoardCreate(layouts);
    create.advance(39);
    create.activate('address');
    create.advance(28);
    const arrow = () =>
      renderedArrow(
        create.presentation().layers.find((layer) => layer.prefix === 'scene-create-footer:')
          .layout,
      );
    create.hover('address-next');
    create.advance(15);
    assert.ok(arrow().bubble > 0);
    create.activate('address-next');
    create.advance(3);
    assert.ok(arrow().pressed > 0);
    create.hover(null);
    create.advance(15);
    assert.equal(arrow().bubble, 0);
    create.hover('address-next');
    create.advance(15);
    assert.ok(arrow().bubble > 0);
    create.advance(300);
    assert.ok(arrow().bubble > 0);
    assert.equal(arrow().pressed, 0);
  },
);

test(
  'original Create selector waits for native footer queue and preserves resources',
  { skip: !available },
  () => {
    const pristine = JSON.stringify(layouts),
      exits = [];
    const create = createBoardCreate(layouts, {
      onBack: () => exits.push(true),
      messages: { 133: 'Memo fixture' },
    });
    assert.equal(create.activate('memo'), false);
    create.advance(38);
    assert.equal(create.snapshot().locked, true);
    create.advance(1);
    assert.equal(create.snapshot().locked, false);
    assert.deepEqual(
      create.presentation().controls.map((item) => item.id),
      ['memo', 'letter', 'address', 'back'],
    );
    const view = create.presentation();
    assert.equal(indexLayout(view.layers[0].layout).panes.get('T_Mail').text, 'Memo fixture');
    for (const control of view.controls)
      assert.ok(
        indexLayout(view.layers.find((item) => item.prefix === control.prefix).layout).panes.has(
          control.pane,
        ),
      );
    create.hover('memo');
    create.advance(7);
    create.hover('address');
    create.advance(7);
    create.back();
    create.advance(45);
    assert.deepEqual(exits, []);
    create.advance(1);
    assert.deepEqual(exits, [true]);
    assert.equal(JSON.stringify(layouts), pristine);
  },
);

test(
  'Memo uses original forms and keyboard with a persistent draft and local Post animation',
  { skip: !available },
  () => {
    const drafts = [],
      actions = [],
      exits = [];
    const create = createBoardCreate(layouts, {
      draft: 'Initial',
      onDraft: (value) => drafts.push(value),
      onAction: (id, payload) => actions.push([id, payload]),
      onBack: () => exits.push(true),
    });
    create.advance(39);
    create.activate('memo');
    create.advance(27);
    assert.equal(
      create.presentation().controls.find((item) => item.id === 'submit').disabled,
      false,
    );
    create.activate('memo-edit');
    create.advance(29);
    assert.equal(create.snapshot().locked, true);
    create.advance(1);
    assert.equal(create.snapshot().editing, true);
    assert.equal(create.keyInput('h'), true);
    assert.equal(create.keyInput('Home'), false);
    create.keyInput('Backspace');
    create.keyInput('!');
    assert.equal(create.snapshot().memoText, 'Initial!');
    assert.equal(drafts.at(-1), 'Initial!');
    let view = create.presentation();
    assert.ok(view.layers.some((layer) => layer.prefix === 'keyboard-ascii:'));
    const memo = view.layers.find((layer) => layer.prefix === 'scene-create-body:').layout;
    assert.equal(indexLayout(memo).panes.get('N_Memo').translation[1], 145);
    assert.equal(indexLayout(memo).panes.get('T_Letter').caretIndex, 8);
    assert.equal(create.activate('key-ok'), true);
    create.advance(20);
    create.advance(30);
    assert.equal(create.snapshot().editing, false);
    create.activate('submit');
    create.advance(20 + 51 + 27);
    assert.deepEqual(actions, [['post-memo', { text: 'Initial!' }]]);
    assert.equal(drafts.at(-1), '');
    assert.deepEqual(exits, [true]);
  },
);

test(
  'offline Letter and Register use native dialogs and distinct settings destinations',
  { skip: !available },
  () => {
    for (const [choice, action, dialog] of [
      ['letter', 'network-settings', 'network'],
      ['address', 'wc24-settings', 'wc24'],
    ]) {
      const actions = [];
      const sounds = [];
      const create = createBoardCreate(layouts, {
        onAction: (id) => actions.push(id),
        onSound: (id) => sounds.push(id),
      });
      create.advance(39);
      create.activate(choice);
      if (choice === 'letter')
        assert.deepEqual(sounds, ['WIPL_SE_DECIDE', 'WIPL_SE_INFO_WINDOW']);
      create.advance(choice === 'address' ? 28 : 27);
      if (choice === 'address') {
        assert.equal(create.activate('submit'), true);
        create.advance(45);
      }
      assert.equal(create.snapshot().networkDialog, dialog);
      assert.deepEqual(
        create.presentation().controls.map((item) => item.id),
        ['network-quit', 'network-settings'],
      );
      create.activate('network-settings');
      create.advance(42);
      assert.deepEqual(actions, [action]);
      assert.equal(create.snapshot().networkDialog, false);
    }
  },
);

test('full Address registration preserves the offline gate before the capacity notice',
  { skip: !available }, () => {
    const contacts = Array.from({ length: 100 }, (_, index) => ({
      kind: 'email', address: `fixture${index}@example.invalid`, nickname: `Local ${index}`,
    }));
    for (const localRegistration of [false, true]) {
      const saves = [];
      const create = createBoardCreate(layouts, {
        contacts, localRegistration, onContacts: (value) => saves.push(value),
      });
      create.advance(39);
      create.activate('address');
      create.advance(28);
      assert.equal(create.presentation().controls.find(({ id }) => id === 'submit').disabled, false);
      assert.equal(create.activate('submit'), true);
      create.advance(19);
      assert.equal(create.snapshot().networkDialog, false, 'the original footer press completes first');
      assert.equal(create.presentation().layers.some(({ prefix }) => prefix === 'address-dialog:'),
        false);
      create.advance(27);
      create.advance(25);
      if (localRegistration) {
        assert.equal(create.snapshot().networkDialog, false);
        assert.deepEqual(create.presentation().controls.map(({ id }) => id), ['address-full-ok']);
        assert.equal(create.activate('address-full-ok'), true);
      } else {
        assert.equal(create.snapshot().networkDialog, 'wc24');
        assert.deepEqual(create.presentation().controls.map(({ id }) => id),
          ['network-quit', 'network-settings']);
        assert.equal(create.activate('network-quit'), true);
      }
      create.advance(50);
      assert.equal(create.snapshot().addressStep, 'book');
      assert.equal(create.presentation().controls.find(({ id }) => id === 'submit').disabled, false);
      assert.deepEqual(saves, []);
    }
  });

test('registration Mii and review use the common footer and serialize departure, save and notice',
  { skip: !available }, async () => {
    let resolve;
    const writes = [];
    const create = createBoardCreate(layouts, {
      localRegistration: true,
      onContacts(value) {
        writes.push(value);
        return new Promise((done) => { resolve = done; });
      },
    });
    const step = () => create.snapshot().addressStep;
    const pressSubmit = () => {
      assert.equal(create.activate('submit'), true);
      create.advance(20);
    };
    create.advance(39);
    create.activate('address');
    create.advance(28);
    pressSubmit();
    create.advance(36);
    create.activate('address-wii');
    create.advance(61);
    create.activate('address-edit');
    for (const digit of '8742285515623182') create.keyInput(digit);
    create.activate('key-ok');
    pressSubmit();
    create.advance(40);
    create.activate('address-edit');
    for (const letter of 'Fixture') create.keyInput(letter);
    create.activate('key-ok');
    pressSubmit();
    create.advance(42);
    assert.equal(step(), 'mii');
    assert.deepEqual(create.presentation().controls.map(({ id }) => id),
      ['address-mii', 'back', 'submit']);
    pressSubmit();
    create.advance(40);
    assert.equal(step(), 'review');
    assert.deepEqual(create.presentation().controls.map(({ id }) => id),
      ['address-info', 'back', 'submit']);
    const footer = create.presentation().layers.find(({ prefix }) => prefix === 'scene-create-footer:');
    const panes = indexLayout(footer.layout).panes;
    assert.equal(panes.get('T_CalAdd_R').text, 'OK');
    for (const name of ['N_ArwL_End', 'N_ArwR__End'])
      assert.equal(Math.abs(panes.get(name).translation[0]), 200, 'retired original page-arrow pose');
    create.activate('submit');
    create.advance(18);
    assert.deepEqual(writes, []);
    create.advance(1);
    assert.equal(writes.length, 1, 'card departure runs with the common footer press');
    create.advance(100);
    assert.deepEqual(create.presentation().controls, []);
    assert.equal(create.back(), false);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    create.advance(25);
    assert.deepEqual(create.presentation().controls.map(({ id }) => id), ['address-registered-ok']);
    assert.equal(create.activate('submit'), false);
    create.activate('address-registered-ok');
    create.advance(38 + 17);
    assert.equal(step(), 'book');
    assert.equal(create.presentation().controls.find(({ id }) => id === 'submit').label, 'Register');
    assert.equal(writes.length, 1);
  });

test(
  'Create hover cues fire once per entry and keyboard lifecycle uses native sounds',
  { skip: !available },
  () => {
    const sounds = [];
    const create = createBoardCreate(layouts, { onSound: (id) => sounds.push(id) });
    create.advance(39);
    create.hover('memo');
    create.hover('memo');
    create.hover(null);
    create.hover('memo');
    assert.deepEqual(sounds, ['WIPL_SE_BT_TARGETTING', 'WIPL_SE_BT_TARGETTING']);
    create.activate('memo');
    create.advance(27);
    create.activate('memo-edit');
    assert.equal(sounds.at(-1), 'WIPL_SE_SK_OPEN');
    create.advance(30);
    create.activate('key-ok');
    assert.deepEqual(sounds.slice(-2), ['WIPL_SE_SK_DECIDE_CLOSE', 'WIPL_SE_CHAR_DECIDE']);
    assert.equal(create.snapshot().duration, 30);
    create.advance(30);
    create.activate('memo-edit');
    create.advance(30);
    create.activate('key-back');
    assert.deepEqual(sounds.slice(-2), ['WIPL_SE_SK_CANCEL_CLOSE', 'WIPL_SE_CHAR_DECIDE']);
  },
);

test(
  'Address arrow keeps its hover bubble through page turns until pointer departure',
  { skip: !available },
  () => {
    const sounds = [];
    const create = createBoardCreate(layouts, { onSound: (id) => sounds.push(id) });
    create.advance(39);
    create.activate('address');
    create.advance(28);
    create.hover('address-next');
    create.advance(15);
    const footerPane = () =>
      indexLayout(
        create.presentation().layers.find((layer) => layer.prefix === 'scene-create-footer:')
          .layout,
      ).panes.get('N_ArwBtnR');
    assert.equal(footerPane().scale[0], 1);
    create.activate('address-next');
    create.advance(15);
    assert.equal(footerPane().scale[0], 1);
    create.advance(45);
    assert.equal(footerPane().scale[0], 1);
    create.hover(null);
    create.advance(15);
    assert.ok(footerPane().scale[0] < 0.11);
    create.back();
    create.advance(73);
    assert.equal(create.snapshot().page, 'selector');
    assert.ok(footerPane().scale[0] < 0.11);
    assert.deepEqual(sounds, [
      'WIPL_SE_DECIDE',
      'WIPL_SE_BT_TARGETTING',
      'WIPL_SE_FL_PAGE_INC',
      'WIPL_SE_CANCEL',
    ]);
  },
);

test(
  'Memo and Address return through original child and footer queues',
  { skip: !available },
  () => {
    for (const page of ['memo', 'address']) {
      const create = createBoardCreate(layouts);
      create.advance(39);
      create.activate(page);
      create.advance(page === 'address' ? 28 : 27);
      assert.equal(create.snapshot().page, page);
      assert.equal(create.back(), true);
      create.advance(73);
      assert.equal(create.snapshot().page, 'selector');
      assert.equal(create.snapshot().locked, false);
    }
  },
);

test(
  'Address entrance uses the selected-card zoom and waits for its queued footer',
  { skip: !available },
  () => {
    const create = createBoardCreate(layouts);
    create.advance(39);
    create.activate('address');
    const book = () =>
      indexLayout(
        create.presentation().layers.find((layer) => layer.prefix === 'address-book:').layout,
      ).panes.get('N_note_all');
    assert.equal(book().translation[0], 190);
    assert.ok(Math.abs(book().scale[0] - 0.45) < 1e-6);
    assert.equal(book().alpha, 0);
    create.advance(1);
    assert.equal(book().alpha, 0, 'queued child retains its frame-zero pose');
    const selector = create.presentation().layers.find((layer) => layer.prefix === 'scene-create:');
    assert.ok(indexLayout(selector.layout).panes.get('N_LetterB').translation[0] < 0);
    create.advance(16);
    assert.equal(book().translation[0], 0);
    assert.equal(book().scale[0], 1);
    assert.equal(book().alpha, 255);
    assert.equal(create.activate('address-next'), false);
    create.advance(10);
    assert.equal(create.snapshot().locked, true);
    create.advance(1);
    assert.equal(create.snapshot().locked, false);
  },
);

test(
  'Address exit shrinks the active page while the selector returns, then finishes the footer queue',
  { skip: !available },
  () => {
    const pristine = JSON.stringify(layouts);
    for (const turnPage of [false, true]) {
      const create = createBoardCreate(layouts);
      create.advance(39);
      create.activate('address');
      create.advance(28);
      if (turnPage) {
        create.activate('address-next');
        create.advance(17);
      }
      const viewPanes = (prefix) => {
        const layer = create.presentation().layers.find((item) => item.prefix === prefix);
        return layer && indexLayout(layer.layout).panes;
      };
      const before = viewPanes('address-book:');
      const rotations = ['N_note_e_rtt', 'N_note_c_rtt'].map((name) => [
        ...before.get(name).rotation,
      ]);
      const stackPosition = [...before.get('N_note_base').translation];
      const footerBefore = viewPanes('scene-create-footer:').get('N_BtnL_a8').translation[0];
      assert.equal(create.back(), true);
      create.advance(1);
      assert.equal(viewPanes('scene-create:').get('N_AdressB').alpha, 0);
      assert.ok(viewPanes('address-book:').get('N_note_all').alpha < 255);
      create.advance(7);
      const middle = viewPanes('address-book:');
      assert.equal(middle.get('N_note_all').translation[0], 95);
      assert.ok(Math.abs(middle.get('N_note_all').scale[0] - 0.725) < 1e-6);
      assert.equal(middle.get('N_note_all').alpha, 127.5);
      const selectorAlpha = viewPanes('scene-create:').get('N_AdressB').alpha;
      assert.ok(selectorAlpha > 0 && selectorAlpha < 255);
      assert.equal(viewPanes('scene-create-footer:').get('N_BtnL_a8').translation[0], footerBefore);
      for (let frame = 8; frame <= 16; frame++) {
        const panes = viewPanes('address-book:');
        assert.deepEqual(panes.get('N_note_base').translation, stackPosition);
        assert.deepEqual(
          ['N_note_e_rtt', 'N_note_c_rtt'].map((name) => panes.get(name).rotation),
          rotations,
        );
        for (const [name, pane] of panes) {
          if (/^N_note_[ade]:stack-\d+$/.test(name))
            assert.equal(pane.alpha, panes.get(name.split(':')[0]).alpha);
        }
        assert.ok(!create.presentation().layers.some((layer) => layer.prefix === 'address-card:'));
        if (frame < 16) create.advance(1);
      }
      assert.equal(viewPanes('address-book:').get('N_note_all').alpha, 0);
      create.advance(5);
      assert.equal(viewPanes('scene-create-footer:').get('N_BtnL_a8').translation[0], footerBefore);
      create.advance(1);
      assert.ok(viewPanes('scene-create-footer:').get('N_BtnL_a8').translation[0] > footerBefore);
      create.advance(25);
      assert.equal(create.snapshot().locked, true);
      create.advance(1);
      assert.equal(viewPanes('address-book:'), undefined);
      assert.equal(create.snapshot().page, 'selector');
      assert.equal(create.snapshot().locked, false);
    }
    assert.equal(JSON.stringify(layouts), pristine);
  },
);

test(
  'inactive Address move overlay never leaks into entry, Back or the settled selector',
  { skip: !available },
  () => {
    const original = JSON.stringify(layouts.th_Adress_a);
    for (const openedPage of [0, 1]) {
      const create = createBoardCreate(layouts);
      const renderer = Object.create(Renderer.prototype);
      renderer.bounds = new Map();
      renderer.quad = () => {};
      renderer.window = () => {};
      const assertOverlayAbsent = (label) => {
        const layer = create.presentation().layers.find((item) => item.prefix === 'address-book:');
        if (!layer) return;
        const traversed = new Set();
        renderer.draw(layer.layout, {
          ...layer,
          onPane: (pane) => traversed.add(pane.name),
        });
        assert.equal(traversed.has('mii_move'), false, label);
        assert.equal(traversed.has('N_note_move'), false, label);
      };
      create.advance(39);
      create.activate('address');
      for (let update = 0; update <= 28; update++) {
        assertOverlayAbsent(`page ${openedPage} entry update ${update}`);
        if (update < 28) create.advance(1);
      }
      if (openedPage) {
        create.activate('address-next');
        for (let update = 0; update < 15; update++) {
          assertOverlayAbsent(`page turn update ${update}`);
          create.advance(1);
        }
      }
      assert.equal(create.back(), true);
      for (let update = 0; update <= 48; update++) {
        assertOverlayAbsent(`page ${openedPage} Back update ${update}`);
        if (update < 48) create.advance(1);
      }
      for (const frames of [132, 120]) {
        create.advance(frames);
        assert.equal(create.snapshot().page, 'selector');
        assert.equal(
          create.presentation().layers.some((layer) => layer.prefix === 'address-book:'),
          false,
        );
      }
    }
    assert.equal(
      JSON.stringify(layouts.th_Adress_a),
      original,
      'original resource stays untouched',
    );
  },
);

test(
  'Memo keyboard restores changed preferences each time the editor reopens',
  { skip: !available },
  () => {
    let preferences = { predictionEnabled: true, dictionaryLanguage: 'es' };
    let preferenceReads = 0;
    const create = createBoardCreate(layouts, {
      getKeyboardPreferences: () => {
        preferenceReads++;
        return preferences;
      },
      onKeyboardPreferencesChange: (next) => { preferences = next; },
    });
    create.advance(39);
    create.activate('memo');
    create.advance(27);
    create.activate('memo-edit');
    create.advance(30);
    assert.equal(preferenceReads, 1);
    const predictionControl = () => create.presentation().controls.find((item) => item.id === 'key-prediction');
    assert.equal(predictionControl().label, 'Turn dictionary off');
    create.activate('key-prediction');
    create.advance(12);
    assert.deepEqual(preferences, normalizeKeyboardPreferences({
      schemaVersion: 2, predictionEnabled: false, dictionaryLanguage: 'es',
    }));
    create.activate('key-phone');
    create.activate('key-phone-mode-1');
    create.activate('key-more');
    create.advance(18);
    create.activate('key-symbols-next');
    create.advance(20);
    create.activate('key-symbols-close');
    create.advance(13);
    create.activate('key-back');
    const closing = create.presentation().layers.find((layer) => layer.prefix === 'scene-create-body:');
    assert.equal(indexLayout(closing.layout).panes.get('T_Letter').caretVisible, false);
    create.advance(30);
    create.activate('memo-edit');
    create.advance(30);
    assert.equal(preferenceReads, 2);
    assert.equal(predictionControl().label, 'Turn dictionary on');
    const phone = create.presentation().layers.find((layer) => layer.prefix === 'keyboard-phone:');
    assert.equal(indexLayout(phone.layout).panes.get('T_CPkey_01').text, 'abc');
    create.activate('key-more');
    create.advance(18);
    const symbols = create.presentation().layers.find((layer) => layer.prefix === 'keyboard-symbols:');
    assert.equal(indexLayout(symbols.layout).panes.get('T_SGN_pageNumber').text, '2/10');
    assert.deepEqual(preferences, {
      schemaVersion: 2, predictionEnabled: false, dictionaryLanguage: 'es',
      layoutMode: 'phone', phoneMode: 1, symbolPage: 1,
    });
  },
);

test(
  'Memo editor exposes one-line scroll arrows and keeps focus through repeated presses',
  { skip: !available },
  () => {
    const create = createBoardCreate(layouts, { draft: 'one\ntwo\nthree\nfour\nfive\nsix' });
    create.advance(39);
    create.activate('memo');
    create.advance(27);
    create.activate('memo-edit');
    create.advance(30);
    create.advance(15);
    create.advance(11);
    const view = () => create.presentation();
    const pane = (name) => indexLayout(view().layers.find((layer) => layer.prefix === 'scene-create-body:').layout).panes.get(name);
    assert.equal(view().controls.find((item) => item.id === 'memo-scroll-up').pane, 'B_txtScrll_UP');
    assert.ok(pane('P_txtScrll_UP').alpha > 0);
    create.hover('memo-scroll-up');
    create.advance(6);
    const hoveredScale = pane('P_txtScrll_UP').scale[0];
    assert.ok(hoveredScale > 1.1);
    const initialOffset = create.snapshot().memoScroll.offset;
    assert.equal(create.activate('memo-scroll-up'), true);
    assert.equal(create.activate('memo-scroll-up'), false);
    create.advance(15);
    assert.equal(create.snapshot().memoScroll.offset, initialOffset - 42);
    assert.equal(pane('P_txtScrll_UP').scale[0], hoveredScale);
    assert.equal(create.activate('memo-scroll-up'), true);
    create.advance(15);
    assert.equal(create.snapshot().memoScroll.offset, initialOffset - 84);
    create.hover(null);
    create.advance(8);
    assert.equal(pane('P_txtScrll_UP').scale[0], 1);
  },
);

test('held Memo editor arrows repeat on native sixty/twenty cadence and stop on departure',
  { skip: !available }, () => {
    const sounds = [];
    const draft = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n');
    const create = createBoardCreate(layouts, { draft, onSound: (sound) => sounds.push(sound) });
    create.advance(39);
    create.activate('memo');
    create.advance(27);
    assert.equal(create.holdControl('memo-scroll-down'), false, 'display arrows do not opt in');
    create.activate('memo-edit');
    create.advance(30);
    create.advance(26);
    const initial = create.snapshot().memoScroll.offset;
    const scrollSounds = () => sounds.filter((sound) => sound === 'WIPL_SE_LINE_SCROLL').length;
    const initialSounds = scrollSounds();
    create.hover('memo-scroll-up');
    assert.equal(create.holdControl('memo-scroll-up'), true);
    create.advance(59);
    assert.equal(create.snapshot().memoScroll.offset, initial - 42);
    assert.equal(scrollSounds(), initialSounds + 1);
    create.advance(1);
    assert.equal(scrollSounds(), initialSounds + 2);
    create.advance(20);
    assert.equal(create.snapshot().memoScroll.offset, initial - 84);
    assert.equal(scrollSounds(), initialSounds + 3);
    create.hover(null);
    create.advance(100);
    assert.equal(create.snapshot().memoScroll.offset, initial - 126);
    assert.equal(scrollSounds(), initialSounds + 3);
    create.hover('memo-scroll-up');
    create.holdControl('memo-scroll-up');
    create.releaseControl();
    create.advance(100);
    assert.equal(scrollSounds(), initialSounds + 4);
  },
);


test('Memo candidate pointer selection wins over its underlying text pane and preserves insertion',
  { skip: !available }, () => {
    const font = new BitmapFont({
      width: 20, height: 32, lineFeed: 42, baseline: 26, ascent: 26,
      characters: {}, glyphs: [{ advance: 16 }], defaultGlyph: 0, sheets: [],
    }, {});
    const create = createBoardCreate(layouts, {
      display: createDisplay(),
      measureTextLayout: (text, pane) => font.layoutPaneText(text, pane),
      predict: () => ['he', 'here', 'help', 'hello'],
      getKeyboardPreferences: () => ({ predictionEnabled: true, dictionaryLanguage: 'en' }),
    });
    create.advance(39);
    create.activate('memo');
    create.advance(27);
    create.activate('memo-edit');
    create.advance(30);
    create.keyInput('h');
    create.keyInput('e');
    const view = create.presentation();
    const renderer = Object.create(Renderer.prototype);
    renderer.display = createDisplay();
    renderer.bounds = new Map();
    renderer.quad = () => {};
    renderer.window = () => {};
    for (const layer of view.layers) renderer.draw(layer.layout, { prefix: layer.prefix });
    const controls = view.controls.map((control) => ({
      ...control, rect: renderer.rect(control.prefix + control.pane),
    }));
    const hello = controls.find((control) => control.label === 'hello');
    const point = { x: hello.rect.x + hello.rect.w / 2, y: hello.rect.y + hello.rect.h / 2 };
    let caretSelection = false;
    const target = routeKeyboardTextPointer(point, controls, (location) => {
      caretSelection = true;
      return create.selectTextAt(location);
    });
    assert.equal(caretSelection, false);
    assert.equal(target.control.id, hello.id);
    create.activate(target.control.id);
    create.keyInput('x');
    assert.equal(create.snapshot().memoText, 'hellox');
    const letter = indexLayout(create.presentation().layers.find(
      (layer) => layer.prefix === 'scene-create-body:',
    ).layout).panes.get('T_Letter');
    assert.equal(letter.caretIndex, 6);
  });

test('contact Send uses the original offline gate and modal contact dialogs own the footer controls',
  { skip: !available }, () => {
    const updates = [];
    const actions = [];
    const create = createBoardCreate(layouts, {
      contacts: [{ kind: 'wii', address: '1234567812345678', nickname: 'Synthetic' }],
      onContacts: (value) => updates.push(value), onAction: (value) => actions.push(value),
    });
    create.advance(39);
    create.activate('address');
    create.advance(29);
    create.activate('address-next');
    create.advance(15);
    create.activate('address-entry-0');
    create.advance(53);
    assert.equal(create.activate('address-send'), true);
    create.advance(46);
    assert.equal(create.snapshot().networkDialog, 'network');
    assert.deepEqual(create.presentation().controls.map(({ id }) => id), ['network-quit', 'network-settings']);
    create.activate('network-quit');
    create.advance(42);
    assert.equal(create.snapshot().networkDialog, false);
    assert.equal(create.snapshot().addressStep, 'contact');
    create.activate('address-erase');
    create.advance(58);
    const view = create.presentation();
    assert.deepEqual(view.controls.map(({ id }) => id), ['address-erase-yes', 'address-erase-no']);
    assert.equal(view.layers.at(-1).prefix, 'address-dialog:');
    assert.ok(!view.layers.some(({ prefix }) => prefix === 'scene-create-footer:'));
    assert.equal(create.activate('submit'), false);
    create.back();
    create.advance(79);
    assert.equal(create.snapshot().addressStep, 'contact');
    assert.ok(create.presentation().layers.some(({ prefix }) => prefix === 'scene-create-footer:'));
    assert.deepEqual(updates, []);
    assert.deepEqual(actions, []);
  });


test('Memo decorates stored newlines only while its original input form is open',
  { skip: !available }, () => {
    const create = createBoardCreate(layouts, { draft: 'First\nSecond' });
    const letter = () => indexLayout(create.presentation().layers.find(
      (layer) => layer.prefix === 'scene-create-body:',
    ).layout).panes.get('T_Letter');
    create.advance(39);
    create.activate('memo');
    create.advance(27);
    assert.equal(letter().showLineFeeds, undefined);
    create.activate('memo-edit');
    create.advance(30);
    assert.equal(letter().showLineFeeds, true);
    create.keyInput('Enter');
    assert.equal(letter().text, 'First\nSecond\n');
    assert.equal(letter().caretIndex, 13);
    create.activate('key-ok');
    create.advance(20);
    create.advance(30);
    assert.equal(create.snapshot().editing, false);
    assert.equal(letter().showLineFeeds, undefined);
    assert.equal(create.snapshot().memoText, 'First\nSecond\n');
  });

function memoPointerFixture(draft, options = {}) {
  const font = new BitmapFont({
    width: 20, height: 32, lineFeed: 32, baseline: 26, ascent: 26,
    characters: {}, glyphs: [{ advance: 16 }], defaultGlyph: 0, sheets: [],
  }, {});
  const display = options.display ?? createDisplay();
  const create = createBoardCreate(layouts, {
    draft, display,
    measureTextLayout: (text, pane) => font.layoutPaneText(text, pane),
    measureTextLines: (text, pane) => font.layoutPaneText(text, pane).lines.length,
    ...options,
  });
  create.advance(39);
  create.activate('memo');
  create.advance(27);
  const rendered = () => {
    const view = create.presentation();
    const renderer = Object.create(Renderer.prototype);
    renderer.display = display;
    renderer.bounds = new Map();
    renderer.quad = () => {};
    renderer.window = () => {};
    for (const layer of view.layers) renderer.draw(layer.layout, { ...layer });
    return {
      view, renderer,
      controls: view.controls.map((control) => ({
        ...control, rect: renderer.rect(control.prefix + control.pane),
      })),
    };
  };
  const textPoint = (index) => {
    const { renderer } = rendered();
    const bound = renderer.bounds.get('scene-create-body:T_Letter');
    const metrics = font.layoutPaneText(bound.pane.text, bound.pane);
    const line = metrics.lines.findLast((line) => index >= line.start);
    const caret = line.carets.find((position) => position.index === index);
    const [x, y] = transform(bound.matrix, caret.x, line.y - 14);
    return { x: display.halfWidth + x, y: display.halfHeight - y };
  };
  const open = () => {
    create.activate('memo-edit');
    create.advance(30);
    create.advance(15);
    create.advance(11);
  };
  return { create, rendered, textPoint, open };
}

test('Memo forwards candidate holds while moving controls still occlude underlying text',
  { skip: !available }, () => {
    const sounds = [];
    const { create, rendered, open } = memoPointerFixture('', {
      getKeyboardPreferences: () => ({ predictionEnabled: true }),
      predict: () => Array.from({ length: 40 }, (_, index) => `hello${index}`),
      measureText: () => 220,
      onSound: (name) => sounds.push(name),
    });
    open();
    create.keyInput('h');
    create.hover('key-candidates-next');
    const arrow = rendered().controls.find((control) => control.id === 'key-candidates-next');
    const point = { x: arrow.rect.x + arrow.rect.w / 2, y: arrow.rect.y + arrow.rect.h / 2 };
    assert.equal(create.holdControl(arrow.id), true);
    const moving = routeKeyboardTextPointer(point, rendered().controls, () => {
      assert.fail('moving candidate arrow must block the Memo text underneath');
    });
    assert.equal(moving.control.id, arrow.id);
    assert.equal(moving.control.disabled, true);
    assert.equal(isPersistentArrowControl(`scene-${arrow.id}`), true);
    create.advance(16);
    assert.equal(sounds.filter((name) => name === 'WIPL_SE_LINE_SCROLL').length, 2);
    create.releaseControl();
    create.advance(100);
    assert.equal(sounds.filter((name) => name === 'WIPL_SE_LINE_SCROLL').length, 2);
    assert.equal(create.snapshot().memoText, 'h');
  });

test('a closed draft opens the keyboard at the clicked character instead of its end',
  { skip: !available }, () => {
    const { create, rendered, textPoint } = memoPointerFixture('one\ntwo\nthree');
    const point = textPoint(5);
    const routed = routeKeyboardTextPointer(point, rendered().controls,
      (location) => create.selectTextAt(location));
    assert.equal(routed.control.id, 'memo-edit');
    assert.equal(routed.selected, true);
    create.advance(30);
    create.advance(15);
    create.keyInput('X');
    assert.equal(create.snapshot().memoText, 'one\ntXwo\nthree');
  });

test('closed Memo Up remains above the broad text opener at the bottom of a long draft',
  { skip: !available }, () => {
    const { create, rendered, open } = memoPointerFixture(
      'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight',
    );
    open();
    create.activate('key-ok');
    create.advance(20);
    create.advance(30);
    create.advance(15);
    assert.equal(create.snapshot().editing, false);
    create.hover('memo-scroll-up');
    create.advance(8);
    const before = create.snapshot().memoScroll.offset;
    const { controls } = rendered();
    assert.ok(!controls.some(({ id }) => id === 'memo-scroll-down'));
    const up = controls.find(({ id }) => id === 'memo-scroll-up');
    const point = { x: up.rect.x + up.rect.w / 2, y: up.rect.y + up.rect.h / 2 };
    const text = controls.find(({ id }) => id === 'memo-edit');
    assert.ok(point.x >= text.rect.x && point.x <= text.rect.x + text.rect.w &&
      point.y >= text.rect.y && point.y <= text.rect.y + text.rect.h,
    'hover-expanded arrow overlaps the broad source text hit pane');
    assert.ok(controls.indexOf(up) > controls.indexOf(text),
      'main appends DOM buttons in this order, placing the arrow above the opener');
    let selections = 0;
    const routed = routeKeyboardTextPointer(point, controls.map((control) => ({
      ...control, id: `scene-${control.id}`,
    })), (location) => {
      selections++;
      return create.selectTextAt(location);
    });
    assert.equal(routed.control.id, 'scene-memo-scroll-up');
    assert.equal(routed.selected, false);
    assert.equal(selections, 0);
    assert.equal(create.activate(routed.control.id.slice(6)), true);
    create.advance(15);
    assert.ok(create.snapshot().memoScroll.offset < before);
    assert.equal(create.snapshot().editing, false, 'scrolling never opens the keyboard');
  });

test('closed Memo Down keeps the idle host button center through every hover frame',
  { skip: !available }, () => {
    for (const aspect of ['4:3', '16:9']) {
      const display = createDisplay(aspect);
      const { create, rendered } = memoPointerFixture(
        'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight', { display },
      );
      create.advance(11);
      const hostControls = () => rendered().controls.map((control) => {
        const rect = control.rect;
        if (!rect) return control;
        const x = Math.max(0, rect.x);
        const y = Math.max(0, rect.y);
        return { ...control, id: `scene-${control.id}`, rect: { x, y,
          w: Math.min(display.width, rect.x + rect.w) - x,
          h: Math.min(display.height, rect.y + rect.h) - y } };
      }).filter(({ rect }) => rect && rect.w > 0 && rect.h > 0);
      const idle = hostControls().find(({ id }) => id === 'scene-memo-scroll-down');
      const logical = { x: idle.rect.x + idle.rect.w / 2, y: idle.rect.y + idle.rect.h / 2 };
      const viewport = { left: 20, top: 90, width: 320, height: 180 };
      const point = screenPoint(display, viewport,
        viewport.left + logical.x * viewport.width / display.width,
        viewport.top + logical.y * viewport.height / display.height);
      create.hover('memo-scroll-down');
      for (let frame = 0; frame <= 20; frame++) {
        const route = routeKeyboardTextPointer(point, hostControls(), () => true);
        assert.equal(route.control?.id, 'scene-memo-scroll-down',
          `${aspect} hover frame ${frame}`);
        assert.equal(route.selected, false);
        create.advance(1);
      }
    }
  });

test('Memo text remains selectable after manual scrolling beyond the original three-line pane',
  { skip: !available }, () => {
    const { create, textPoint, open } = memoPointerFixture('one\ntwo\nthree\nfour\nfive\nsix');
    open();
    assert.equal(create.snapshot().memoScroll.offset, 168);
    create.activate('memo-scroll-up');
    create.advance(15);
    assert.equal(create.selectTextAt(textPoint(20)), true, 'fifth source line is visible after Up');
    create.keyInput('X');
    assert.equal(create.snapshot().memoText, 'one\ntwo\nthree\nfour\nfXive\nsix');
    create.activate('memo-scroll-down');
    create.advance(15);
    assert.equal(create.selectTextAt(textPoint(26)), true, 'sixth source line is visible after Down');
    create.keyInput('Y');
    assert.equal(create.snapshot().memoText, 'one\ntwo\nthree\nfour\nfXive\nsYix');
    assert.equal(create.selectTextAt({ x: 250, y: 5 }), false, 'offscreen text is not a target');
  });

test('disabled dictionary candidates occlude Memo text throughout source page movement',
  { skip: !available }, () => {
    for (const aspect of ['16:9', '4:3']) {
      const { create, rendered, open } = memoPointerFixture('one\ntwo\nthree\nfour\nfive\nsix', {
        display: createDisplay(aspect),
        getKeyboardPreferences: () => ({ predictionEnabled: true }),
        predict: () => ['something', 'somethingelse', 'sixes', 'sixmore', 'sixabc', 'sixdef'],
        measureText: () => 150,
      });
      open();
      create.keyInput('x');
      rendered();
      assert.equal(create.activate('key-candidates-next'), true);
      const originalText = create.snapshot().memoText;
      const caretIndex = () => indexLayout(rendered().view.layers.find(
        (layer) => layer.prefix === 'scene-create-body:',
      ).layout).panes.get('T_Letter').caretIndex;
      const originalCaret = caretIndex();
      for (let frame = 0; frame < 16; frame++) {
        const { renderer, controls } = rendered();
        const viewport = renderer.rect('scene-create-body:T_2l_TextBox');
        const candidate = controls.find(({ id, rect }) => /^key-candidate-\d+$/.test(id) &&
          Math.max(rect.x, viewport.x) < Math.min(rect.x + rect.w, viewport.x + viewport.w));
        assert.ok(candidate, `${aspect} frame ${frame}: a candidate overlaps the text viewport`);
        assert.equal(candidate.disabled, true);
        const left = Math.max(candidate.rect.x, viewport.x);
        const right = Math.min(candidate.rect.x + candidate.rect.w, viewport.x + viewport.w);
        const top = Math.max(candidate.rect.y, viewport.y);
        const bottom = Math.min(candidate.rect.y + candidate.rect.h, viewport.y + viewport.h);
        assert.ok(bottom > top, 'original hit panes overlap at the top of the candidate strip');
        const point = { x: left + (right - left) / 4, y: (top + bottom) / 2 };
        let textSelections = 0;
        const routed = routeKeyboardTextPointer(point, controls, (location) => {
          textSelections++;
          return create.selectTextAt(location);
        });
        assert.equal(routed.selected, false, `${aspect} frame ${frame}: no click-through`);
        assert.equal(routed.control?.id, candidate.id);
        assert.equal(routed.control.disabled, true);
        assert.equal(textSelections, 0);
        assert.equal(create.activate(candidate.id), false);
        assert.equal(create.holdControl(candidate.id), false);
        assert.equal(create.snapshot().memoText, originalText);
        assert.equal(caretIndex(), originalCaret);
        create.advance(1);
      }
      const settled = rendered().controls.find(({ id }) => /^key-candidate-\d+$/.test(id));
      assert.equal(settled.disabled, false, 'candidate input resumes at the source endpoint');
      assert.equal(create.activate(settled.id), true);
    }
  });

test('Memo last-line input stays above the prediction strip and deletion settles on whole lines',
  { skip: !available }, () => {
    const { create, rendered, open } = memoPointerFixture('one\ntwo\nthree\nfour\nfive\nsix', {
      getKeyboardPreferences: () => ({ predictionEnabled: true }),
      predict: () => ['x', 'xyz'],
    });
    open();
    create.keyInput('x');
    create.advance(15);
    let result = rendered();
    const text = result.renderer.bounds.get('scene-create-body:T_Letter');
    const lineTop = transform(text.matrix, 0, -5 * 42)[1];
    const prediction = result.renderer.rect('keyboard-prediction:N_prdcTextArea');
    assert.ok(228 - lineTop + 32 <= prediction.y, 'the complete last glyph clears the strip');
    for (let index = 0; index < 5; index++) create.keyInput('Backspace');
    create.advance(15);
    assert.equal(create.snapshot().memoText, 'one\ntwo\nthree\nfour\nfive');
    assert.equal(create.snapshot().memoScroll.offset, 126);
    assert.equal(create.snapshot().memoScroll.offset % 42, 0);
    result = rendered();
    assert.ok(result.controls.some((control) => control.id === 'memo-scroll-up'));
  });

test('the bottommost editor Up button keeps a matching hit region and hover through release',
  { skip: !available }, () => {
    const { create, rendered, open } = memoPointerFixture('one\ntwo\nthree\nfour\nfive\nsix');
    open();
    const arrow = rendered().controls.find((control) => control.id === 'memo-scroll-up');
    const point = { x: arrow.rect.x + arrow.rect.w / 2, y: arrow.rect.y + arrow.rect.h / 2 };
    create.hover(arrow.id);
    create.advance(6);
    const scale = () => rendered().renderer.bounds.get('scene-create-body:P_txtScrll_UP').pane.scale[0];
    const hovered = scale();
    assert.ok(hovered > 1.1);
    assert.equal(create.holdControl(arrow.id), true);
    create.releaseControl();
    create.advance(15);
    assert.equal(scale(), hovered);
    const routed = routeKeyboardTextPointer(point, rendered().controls, () => false);
    assert.equal(routed.control.id, arrow.id);
    assert.equal(isPersistentArrowControl(`scene-${arrow.id}`), true,
      'host pointer-capture release preserves hover while still inside');
    create.hover(null);
    create.advance(8);
    assert.equal(scale(), 1);
  });
