import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  fitIncomingPhoto, validateIncomingLetter, validateIncomingLetterFixture, validateIncomingPhoto,
} from '../src/incoming-letter-fixture.js';
import { createIncomingLetterReader, INCOMING_LETTER_LAYOUTS } from '../src/incoming-letter-reader.js';
import { createMemoScrollArrows } from '../src/memo-scroll-arrows.js';
import { indexLayout, poseLayout } from '../src/animation.js';

const sender = { kind: 'wii', nickname: 'Synthetic', address: '1234567812345678' };
const photo = { id: 'synthetic-photo', width: 512, height: 256,
  localSrc: '/assets/local-letters/synthetic-photo.png', sha256: 'a'.repeat(64) };
const record = (overrides = {}) => ({
  kind: 'letter', id: 'synthetic-letter', createdAt: '2026-01-02T03:04:05Z',
  header: 'Synthetic sender', text: 'Local incoming text', sender: { ...sender }, photo: null,
  ...overrides,
});
const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && INCOMING_LETTER_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available ? Object.fromEntries(INCOMING_LETTER_LAYOUTS.map((key) =>
  [key, JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl)))],
)) : {};
const sourceTest = { skip: !available };
const layer = (reader, prefix) => reader.presentation().layers
  .find((entry) => entry.prefix === prefix)?.layout;
const body = (reader) => layer(reader, 'incoming-letter:');
const footer = (reader) => layer(reader, 'incoming-letter-footer:');
const fields = (pane) => ({ translation: pane.translation, rotation: pane.rotation,
  scale: pane.scale, size: pane.size, alpha: pane.alpha, flags: pane.flags });
const assertFooterReservation = (reader, frame) => {
  const source = layouts.my_IplTop_e;
  const expected = indexLayout(poseLayout(source, [{
    animation: source.animations.my_IplTop_e, group: 'G_SeenChange', frame, loop: false,
  }])).panes;
  const actual = indexLayout(footer(reader)).panes;
  for (const name of ['N_Dust', 'N_BtnL_a3_Cal', 'N_BtnL_a7_Add_R'])
    assert.deepEqual(actual.get(name).translation, expected.get(name).translation, name);
};

const chooseErase = (reader, accepted = true) => {
  assert.equal(reader.activate('incoming-trash'), true);
  reader.advance(33);
  reader.advance(layouts.my_DialogWindow_b.animations.my_DialogWindow_b_DialogIn.frames);
  assert.equal(reader.activate(accepted ? 'memo-erase-yes' : 'memo-erase-no'), true);
  reader.advance(100);
};

test('incoming Trash uses the original press, footer reservation and cancelable two-button dialog',
  sourceTest, () => {
    const before = structuredClone(layouts);
    const sounds = [];
    let erased = 0;
    const reader = createIncomingLetterReader(layouts, {
      record: record({ photo }), onErase: () => erased++, onSound: (name) => sounds.push(name),
      messages: { 64: 'Original question', 46: 'Original OK', 37: 'Original Quit' },
    });
    reader.advance(26);
    reader.hover('incoming-trash');
    reader.advance(9);
    const dust = indexLayout(footer(reader)).panes.get('N_Dust');
    const expected = indexLayout(poseLayout(layouts.my_IplTop_e, [{
      animation: layouts.my_IplTop_e.animations.my_IplTop_e,
      group: 'G_Dust', frame: 2909, loop: false,
    }])).panes.get('N_Dust');
    assert.deepEqual(dust.scale, expected.scale);
    assert.equal(reader.activate('incoming-trash'), true);
    assert.equal(reader.activate('incoming-photo'), false);
    assert.equal(reader.activate('incoming-reply'), false);
    reader.advance(20);
    assertFooterReservation(reader, 3660);
    reader.advance(12);
    assert.equal(reader.snapshot().eraseDialog, null);
    assertFooterReservation(reader, 3672);
    reader.advance(1);
    assert.equal(reader.snapshot().eraseDialog.phase, 'enter');
    assertFooterReservation(reader, 3673);
    const dialog = reader.presentation().layers.at(-1).layout;
    const text = indexLayout(dialog).panes;
    assert.equal(text.get('T_Dialog').text, 'Original question');
    assert.equal(text.get('T_BtnA').text, 'Original Quit');
    assert.equal(text.get('T_BtnB').text, 'Original OK');
    reader.advance(100);
    assert.equal(reader.snapshot().locked, false);
    assert.equal(reader.back(), true);
    reader.advance(100);
    assert.equal(reader.snapshot().phase, 'trash-cancel');
    assertFooterReservation(reader, 3640);
    reader.advance(13);
    assertFooterReservation(reader, 3653);
    assert.equal(reader.controls().find(({ id }) => id === 'incoming-photo').disabled, false);
    assert.equal(erased, 0);
    assert.deepEqual(sounds, ['WIPL_SE_BOARD_SELECT', 'WIPL_SE_BT_TARGETTING',
      'WIPL_SE_BT_PUSH', 'WIPL_SE_INFO_WINDOW', 'WIPL_SE_CANCEL']);
    assert.deepEqual(layouts, before);
  });

