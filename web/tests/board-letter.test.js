import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createBoardLetter, LOCAL_LETTER_MAX_LENGTH } from '../src/board-letter.js';
import { CREATE_LAYOUTS, createBoardCreate } from '../src/board-create.js';
import { indexLayout, poseLayout, transform } from '../src/animation.js';
import { BitmapFont } from '../src/font.js';
import { Renderer } from '../src/renderer.js';
import { createDisplay } from '../src/display.js';
import { routeKeyboardTextPointer } from '../src/keyboard-text-hit.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && CREATE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available ? Object.fromEntries(CREATE_LAYOUTS.map((key) =>
  [key, JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl)))],
)) : {};
const sourceTest = { skip: !available };
const recipient = { kind: 'wii', address: '1234567812345678', nickname: 'Synthetic' };
const attachment = {
  id: 'fixture-photo', width: 512, height: 256,
  localSrc: '/assets/local-letters/fixture-photo.png', sha256: 'a'.repeat(64),
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const body = (letter) => letter.presentation().layers.find((layer) => layer.prefix === 'letter-body:').layout;

test('Letter disposal suppresses completed and failed local-save callbacks after removal',
  sourceTest, async () => {
    for (const outcome of ['resolve', 'reject']) {
      let settle;
      const events = [];
      const letter = createBoardLetter(layouts, {
        recipient, draft: 'Retained draft',
        onLetter: () => new Promise((resolve, reject) => {
          settle = outcome === 'resolve' ? resolve : reject;
        }),
        onDraft: (value) => events.push(['draft', value]),
        onDone: (value) => events.push(['done', value]),
        onLetterError: (error) => events.push(['error', error]),
        onSound: (sound) => events.push(['sound', sound]),
      });
      letter.advance(17);
      letter.activate('submit');
      letter.advance(21);
      await flush();
      letter.advance(211);
      assert.equal(letter.snapshot().phase, 'saving');
      const before = [...events];
      letter.dispose();
      letter.dispose();
      settle(new Error('Late synthetic result'));
      await flush();
      letter.advance(1000);
      assert.deepEqual(events, before, outcome);
      assert.equal(letter.snapshot().closed, true);
      assert.equal(letter.snapshot().text, 'Retained draft');
      assert.equal(letter.activate('submit'), false);
      assert.equal(letter.back(), false);
    }
  });

test('Letter disposal before the save microtask prevents starting a local write',
  sourceTest, async () => {
    let writes = 0;
    const letter = createBoardLetter(layouts, {
      recipient, draft: 'Not dispatched', onLetter: async () => { writes++; },
    });
    letter.advance(17);
    letter.activate('submit');
    letter.advance(21);
    letter.dispose();
    await flush();
    assert.equal(writes, 0);
  });

test('Letter uses its original four-line body, text-only controls and input marker ownership', sourceTest, () => {
  const original = JSON.stringify(layouts);
  const letter = createBoardLetter(layouts, { recipient, draft: 'one\ntwo\nthree\nfour\nfive' });
  letter.advance(17);
  let panes = indexLayout(body(letter)).panes;
  assert.equal(panes.get('T_Header').text, 'Sending the message\nto Synthetic.');
  assert.equal(panes.get('N_Footer').translation[1], -168);
  assert.ok(panes.has('LetterBodyRow1'));
  assert.ok(!panes.has('LetterBodyRow2'));
  assert.equal(panes.get('N_Pic').flags & 1, 0);
  assert.equal(panes.get('SendPic').flags & 1, 0);
  assert.ok(!letter.controls().some((control) => /pic|attach/.test(control.id)));
  assert.equal(letter.activate('letter-edit'), true);
  letter.advance(30);
  panes = indexLayout(body(letter)).panes;
  assert.equal(panes.get('T_Letter').showLineFeeds, true);
  assert.equal(letter.keyInput('x'), true);
  letter.activate('key-ok');
  letter.advance(30);
  assert.equal(letter.snapshot().text, 'one\ntwo\nthree\nfour\nfivex');
  assert.equal(indexLayout(body(letter)).panes.get('T_Letter').showLineFeeds, undefined);
  assert.equal(JSON.stringify(layouts), original);
});

test('Letter photo attachment uses the local descriptor and sends it with the draft',
  sourceTest, async () => {
    const calls = [];
    const letter = createBoardLetter(layouts, {
      recipient, attachments: [attachment], onLetter: async (payload) => calls.push(payload),
    });
    letter.advance(17);
    assert.equal(letter.controls().find(({ id }) => id === 'letter-photo').label, 'Attach a photo');
    assert.equal(letter.activate('letter-photo'), true);
    letter.advance(14);
    assert.deepEqual(letter.snapshot().attachment, attachment);
    const presented = body(letter);
    const panes = indexLayout(presented).panes;
    assert.equal(presented.textures.at(-1).url, attachment.localSrc);
    assert.equal(panes.get('SendPic').flags & 1, 0);
    assert.equal(letter.controls().find(({ id }) => id === 'letter-photo').label, 'Remove photo');
    assert.equal(letter.activate('submit'), true);
    letter.advance(21);
    await flush();
    assert.deepEqual(calls, [{
      id: calls[0].id, recipient, text: '', attachment,
    }]);
  });

test('Letter picker exposes every verified local photo and selects the requested asset',
  sourceTest, () => {
    const second = {
      id: 'second-photo', width: 320, height: 240,
      localSrc: '/assets/local-letters/second-photo.png', sha256: 'b'.repeat(64),
    };
    const letter = createBoardLetter(layouts, {
      recipient, attachments: [attachment, second], onSound: () => {},
    });
    letter.advance(17);
    assert.equal(letter.activate('letter-photo'), true);
    assert.equal(letter.snapshot().pickerOpen, true);
    assert.deepEqual(letter.controls().map(({ id }) => id), [
      'letter-attachment-0', 'letter-attachment-1', 'letter-picker-cancel',
    ]);
    const picker = indexLayout(body(letter));
    assert.ok(picker.panes.has('LetterPicker_0'));
    assert.ok(picker.panes.has('LetterPicker_1'));
    assert.deepEqual(letter.presentation().layers[0].layout.textures.slice(-2).map(
      ({ url }) => url,
    ), [attachment.localSrc, second.localSrc]);
    assert.equal(letter.activate('letter-attachment-1'), true);
    assert.equal(letter.snapshot().pickerOpen, false);
    assert.deepEqual(letter.snapshot().attachment, second);
  });

test('Letter leaves accepted text intact on Back and uses the original empty-Mii notice', sourceTest, () => {
  const finished = [];
  const letter = createBoardLetter(layouts, { recipient, draft: 'Keep this', onDone: (state) => finished.push(state) });
  letter.advance(17);
  letter.activate('letter-mii');
  letter.advance(25);
  assert.equal(letter.snapshot().modal, true);
  assert.equal(letter.activate('submit'), false);
  const dialog = letter.presentation().layers.at(-1).layout;
  assert.match(indexLayout(dialog).panes.get('T_Dialog').text, /No Miis have been registered/);
  letter.back();
  letter.advance(38);
  assert.equal(letter.snapshot().text, 'Keep this');
  assert.equal(letter.back(), true);
  letter.advance(16);
  assert.deepEqual(finished, []);
  letter.advance(1);
  assert.deepEqual(finished, [{ sent: false }]);
  assert.equal(letter.snapshot().text, 'Keep this');
});

test('Letter footer rollout continues independently when another control gains focus', sourceTest, () => {
  const letter = createBoardLetter(layouts, { recipient, draft: 'Text' });
  letter.advance(17);
  const scale = (name) => indexLayout(letter.presentation().layers.find(
    (layer) => layer.prefix === 'letter-footer:',
  ).layout).panes.get(name).scale[0];
  letter.hover('submit');
  letter.advance(6);
  const focused = scale('N_BtnL_a7_Add_R');
  letter.hover('back');
  letter.advance(4);
  const retiring = scale('N_BtnL_a7_Add_R');
  assert.notEqual(retiring, focused);
  letter.advance(4);
  assert.equal(scale('N_BtnL_a7_Add_R'), 1);
  assert.notEqual(scale('N_BtnL_a3_Cal'), 1);
});

test('Letter editor scroll focus emits one shared input-form cue per pointer entry', sourceTest, () => {
  const sounds = [];
  const letter = createBoardLetter(layouts, {
    recipient, draft: 'one\ntwo\nthree\nfour\nfive\nsix', onSound: (name) => sounds.push(name),
  });
  letter.advance(17);
  letter.activate('letter-edit');
  letter.advance(30);
  letter.advance(15);
  letter.advance(11);
  sounds.length = 0;
  assert.equal(letter.hover('letter-scroll-up'), true);
  letter.advance(6);
  const hoveredScale = indexLayout(body(letter)).panes.get('P_txtScrll_UP').scale[0];
  assert.ok(hoveredScale > 1);
  letter.hover('letter-scroll-up');
  assert.equal(letter.holdControl('letter-scroll-up'), true);
  letter.releaseControl();
  letter.advance(15);
  assert.equal(indexLayout(body(letter)).panes.get('P_txtScrll_UP').scale[0], hoveredScale);
  assert.deepEqual(sounds.filter((name) => name === 'WIPL_SE_CHAR_FOCUS'), ['WIPL_SE_CHAR_FOCUS']);
  letter.hover(null);
  letter.advance(8);
  assert.equal(indexLayout(body(letter)).panes.get('P_txtScrll_UP').scale[0], 1);
  letter.hover('letter-scroll-up');
  letter.hover('letter-scroll-down');
  assert.deepEqual(sounds.filter((name) => name === 'WIPL_SE_CHAR_FOCUS'),
    Array(3).fill('WIPL_SE_CHAR_FOCUS'));
  letter.hover(null);
  letter.hover('letter-scroll-unavailable');
  assert.equal(sounds.filter((name) => name === 'WIPL_SE_CHAR_FOCUS').length, 3);
});

test('Reply keeps the entered footer while MailIn still animates the Letter body', sourceTest, () => {
  const reply = createBoardLetter(layouts, { recipient, draft: 'Text', footerAlreadyEntered: true });
  const address = createBoardLetter(layouts, { recipient, draft: 'Text' });
  const source = layouts.my_IplTop_e;
  const expected = indexLayout(poseLayout(source, [{
    animation: source.animations.my_IplTop_e,
    group: 'G_SeenChange', frame: 3326, loop: false,
  }])).panes;
  const footer = (letter) => indexLayout(letter.presentation().layers.find(
    ({ prefix }) => prefix === 'letter-footer:',
  ).layout).panes;
  const initialBody = body(reply);
  for (let frame = 0; frame <= 17; frame++) {
    assert.deepEqual(body(reply), body(address), `MailIn ${frame} is independent of footer ownership`);
    for (const name of source.groups.G_SeenChange) {
      assert.deepEqual(footer(reply).get(name).translation, expected.get(name).translation, name);
      assert.equal(footer(reply).get(name).alpha, expected.get(name).alpha, name);
    }
    if (frame === 0) assert.notDeepEqual(footer(reply).get('N_BtnL_a3').translation,
      footer(address).get('N_BtnL_a3').translation, 'Address still starts command 15');
    if (frame === 17) assert.notDeepEqual(body(reply), initialBody, 'MailIn has advanced');
    reply.advance(1);
    address.advance(1);
  }
});

test('Letter footer retains the completed common-arrow exit while its child owns input', sourceTest, () => {
  const letter = createBoardLetter(layouts, { recipient, draft: 'Text' });
  const source = layouts.my_IplTop_e;
  const hidden = indexLayout(poseLayout(source, ['L', 'R'].map((side) => ({
    animation: source.animations.my_IplTop_e,
    group: `G_Arw${side}_End`, frame: 10110, loop: false,
  })))).panes;
  for (const frames of [0, 17, 50]) {
    letter.advance(frames);
    const footer = indexLayout(letter.presentation().layers.find(
      (layer) => layer.prefix === 'letter-footer:',
    ).layout).panes;
    for (const name of ['N_ArwL_End', 'N_ArwR__End']) {
      assert.deepEqual(footer.get(name).translation, hidden.get(name).translation);
      assert.notDeepEqual(footer.get(name).translation, indexLayout(source).panes.get(name).translation);
    }
    assert.ok(!letter.controls().some(({ id }) => id.startsWith('address-')));
  }
});

test('Letter waits for its source SendOut and asynchronous local commit, with a stable retry id', sourceTest, async () => {
  const calls = [];
  const errors = [];
  const finished = [];
  let reject;
  let resolve;
  const letter = createBoardLetter(layouts, {
    recipient, draft: 'Local only', createId: () => 'synthetic-attempt',
    onLetter: (payload) => {
      calls.push(payload);
      return new Promise((yes, no) => { resolve = yes; reject = no; });
    },
    onLetterError: (error) => errors.push(error.message), onDone: (state) => finished.push(state),
  });
  letter.advance(17);
  letter.activate('submit');
  letter.advance(20);
  await flush();
  assert.deepEqual(calls, []);
  letter.advance(1);
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { id: 'synthetic-attempt', recipient, text: 'Local only', attachment: null });
  assert.equal(letter.snapshot().duration, 211, 'composer package differs from the 63-update Board reader');
  assert.equal(letter.activate('submit'), false);
  letter.advance(211);
  assert.equal(letter.snapshot().phase, 'saving');
  assert.deepEqual(finished, []);
  reject(new Error('Synthetic storage failure'));
  await flush();
  assert.equal(letter.snapshot().phase, 'return');
  letter.advance(19);
  assert.equal(letter.snapshot().text, 'Local only');
  assert.deepEqual(errors, ['Synthetic storage failure']);
  letter.activate('submit');
  letter.advance(21);
  await flush();
  assert.equal(calls[1].id, calls[0].id);
  resolve();
  await flush();
  letter.advance(210);
  assert.deepEqual(finished, []);
  letter.advance(1);
  assert.deepEqual(finished, [{ sent: true }]);
  assert.equal(letter.snapshot().text, '');
});