test('outbox Letters render as read-only records without an incoming Trash control',
  sourceTest, () => {
    const reader = createIncomingLetterReader(layouts, {
      record: record({ id: 'outbox-sent', origin: 'outbox', sender: null, replyAllowed: false }),
      onErase: () => { throw new Error('outbox records must not erase through incoming storage'); },
    });
    reader.advance(30);
    assert.ok(!reader.controls().some(({ id }) => id === 'incoming-trash'));
    assert.ok(reader.controls().some(({ id }) => id === 'incoming-back'));
  });

test('incoming erase keeps exit and durable completion independent in either order',
  sourceTest, async () => {
    for (const commitFirst of [true, false]) {
      let resolve;
      const calls = [];
      const pending = new Promise((done) => { resolve = done; });
      const reader = createIncomingLetterReader(layouts, {
        record: record(), origin: [100, 80, 0],
        onErase: (id) => { calls.push(['commit', id]); return pending; },
        onErased: (id) => calls.push(['removed', id]),
      });
      reader.advance(26);
      chooseErase(reader);
      assert.equal(reader.snapshot().phase, 'erase-close');
      assert.deepEqual(calls, [['commit', record().id]]);
      if (commitFirst) { resolve(); await Promise.resolve(); }
      reader.advance(8);
      const position = body(reader).root.translation;
      assert.ok(Math.abs(position[0] - 100 * 8 / 17) < 1e-10);
      assert.ok(Math.abs(position[1] - 80 * 8 / 17) < 1e-10);
      assertFooterReservation(reader, 3434);
      assert.equal(reader.back(), false);
      reader.advance(100);
      if (!commitFirst) {
        assert.equal(reader.snapshot().phase, 'erase-wait');
        assert.equal(reader.snapshot().closed, false);
        assert.equal(calls.length, 1);
        resolve();
        await Promise.resolve();
      }
      assert.equal(reader.snapshot().closed, true);
      assert.deepEqual(calls, [['commit', record().id], ['removed', record().id]]);
      reader.advance(100);
      assert.equal(calls.length, 2);
    }
  });

test('failed incoming erase restores the same reader and supports a new attempt',
  sourceTest, async () => {
    let reject;
    let attempts = 0;
    const errors = [];
    const removed = [];
    const reader = createIncomingLetterReader(layouts, {
      record: record({ text: 'line\n'.repeat(30) }),
      onErase: () => ++attempts === 1 ? new Promise((resolve, fail) => { reject = fail; }) : undefined,
      onEraseError: (error) => errors.push(error.message), onErased: (id) => removed.push(id),
    });
    reader.advance(26);
    reader.activate('incoming-scroll-down');
    reader.advance(21);
    const scroll = reader.snapshot().scroll;
    chooseErase(reader);
    reader.advance(100);
    reject(new Error('Synthetic disk failure'));
    await Promise.resolve();
    assert.equal(reader.snapshot().phase, 'trash-cancel');
    assert.equal(reader.snapshot().scroll, scroll);
    assert.deepEqual(body(reader).root.translation, [0, 0, 0]);
    reader.advance(13);
    assert.equal(reader.controls().find(({ id }) => id === 'incoming-trash').disabled, false);
    assert.deepEqual(errors, ['Synthetic disk failure']);
    assert.deepEqual(removed, []);
    chooseErase(reader);
    await Promise.resolve();
    reader.advance(100);
    assert.deepEqual(removed, [record().id]);
  });

test('photo mode and disposed erase attempts cannot dispatch further erasure effects',
  sourceTest, async () => {
    const effects = [];
    let reject;
    const reader = createIncomingLetterReader(layouts, {
      record: record({ photo }),
      onErase: () => new Promise((resolve, fail) => { reject = fail; }),
      onEraseError: () => effects.push('error'), onErased: () => effects.push('removed'),
    });
    reader.advance(26);
    reader.activate('incoming-photo');
    reader.advance(100);
    assert.equal(reader.activate('incoming-trash'), false);
    assert.equal(reader.controls().some(({ id }) => id === 'incoming-trash'), false);
    reader.back();
    reader.advance(100);
    chooseErase(reader);
    reader.dispose();
    reject(new Error('Late failure'));
    await Promise.resolve();
    reader.advance(100);
    assert.deepEqual(effects, []);
    assert.deepEqual(reader.controls(), []);
  });

test('incoming fixture validation produces detached bounded local-only records', () => {
  const input = record({ photo: { ...photo, privatePath: '/not-exported' }, privateNote: 'discard' });
  const fixture = validateIncomingLetterFixture({ version: 1, letters: [input] });
  assert.equal(fixture.letters[0].createdAt, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(fixture.letters[0].photo, photo);
  assert.equal(fixture.letters[0].privateNote, undefined);
  fixture.letters[0].sender.nickname = 'Changed';
  fixture.letters[0].photo.width = 1;
  assert.equal(input.sender.nickname, 'Synthetic');
  assert.equal(input.photo.width, 512);
  assert.equal(validateIncomingLetter(record({ text: '', photo })).text, '');
  assert.throws(() => validateIncomingLetter(record({ text: '' })), /text or a photo/);
  assert.throws(() => validateIncomingLetterFixture({
    version: 1, letters: [record(), record()],
  }), /Duplicate/);
  assert.throws(() => validateIncomingLetterFixture({
    version: 1, letters: Array(201).fill(record()),
  }), /200/);
});

test('incoming fixtures reject external images, invalid identities and oversized UTF-16 records', () => {
  for (const localSrc of ['https://example.test/photo.png', '/assets/local-letters/../private.png',
    '/assets/local-letters/synthetic-photo.png?alternate=1']) {
    assert.throws(() => validateIncomingPhoto({ ...photo, localSrc }), /prepared local asset/);
  }
  for (const overrides of [{ width: 513 }, { height: 457 }, { width: 0 }, { width: 1.5 },
    { sha256: 'not-a-hash' }, { id: '__proto__' }]) {
    assert.throws(() => validateIncomingPhoto({ ...photo, ...overrides }), /bounded dimensions/);
  }
  for (const overrides of [{ id: 'constructor' }, { text: 'a'.repeat(1024) },
    { text: '😀'.repeat(512) }, { header: 'a'.repeat(257) }, { createdAt: 'invalid' },
    { text: 'embedded\0nul' }, { sender: { ...sender, address: 'not-a-Wii-number' } }]) {
    assert.throws(() => validateIncomingLetter(record(overrides)));
  }
});

test('incoming Reply policy preserves old records and requires an explicit absent sender', () => {
  const normal = validateIncomingLetter(record());
  assert.deepEqual(validateIncomingLetter(record({ replyAllowed: true })), normal);
  assert.deepEqual(validateIncomingLetter(record({ replyAllowed: false })),
    { ...normal, replyAllowed: false });
  assert.deepEqual(validateIncomingLetter(record({ sender: null })), { ...normal, sender: null });
  assert.deepEqual(validateIncomingLetter(record({ sender: null, replyAllowed: false })),
    { ...normal, sender: null, replyAllowed: false });
  assert.throws(() => validateIncomingLetter(record({ sender: undefined })));
  assert.throws(() => validateIncomingLetter(record({ sender: null, replyAllowed: true })),
    /without a sender/);
  for (const replyAllowed of [null, 0, 1, 'false', {}, []]) {
    assert.throws(() => validateIncomingLetter(record({ replyAllowed })), /boolean/);
  }
});

test('non-replyable Letters use native footer reservations and cannot dispatch Reply',
  sourceTest, () => {
    for (const policy of [{ sender: null }, { replyAllowed: false }]) {
      const effects = [];
      const reader = createIncomingLetterReader(layouts, {
        record: record(policy), letterService: 'local',
        onReply: () => effects.push('reply'), onServiceRequired: () => effects.push('service'),
        onBack: () => effects.push('back'), onSound: (name) => effects.push(name),
      });
      assertFooterReservation(reader, 3100);
      reader.advance(13);
      assertFooterReservation(reader, 3600);
      reader.advance(13);
      assertFooterReservation(reader, 3613);
      assert.equal(reader.controls().some(({ id }) => id === 'incoming-reply'), false);
      assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, '');
      assert.equal(reader.hover('incoming-reply'), false);
      assert.equal(reader.activate('incoming-reply'), false);
      assert.deepEqual(effects, ['WIPL_SE_BOARD_SELECT']);
      assert.equal(reader.back(), true);
      reader.advance(21);
      assertFooterReservation(reader, 3620);
      reader.advance(13);
      assertFooterReservation(reader, 3426);
      reader.advance(13);
      assert.equal(reader.snapshot().closed, true);
      assert.deepEqual(effects, ['WIPL_SE_BOARD_SELECT', 'WIPL_SE_BOARD_UNSELECT', 'back']);
    }
  });