test('editing after a failed save starts a new id and respects the conservative UTF-16 bound', sourceTest, async () => {
  const ids = [];
  let sequence = 0;
  const letter = createBoardLetter(layouts, {
    recipient, draft: 'x'.repeat(LOCAL_LETTER_MAX_LENGTH),
    createId: () => `attempt-${++sequence}`,
    onLetter: async ({ id }) => { ids.push(id); throw new Error('Synthetic failure'); },
  });
  letter.advance(17);
  letter.activate('letter-edit');
  letter.advance(30);
  letter.keyInput('x');
  assert.equal(letter.snapshot().text.length, LOCAL_LETTER_MAX_LENGTH);
  letter.activate('key-ok');
  letter.advance(30);
  letter.activate('submit');
  letter.advance(21);
  await flush();
  letter.advance(230);
  letter.activate('letter-edit');
  letter.advance(30);
  letter.keyInput('Backspace');
  letter.activate('key-ok');
  letter.advance(30);
  letter.activate('submit');
  letter.advance(21);
  await flush();
  assert.deepEqual(ids, ['attempt-1', 'attempt-2']);
});

test('explicit local contact Send opens Letter and preserves a cancelled draft on reopen', sourceTest, () => {
  const create = createBoardCreate(layouts, { contacts: [recipient], letterService: 'local' });
  create.advance(39);
  create.activate('address');
  create.advance(29);
  create.activate('address-next');
  create.advance(15);
  create.activate('address-entry-0');
  create.advance(53);
  create.activate('address-send');
  create.advance(21 + 19);
  assert.equal(create.snapshot().page, 'letter');
  assert.equal(create.snapshot().letter.frame, 0, 'new child starts on its creation boundary');
  create.advance(17);
  create.activate('letter-edit');
  create.advance(30);
  for (const character of 'Draft') create.keyInput(character);
  create.activate('key-ok');
  create.advance(30);
  create.back();
  create.advance(17 + 19);
  assert.equal(create.snapshot().page, 'address');
  create.advance(19);
  create.activate('address-send');
  create.advance(40);
  assert.equal(create.snapshot().letter.text, 'Draft');
  assert.equal(create.snapshot().networkDialog, false);
});