test('photo return and cancelled or failed erase retain the non-replyable Letter footer',
  sourceTest, async () => {
    const original = structuredClone(layouts);
    const errors = [];
    const reader = createIncomingLetterReader(layouts, {
      record: record({ sender: null, photo }),
      onErase: () => Promise.reject(new Error('Synthetic disk failure')),
      onEraseError: (error) => errors.push(error.message),
    });
    reader.advance(26);
    assert.equal(reader.activate('incoming-photo'), true);
    reader.advance(13);
    assertFooterReservation(reader, 3633);
    reader.advance(14);
    assertFooterReservation(reader, 3326);
    assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, 'Send');
    assert.equal(reader.activate('incoming-photo-send'), false);
    reader.back();
    reader.advance(34);
    assertFooterReservation(reader, 3600);
    reader.advance(13);
    assertFooterReservation(reader, 3613);
    assert.equal(reader.controls().some(({ id }) => id === 'incoming-reply'), false);
    assert.equal(reader.activate('incoming-trash'), true);
    reader.advance(20);
    assertFooterReservation(reader, 3620);
    reader.advance(13);
    assertFooterReservation(reader, 3633);
    reader.advance(100);
    reader.back();
    reader.advance(100);
    assertFooterReservation(reader, 3600);
    reader.advance(13);
    assertFooterReservation(reader, 3613);
    assert.deepEqual(errors, []);
    chooseErase(reader);
    await Promise.resolve();
    assert.equal(reader.snapshot().phase, 'trash-cancel');
    assertFooterReservation(reader, 3600);
    reader.advance(13);
    assertFooterReservation(reader, 3613);
    assert.equal(reader.controls().some(({ id }) => id === 'incoming-reply'), false);
    assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, '');
    assert.deepEqual(errors, ['Synthetic disk failure']);
    assert.deepEqual(layouts, original);
  });

test('incoming photo fitting preserves the full landscape or portrait image', () => {
  assert.deepEqual(fitIncomingPhoto(photo, [412, 309]), [412, 206]);
  const portrait = fitIncomingPhoto({ ...photo, width: 256, height: 456 }, [412, 309]);
  assert.equal(portrait[1], 309);
  assert.ok(Math.abs(portrait[0] / portrait[1] - 256 / 456) < Number.EPSILON);
  assert.throws(() => fitIncomingPhoto(photo, [0, 309]), /positive/);
});

test('incoming photo and Reply mask draw after the arrows with their original ancestor transforms',
  sourceTest, () => {
    const reader = createIncomingLetterReader(layouts, {
      record: record({ photo }), origin: [100, 80, 0],
    });
    reader.advance(26);
    reader.activate('incoming-photo');
    reader.advance(7);
    const view = reader.presentation();
    const bodyLayers = view.layers.filter(({ prefix }) => prefix === 'incoming-letter:');
    assert.equal(bodyLayers.length, 2);
    const [base, overlay] = bodyLayers;
    const original = indexLayout(base.layout).panes;
    const overlaid = indexLayout(overlay.layout).panes;
    for (const name of ['RootPane', 'N_Memo', 'N_MemoRoot', 'PicMask', 'N_Pic', 'Pic', 'ReplyMask'])
      assert.deepEqual(fields(overlaid.get(name)), fields(original.get(name)), name);
    const drawOrder = [];
    for (const { layout, exclude = new Set() } of bodyLayers) {
      const visit = (pane) => {
        if (!(pane.flags & 1) || exclude.has(pane.name)) return;
        drawOrder.push(pane.name);
        for (const child of pane.children || []) visit(child);
      };
      visit(layout.root);
    }
    for (const name of ['T_Letter', 'N_TopBtn', 'PicMask', 'N_Pic', 'ReplyMask'])
      assert.equal(drawOrder.filter((value) => value === name).length, 1, name);
    assert.ok(drawOrder.indexOf('T_Letter') < drawOrder.indexOf('N_TopBtn'));
    assert.ok(drawOrder.indexOf('N_TopBtn') < drawOrder.indexOf('PicMask'));
    assert.ok(drawOrder.indexOf('PicMask') < drawOrder.indexOf('N_Pic'));
    assert.ok(drawOrder.indexOf('N_Pic') < drawOrder.indexOf('ReplyMask'));
    assert.equal(view.layers.at(-1).prefix, 'incoming-letter-footer:');
  });

test('display-only Letter arrows do not bind missing editor resources', sourceTest, () => {
  assert.equal(layouts.my_LetterL.animations.my_LetterL_Foucus_IN, undefined);
  const arrows = createMemoScrollArrows(layouts.my_LetterL, {
    stem: 'my_LetterL', controlPrefix: 'incoming', allowEditing: false,
  });
  arrows.update({ previous: false, next: true }, false);
  arrows.advance(11);
  assert.deepEqual(arrows.controls().map(({ id }) => id), ['incoming-scroll-down']);
  assert.doesNotThrow(() => poseLayout(layouts.my_LetterL, arrows.clips()));
  assert.throws(() => arrows.update({ previous: true, next: true }, true), /no editor scroll/);
});

test('incoming reader uses original body groups, original strings and read-only controls', sourceTest, () => {
  const original = JSON.stringify(layouts);
  const input = record({ text: 'one\ntwo\nthree\nfour\nfive' });
  const reader = createIncomingLetterReader(layouts, { record: input });
  assert.equal(reader.snapshot().locked, true);
  assert.equal(reader.activate('incoming-reply'), false);
  reader.advance(26);
  const panes = indexLayout(body(reader)).panes;
  assert.equal(panes.get('T_Header').text, input.header);
  assert.equal(panes.get('T_Letter').text, input.text);
  assert.equal(panes.get('N_Footer').translation[1], -168);
  assert.ok(panes.has('IncomingRow1-N_Body'));
  assert.equal(panes.get('N_Pic').flags & 1, 0);
  assert.equal(panes.get('Nigaoe').flags & 1, 0);
  assert.equal(panes.get('SendPic').flags & 1, 0);
  assert.equal(reader.controls().find(({ id }) => id === 'incoming-trash').disabled, true);
  assert.equal(reader.activate('incoming-trash'), false);
  assert.ok(!reader.controls().some(({ id }) => id === 'incoming-photo'));
  const footerPanes = indexLayout(footer(reader)).panes;
  assert.equal(footerPanes.get('T_CalAdd_R').text, 'Reply');
  for (const [group, name] of [['G_ArwL_End', 'N_ArwL_End'], ['G_ArwR_End', 'N_ArwR__End']]) {
    const expected = indexLayout(poseLayout(layouts.my_IplTop_e, [{
      animation: layouts.my_IplTop_e.animations.my_IplTop_e, group, frame: 10110, loop: false,
    }])).panes.get(name);
    assert.deepEqual(footerPanes.get(name).translation, expected.translation);
  }
  assert.equal(JSON.stringify(layouts), original);
  assert.equal(input.text, 'one\ntwo\nthree\nfour\nfive');
});

test('incoming photo zoom owns only G_Pic and returns to the same reader', sourceTest, () => {
  const original = JSON.stringify(layouts);
  const sounds = [];
  const reader = createIncomingLetterReader(layouts, {
    record: record({ photo }), letterService: 'local', onSound: (...args) => sounds.push(args),
  });
  reader.advance(50);
  const before = indexLayout(body(reader)).panes;
  reader.hover('incoming-photo');
  reader.advance(3);
  const focused = indexLayout(body(reader)).panes;
  for (const name of ['N_MemoRoot', 'N_Header', 'N_Body', 'T_Letter'])
    assert.deepEqual(fields(focused.get(name)), fields(before.get(name)), name);
  assert.equal(reader.activate('incoming-photo'), true);
  assert.ok(reader.controls().some(({ id }) => id.startsWith('incoming-scroll-')),
    'display arrows remain until SelectPic finishes');
  reader.advance(13);
  assert.equal(reader.snapshot().phase, 'photo-in');
  assertFooterReservation(reader, 3673);
  assert.equal(reader.back(), false);
  reader.advance(1);
  assert.equal(reader.snapshot().mode, 'photo');
  assert.equal(reader.snapshot().phase, 'photo-footer-in');
  assertFooterReservation(reader, 3313);
  assert.equal(reader.back(), false);
  reader.advance(13);
  assertFooterReservation(reader, 3326);
  const presented = body(reader);
  const panes = indexLayout(presented).panes;
  assert.deepEqual(panes.get('Pic').size, [412, 206]);
  assert.equal(presented.textures.at(-1).url, photo.localSrc);
  assert.equal(presented.materials[panes.get('Pic').material].textureMaps[0].texture,
    presented.textures.length - 1);
  assert.deepEqual(reader.controls().map(({ id }) => id), ['incoming-back', 'incoming-photo-send']);
  assert.equal(reader.activate('incoming-photo-send'), false);
  assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, 'Send');
  assert.equal(reader.back(), true);
  reader.advance(20);
  assert.equal(reader.snapshot().phase, 'back-press');
  assert.equal(reader.snapshot().mode, 'photo');
  reader.advance(1);
  assert.equal(reader.snapshot().phase, 'photo-out');
  assertFooterReservation(reader, 3413);
  reader.advance(13);
  assertFooterReservation(reader, 3640);
  reader.advance(13);
  assert.equal(reader.snapshot().mode, 'letter');
  assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, 'Reply');
  assert.equal(indexLayout(body(reader)).panes.get('T_Letter').text, 'Local incoming text');
  assert.deepEqual(sounds.filter(([name]) => name.includes('PIC_ZOOM')).map(([name]) => name),
    ['WIPL_SE_PIC_ZOOM_IN', 'WIPL_SE_PIC_ZOOM_OUT']);
  assert.equal(JSON.stringify(layouts), original);
});