test('Letter opens from its displayed text at the selected character and retains a two-line viewport',
  sourceTest, () => {
    const font = new BitmapFont({
      width: 20, height: 32, lineFeed: 32, baseline: 26, ascent: 26,
      characters: {}, glyphs: [{ advance: 16 }], defaultGlyph: 0, sheets: [],
    }, {});
    const display = createDisplay();
    const letter = createBoardLetter(layouts, {
      recipient, draft: 'one\ntwo\nthree\nfour\nfive\nsix', display,
      measureTextLayout: (text, pane) => font.layoutPaneText(text, pane),
      measureTextLines: (text, pane) => font.layoutPaneText(text, pane).lines.length,
    });
    letter.advance(17);
    const renderer = Object.create(Renderer.prototype);
    renderer.display = display;
    renderer.bounds = new Map();
    renderer.quad = () => {};
    renderer.window = () => {};
    const view = letter.presentation();
    for (const layer of view.layers) renderer.draw(layer.layout, { ...layer });
    const bound = renderer.bounds.get('letter-body:T_Letter');
    const line = font.layoutPaneText(bound.pane.text, bound.pane).lines[1];
    const [x, y] = transform(bound.matrix, line.carets[1].x, line.y - 14);
    const point = { x: display.halfWidth + x, y: display.halfHeight - y };
    const controls = view.controls.map((control) => ({
      ...control, rect: renderer.rect(control.prefix + control.pane),
    }));
    assert.equal(routeKeyboardTextPointer(point, controls,
      (location) => letter.selectTextAt(location)).selected, true);
    letter.advance(30);
    letter.advance(15);
    assert.equal(letter.keyInput('X'), true);
    assert.equal(letter.snapshot().text, 'one\ntXwo\nthree\nfour\nfive\nsix');
    assert.equal(indexLayout(body(letter)).panes.get('T_2l_TextBox').size[1], 84);
  });