test('local photo forwarding includes the verified attachment in the Reply payload', sourceTest, () => {
  const replies = [];
  const reader = createIncomingLetterReader(layouts, {
    record: record({ photo }), letterService: 'local', onReply: (value) => replies.push(value),
  });
  reader.advance(50);
  reader.activate('incoming-photo');
  reader.advance(27);
  reader.activate('incoming-photo-send');
  reader.advance(47);
  assert.deepEqual(replies, [{ recipient: sender, recordId: 'synthetic-letter', attachment: photo }]);
  assert.equal(reader.snapshot().mode, 'reply-child');
  assert.deepEqual(reader.controls(), []);
  assert.equal(reader.resumeReply(), true);
});

test('incoming Back finishes its original button press before closing the reader', sourceTest, () => {
  const sounds = [];
  let returns = 0;
  const reader = createIncomingLetterReader(layouts, {
    record: record(), onBack: () => returns++, onSound: (name) => sounds.push(name),
  });
  assert.deepEqual(sounds, ['WIPL_SE_BOARD_SELECT']);
  reader.advance(26);
  const before = fields(indexLayout(body(reader)).panes.get('N_MemoRoot'));
  assert.equal(reader.back(), true);
  reader.advance(20);
  assert.deepEqual(fields(indexLayout(body(reader)).panes.get('N_MemoRoot')), before);
  assert.equal(reader.snapshot().phase, 'back-press');
  assert.equal(reader.back(), false);
  assert.equal(returns, 0);
  reader.advance(1);
  assert.equal(reader.snapshot().phase, 'close');
  reader.advance(25);
  assert.equal(returns, 0);
  reader.advance(1);
  reader.advance(100);
  assert.equal(returns, 1);
  assert.equal(reader.snapshot().closed, true);
  assert.equal(sounds.at(-1), 'WIPL_SE_BOARD_UNSELECT');
});

test('incoming origin movement and common footer reservations keep independent clocks', sourceTest, () => {
  const origin = [170, -85, 0];
  const reader = createIncomingLetterReader(layouts, { record: record(), origin });
  origin[0] = -100;
  assert.deepEqual(body(reader).root.translation, [170, -85, 0]);
  assertFooterReservation(reader, 3100);
  reader.advance(8.5);
  assert.deepEqual(body(reader).root.translation, [85, -42.5, 0]);
  assertFooterReservation(reader, 3108.5);
  reader.advance(4.5);
  assertFooterReservation(reader, 3640);
  reader.advance(4);
  assert.deepEqual(body(reader).root.translation, [0, -0, 0]);
  assert.equal(reader.snapshot().locked, true, 'the footer still owns its reservation');
  reader.advance(9);
  assertFooterReservation(reader, 3653);
  assert.equal(reader.snapshot().locked, false);
  reader.back();
  reader.advance(21);
  assertFooterReservation(reader, 3660);
  reader.advance(8.5);
  assert.deepEqual(body(reader).root.translation, [85, -42.5, 0]);
  reader.advance(4.5);
  assertFooterReservation(reader, 3426);
  reader.advance(4);
  assert.deepEqual(body(reader).root.translation, [170, -85, 0]);
  assert.equal(reader.snapshot().closed, false);
  assert.throws(() => createIncomingLetterReader(layouts, { record: record(), origin: [0, NaN, 0] }),
    /finite coordinates/);
});

test('unavailable prepared photos preserve metadata and leave the text reader usable', sourceTest, () => {
  const input = record({ photo: { ...photo } });
  const original = structuredClone(input);
  const reader = createIncomingLetterReader(layouts, { record: input, photoAvailable: false });
  reader.advance(26);
  assert.equal(reader.activate('incoming-photo'), false);
  assert.ok(!reader.controls().some(({ id }) => id === 'incoming-photo'));
  const presented = body(reader);
  const panes = indexLayout(presented).panes;
  for (const name of ['N_Pic', 'B_Pic', 'PicMask']) assert.equal(panes.get(name).flags & 1, 0);
  assert.equal(panes.get('T_Letter').text, input.text);
  assert.equal(presented.textures.length, layouts.my_LetterL.textures.length);
  assert.deepEqual(input, original);
  assert.throws(() => createIncomingLetterReader(layouts, { record: input, photoAvailable: 'false' }),
    /photo availability/);
});

test('incoming reader keeps the native arrow-loop clock independent of focus', sourceTest, () => {
  const source = layouts.my_LetterL;
  const reader = createIncomingLetterReader(layouts, { record: record() });
  let previousAge = 0;
  for (const age of [26, 38, 50, 67]) {
    reader.advance(age - previousAge);
    previousAge = age;
    const expected = indexLayout(poseLayout(source, [{
      animation: source.animations.my_LetterL_Loop, group: 'G_ArwRoop', frame: age, loop: true,
    }])).panes;
    const presented = indexLayout(body(reader)).panes;
    for (const name of ['N_ArwR_Roop', 'N_ArwL_Roop'])
      assert.deepEqual(presented.get(name).translation, expected.get(name).translation);
    reader.hover('incoming-scroll-down');
  }
});

test('offline Reply preserves the reader and never dispatches a local child', sourceTest, () => {
  let serviceRequests = 0;
  let replies = 0;
  const reader = createIncomingLetterReader(layouts, {
    record: record(), onServiceRequired: () => serviceRequests++, onReply: () => replies++,
  });
  reader.advance(26);
  reader.activate('incoming-reply');
  reader.advance(20);
  assert.equal(serviceRequests, 0);
  reader.advance(1);
  assert.equal(serviceRequests, 1);
  assert.equal(replies, 0);
  assert.equal(reader.snapshot().mode, 'letter');
  assert.equal(reader.snapshot().locked, false);
});

test('local Reply masks only G_Reply and hands footer/input ownership to its child', sourceTest, () => {
  const replies = [];
  const reader = createIncomingLetterReader(layouts, {
    record: record({ photo }), letterService: 'local', onReply: (value) => replies.push(value),
  });
  reader.advance(50);
  const before = indexLayout(body(reader)).panes;
  reader.activate('incoming-reply');
  reader.advance(21);
  assert.equal(reader.snapshot().phase, 'reply-out');
  assertFooterReservation(reader, 3660);
  assert.equal(indexLayout(footer(reader)).panes.get('T_CalExit').text, 'Back');
  assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, 'Reply');
  reader.advance(5);
  const replying = indexLayout(body(reader)).panes;
  for (const name of ['N_MemoRoot', 'N_Header', 'N_Body', 'T_Letter', 'N_Pic', 'Pic'])
    assert.deepEqual(fields(replying.get(name)), fields(before.get(name)), name);
  assert.notEqual(replying.get('ReplyMask').alpha, before.get('ReplyMask').alpha);
  reader.advance(8);
  assert.deepEqual(replies, []);
  assertFooterReservation(reader, 3313);
  assert.equal(indexLayout(footer(reader)).panes.get('T_CalExit').text, 'Cancel');
  assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, 'Send');
  reader.advance(13);
  assert.deepEqual(replies, [{ recipient: sender, recordId: 'synthetic-letter' }]);
  assert.equal(reader.snapshot().mode, 'reply-child');
  assert.deepEqual(reader.controls(), []);
  assert.equal(footer(reader), undefined, 'the child owns the common footer');
  assert.equal(reader.back(), false);
  assert.equal(reader.resumeReply(), true);
  assert.equal(reader.resumeReply(), false);
  reader.advance(13);
  assert.equal(reader.snapshot().locked, false);
  assert.equal(reader.snapshot().mode, 'letter');
  assert.equal(indexLayout(body(reader)).panes.get('T_Letter').text, 'Local incoming text');
  assert.equal(indexLayout(footer(reader)).panes.get('T_CalAdd_R').text, 'Reply');
});

test('failed child creation restores ReplyBack without changing the record', sourceTest, () => {
  const errors = [];
  const reader = createIncomingLetterReader(layouts, {
    record: record(), letterService: 'local', onReply: () => { throw new Error('Synthetic failure'); },
    onReplyError: (error) => errors.push(error.message),
  });
  reader.advance(26);
  reader.activate('incoming-reply');
  reader.advance(47);
  assert.equal(reader.snapshot().phase, 'reply-back');
  assert.deepEqual(errors, ['Synthetic failure']);
  reader.advance(13);
  assert.equal(reader.snapshot().locked, false);
  assert.equal(indexLayout(body(reader)).panes.get('T_Letter').text, 'Local incoming text');
  const unavailable = createIncomingLetterReader(layouts, { record: record(), letterService: 'local' });
  unavailable.advance(26);
  assert.equal(unavailable.activate('incoming-reply'), false);
});

test('Reply handles asynchronous failure and discards obsolete attempts', sourceTest, async () => {
  let rejectChild;
  const errors = [];
  const reader = createIncomingLetterReader(layouts, {
    record: record(), letterService: 'local', onReplyError: (error) => errors.push(error.message),
    onReply: () => new Promise((resolve, reject) => { rejectChild = reject; }),
  });
  reader.advance(26);
  reader.activate('incoming-reply');
  reader.advance(47);
  assert.equal(reader.snapshot().mode, 'reply-child');
  rejectChild(new Error('Synthetic rejected child'));
  await Promise.resolve();
  assert.deepEqual(errors, ['Synthetic rejected child']);
  assert.equal(reader.snapshot().phase, 'reply-back');
  reader.advance(13);
  assert.equal(reader.snapshot().locked, false);
  assert.equal(indexLayout(body(reader)).panes.get('T_Letter').text, 'Local incoming text');

  reader.activate('incoming-reply');
  reader.advance(47);
  const rejectObsolete = rejectChild;
  reader.resumeReply();
  reader.advance(13);
  reader.activate('incoming-reply');
  reader.advance(47);
  rejectObsolete(new Error('Obsolete child'));
  await Promise.resolve();
  assert.equal(reader.snapshot().mode, 'reply-child');
  assert.deepEqual(errors, ['Synthetic rejected child']);
  reader.dispose();
  rejectChild(new Error('Disposed child'));
  await Promise.resolve();
  assert.deepEqual(errors, ['Synthetic rejected child']);
  assert.equal(reader.snapshot().closed, true);
});

test('local Reply does not recover or report after its callback disposes and throws', sourceTest, () => {
  const errors = [];
  const reader = createIncomingLetterReader(layouts, {
    record: record(), letterService: 'local', onReplyError: (error) => errors.push(error),
    onReply: () => {
      reader.dispose();
      throw new Error('Synthetic failure after disposal');
    },
  });
  reader.advance(26);
  reader.activate('incoming-reply');
  reader.advance(47);
  assert.equal(reader.snapshot().closed, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(reader.presentation().layers, []);
});

test('incoming scroll moves smoothly and owns sound across suspension and disposal', sourceTest, () => {
  const sounds = [];
  let returns = 0;
  const reader = createIncomingLetterReader(layouts, {
    record: record({ text: Array(20).fill('Synthetic row').join('\n') }),
    onSound: (...args) => sounds.push(args), onBack: () => returns++,
  });
  reader.advance(50);
  const maximum = reader.snapshot().scrollLimit;
  assert.ok(maximum > 300);
  reader.activate('incoming-scroll-down');
  reader.advance(1);
  assert.equal(reader.snapshot().scroll, 0);
  reader.advance(5);
  assert.ok(reader.snapshot().scroll > 0 && reader.snapshot().scroll < 300);
  assert.deepEqual(sounds.at(-1), ['WIPL_SE_MESSAGE_SCROLL', { loop: true }]);
  reader.suspendAudio();
  assert.deepEqual(sounds.at(-1), ['WIPL_SE_MESSAGE_SCROLL', { loop: false }]);
  reader.advance(1);
  assert.deepEqual(sounds.at(-1), ['WIPL_SE_MESSAGE_SCROLL', { loop: true }]);
  reader.dispose();
  reader.dispose();
  assert.deepEqual(sounds.at(-1), ['WIPL_SE_MESSAGE_SCROLL', { loop: false }]);
  reader.advance(1000);
  assert.equal(reader.snapshot().closed, true);
  assert.deepEqual(reader.presentation().layers, []);
  assert.equal(reader.activate('incoming-reply'), false);
  assert.equal(reader.resumeReply(), false);
  assert.equal(returns, 0);
});

test('disposing during Reply or close prevents deferred callbacks', sourceTest, () => {
  for (const action of ['incoming-reply', 'incoming-back']) {
    const callbacks = [];
    const reader = createIncomingLetterReader(layouts, {
      record: record(), letterService: 'local', onReply: () => callbacks.push('reply'),
      onBack: () => callbacks.push('back'),
    });
    reader.advance(26);
    reader.activate(action);
    reader.dispose();
    reader.advance(1000);
    assert.deepEqual(callbacks, [], action);
  }
});
