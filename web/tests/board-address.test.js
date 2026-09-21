import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ADDRESS_RECIPIENT_LAYOUTS, createBoardAddress } from '../src/board-address.js';
import { KEYBOARD_LAYOUTS } from '../src/board-keyboard.js';
import { indexLayout } from '../src/animation.js';
const url = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(url) ? JSON.parse(readFileSync(url)) : null;
const names = [...ADDRESS_RECIPIENT_LAYOUTS, ...KEYBOARD_LAYOUTS];
const available = manifest && names.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      names.map((key) => [key, JSON.parse(readFileSync(new URL(manifest.layouts[key].url, url)))]),
    )
  : {};

function registrationForm(kind, options = {}) {
  const address = createBoardAddress(layouts, options);
  address.advance(17);
  address.submit();
  address.advance(36);
  address.activate(`address-${kind}`);
  address.advance(61);
  return address;
}

function registrationReview(options = {}) {
  const address = registrationForm('wii', options);
  address.activate('address-edit');
  for (const digit of '8742285515623182') address.keyInput(digit);
  address.activate('key-ok');
  address.submit();
  address.advance(40);
  address.activate('address-edit');
  for (const letter of 'Retained') address.keyInput(letter);
  address.activate('key-ok');
  address.submit();
  address.advance(42);
  address.submit();
  address.advance(40);
  return address;
}

test('registration review uses source card ownership and returns through the optional Mii form',
  { skip: !available }, () => {
    const sounds = [];
    const original = JSON.stringify(layouts);
    const address = registrationReview({ onSound: (sound) => sounds.push(sound) });
    assert.equal(address.snapshot().step, 'review');
    assert.equal(address.snapshot().rightLabel, 'OK');
    assert.deepEqual(address.controls().map(({ id }) => id), ['address-info']);
    const card = indexLayout(address.presentation().layers[0].layout).panes;
    assert.equal(card.get('T_card_msg_00').text,
      'This information has been\nadded to your address book.');
    assert.equal(card.get('T_card_msg_00').alpha, 255);
    for (const name of ['N_crd_btn_00', 'N_crd_btn_10', 'N_crd_btn_11', 'N_crd_btn_gry'])
      assert.deepEqual(card.get(name).scale, [0, 0], name);
    for (const id of ['address-edit-address', 'address-edit-name', 'address-save', 'address-mii'])
      assert.equal(address.activate(id), false, id);
    sounds.length = 0;
    assert.equal(address.hover('address-info'), false, 'the native value pane has no focus cue');
    assert.equal(address.activate('address-info'), true);
    address.advance(21 + 25);
    const notice = address.presentation().layers.find(({ prefix }) => prefix === 'address-dialog:');
    assert.equal(indexLayout(notice.layout).panes.get('T_Dialog').text, '8742 2855 1562 3182');
    address.activate('address-info-ok');
    address.advance(41);
    assert.equal(address.back(), true);
    address.advance(38);
    assert.equal(address.snapshot().step, 'mii');
    assert.equal(address.snapshot().locked, false);
    const form = indexLayout(address.presentation().layers[0].layout).panes;
    assert.equal(form.get('T_question_00').text, 'You can attach a Mii.');
    assert.equal(form.get('T_mii_msg_00').text, '←Add a Mii');
    assert.equal(form.get('N_mii_all').flags & 1, 1);
    sounds.length = 0;
    assert.equal(address.hover('address-mii'), false);
    assert.equal(address.activate('address-mii'), true);
    assert.deepEqual(sounds, ['WIPL_SE_INFO_WINDOW', 'WIPL_SE_DECIDE']);
    assert.equal(address.snapshot().dialog.kind, 'no-mii');
    address.advance(25);
    address.activate('address-mii-ok');
    address.advance(41);
    assert.equal(address.snapshot().step, 'mii');
    address.back();
    address.advance(42);
    assert.equal(address.snapshot().step, 'nickname');
    assert.equal(indexLayout(address.presentation().layers[0].layout).panes.get('T_name_00').text,
      'Retained');
    assert.deepEqual(address.snapshot().contacts, []);
    assert.equal(JSON.stringify(layouts), original);
  });

test('registration saves only after card departure and waits for durable success and acknowledgement',
  { skip: !available }, async () => {
    let resolve;
    const writes = [];
    const sounds = [];
    const address = registrationReview({
      onContacts(value) {
        writes.push(value);
        return new Promise((done) => { resolve = done; });
      },
      onSound: (sound) => sounds.push(sound),
    });
    sounds.length = 0;
    assert.equal(address.submit(), true);
    address.advance(18);
    assert.deepEqual(writes, [], 'card_fnsh has not completed');
    assert.equal(address.submit(), false);
    address.advance(1);
    assert.equal(writes.length, 1);
    assert.equal(address.snapshot().saving, true);
    assert.equal(address.snapshot().dialog, null);
    assert.deepEqual(address.controls(), []);
    assert.deepEqual(address.snapshot().contacts, []);
    assert.equal(address.back(), false);
    address.advance(100);
    assert.deepEqual(sounds, [], 'elapsed animation time cannot announce a pending save');
    resolve();
    await Promise.resolve();
    assert.equal(address.snapshot().dialog.kind, 'registered');
    assert.equal(address.snapshot().dialog.frame, 0);
    assert.deepEqual(address.snapshot().contacts, writes[0]);
    assert.equal(address.submit(), false, 'success acknowledgement cannot repeat the save');
    assert.deepEqual(sounds, ['WIPL_SE_INFO_WINDOW']);
    address.advance(25);
    const notice = address.presentation().layers.find(({ prefix }) => prefix === 'address-dialog:');
    assert.equal(indexLayout(notice.layout).panes.get('T_Dialog').text,
      'The address has been registered.\nTo exchange messages, you must both\nregister one another and configure\nyour Internet settings.');
    address.activate('address-registered-ok');
    address.advance(37);
    assert.equal(address.snapshot().step, 'review');
    address.advance(1);
    assert.equal(address.snapshot().step, 'book');
    address.advance(17);
    assert.equal(address.snapshot().rightLabel, 'Register');
    assert.equal(address.snapshot().page, 1);
    assert.equal(writes.length, 1);
  });

test('failed registration restores the same review and permits correction before a single retry',
  { skip: !available }, async () => {
    let reject;
    const writes = [];
    const errors = [];
    const address = registrationReview({
      onContacts(value) {
        writes.push(value);
        if (writes.length === 1) return new Promise((_resolve, fail) => { reject = fail; });
      },
      onContactsError: (error) => errors.push(error.message),
    });
    address.submit();
    address.advance(19);
    reject(new Error('Synthetic contact write failure'));
    await Promise.resolve();
    assert.equal(address.snapshot().dialog, null);
    assert.equal(address.snapshot().locked, true, 'review re-entry owns input');
    address.advance(21);
    assert.equal(address.snapshot().locked, false);
    assert.equal(address.snapshot().step, 'review');
    assert.deepEqual(address.snapshot().contacts, []);
    assert.deepEqual(errors, ['Synthetic contact write failure']);
    address.back();
    address.advance(38);
    address.back();
    address.advance(42);
    address.activate('address-edit');
    for (let index = 0; index < 'Retained'.length; index++) address.keyInput('Backspace');
    for (const letter of 'Retry') address.keyInput(letter);
    address.activate('key-ok');
    address.submit();
    address.advance(42);
    address.submit();
    address.advance(40);
    assert.equal(address.submit(), true);
    address.advance(19);
    assert.equal(writes.length, 2);
    assert.equal(writes[1][0].nickname, 'Retry');
    assert.equal(address.snapshot().dialog.kind, 'registered');
    assert.deepEqual(address.snapshot().contacts, writes[1]);
  });

test('a full managed Address Book acknowledges the original notice without leaving its page',
  { skip: !available }, () => {
    const contacts = Array.from({ length: 100 }, (_, index) => ({
      kind: 'email', address: `fixture${index}@example.invalid`, nickname: `Local ${index}`,
      confirmed: index % 2 === 0,
    }));
    const sounds = [];
    const saves = [];
    const address = createBoardAddress(layouts, {
      contacts, onSound: (sound) => sounds.push(sound), onContacts: (value) => saves.push(value),
    });
    address.advance(17);
    address.activate('address-prev');
    address.advance(15);
    const before = address.snapshot();
    const book = JSON.stringify(address.presentation().layers[0].layout);
    sounds.length = 0;
    assert.equal(before.page, 20);
    assert.equal(before.rightDisabled, false, 'capacity does not disable the Register trigger');
    assert.equal(address.submit(), true);
    assert.equal(address.snapshot().dialog.kind, 'book-full');
    assert.equal(address.snapshot().dialog.frame, 0);
    assert.equal(address.submit(), false, 'the notice owns input until its departure finishes');
    address.advance(25);
    const view = address.presentation();
    const notice = view.layers.find(({ prefix }) => prefix === 'address-dialog:');
    assert.equal(indexLayout(notice.layout).panes.get('T_Dialog').text,
      "Your address book is full, so you\ncan't register a new address.");
    assert.deepEqual(view.controls.map(({ id, label }) => ({ id, label })),
      [{ id: 'address-full-ok', label: 'OK' }]);
    assert.equal(address.activate('address-next'), false);
    assert.equal(address.activate('address-full-ok'), true);
    address.advance(41);
    assert.equal(address.snapshot().dialog, null);
    assert.equal(address.snapshot().page, before.page);
    assert.equal(address.snapshot().step, 'book');
    assert.deepEqual(address.snapshot().contacts, contacts);
    assert.equal(JSON.stringify(address.presentation().layers[0].layout), book);
    assert.deepEqual(saves, []);
    assert.deepEqual(sounds, ['WIPL_SE_INFO_WINDOW', 'WIPL_SE_DECIDE']);
  });

test('Address capacity counts occupied slots and does not change recipient selection policy',
  { skip: !available }, () => {
    const contacts = Array.from({ length: 100 }, (_, index) => ({
      kind: 'email', address: `fixture${index}@example.invalid`, nickname: `Local ${index}`,
    }));
    contacts[72] = null;
    const managed = createBoardAddress(layouts, { contacts });
    managed.advance(17);
    assert.equal(managed.submit(), true);
    managed.advance(36);
    assert.equal(managed.snapshot().step, 'kind', 'a hole permits another registration');
    assert.equal(managed.snapshot().dialog, null);
    const picker = createBoardAddress(layouts, { mode: 'recipient', contacts });
    picker.advance(100);
    assert.equal(picker.snapshot().rightLabel, '');
    assert.equal(picker.submit(), false);
    assert.equal(picker.snapshot().dialog, null);
  });

test(
  'local Address fixture turns authored pages and retains the cover labels',
  { skip: !available },
  () => {
    const sounds = [];
    const address = createBoardAddress(layouts, {
      contacts: [{ kind: 'wii', address: '1234567812345678', nickname: 'Local' }],
      onSound: (id) => sounds.push(id),
    });
    address.advance(17);
    let book = address.presentation().layers[0].layout;
    assert.equal(indexLayout(book).panes.get('T_adrs_00').text, 'Address Book');
    assert.equal(indexLayout(book).panes.get('T_wii_name').text, '0000 0000 0000 0000');
    assert.equal(indexLayout(book).panes.get('N_note_d').flags & 1, 0);
    assert.equal(indexLayout(book).panes.get('N_note_c').flags & 1, 0);
    assert.equal(address.activate('address-next'), true);
    address.advance(14);
    assert.equal(address.snapshot().locked, true);
    book = address.presentation().layers[0].layout;
    assert.equal(indexLayout(book).panes.get('N_note_c').flags & 1, 0);
    address.advance(1);
    assert.equal(address.snapshot().page, 1);
    book = address.presentation().layers[0].layout;
    assert.equal(indexLayout(book).panes.get('T_name_b_00').text, 'Local');
    assert.equal(address.activate('address-prev'), true);
    address.advance(15);
    assert.equal(address.snapshot().page, 0);
    assert.deepEqual(sounds, ['WIPL_SE_FL_PAGE_INC', 'WIPL_SE_FL_PAGE_DEC']);
  },
);

test(
  'Address Book transfers all twenty sheets and wraps through the original cover animation',
  { skip: !available },
  () => {
    const address = createBoardAddress(layouts, { display: { width: 832 } });
    const visibleSheets = (letter) => {
      const book = address.presentation().layers[0].layout;
      return indexLayout(book)
        .panes.get('N_note_all')
        .children.filter((pane) => pane.name.startsWith(`N_note_${letter}`) && pane.flags & 1);
    };
    address.advance(17);
    assert.equal(visibleSheets('a').length, 20);
    assert.equal(visibleSheets('d').length, 0);
    assert.deepEqual(
      visibleSheets('a').map((pane) => pane.translation[0]),
      Array.from({ length: 20 }, (_, index) => index - 20),
    );
    address.activate('address-prev');
    assert.equal(address.snapshot().bookGeometry.state, 'loop-backward');
    assert.equal(visibleSheets('a').length, 0);
    assert.equal(visibleSheets('e').length, 19);
    assert.deepEqual(
      visibleSheets('e').map((pane) => pane.translation),
      Array.from({ length: 19 }, (_, index) => [index + 1, index + 1, 0]),
      'the original wrap draw loop repeats cover panes at offsets one through nineteen',
    );
    address.advance(15);
    assert.equal(address.snapshot().page, 20);
    assert.equal(visibleSheets('d').length, 19);
    assert.deepEqual(address.snapshot().bookGeometry.baseTranslation, [(-20 * 608) / 832, -20]);
    address.activate('address-next');
    assert.equal(address.snapshot().bookGeometry.state, 'loop-forward');
    assert.equal(visibleSheets('d').length, 0);
    assert.equal(visibleSheets('e').length, 19);
    address.advance(15);
    assert.equal(address.snapshot().page, 0);
    assert.equal(visibleSheets('a').length, 20);
    assert.equal(visibleSheets('e').length, 1);
    for (let page = 1; page <= 20; page++) {
      address.activate('address-next');
      address.advance(16);
      assert.equal(address.snapshot().page, page);
      assert.equal(visibleSheets('a').length, 20 - page);
      assert.equal(visibleSheets('d').length, page - 1);
    }
    address.activate('address-prev');
    let geometry = address.snapshot().bookGeometry;
    assert.equal(
      geometry.facePage,
      20,
      'underlying face stays on the old page during reverse turn',
    );
    assert.equal(geometry.turnPage, 19, 'turning sheet carries the destination page');
    address.advance(16);
    geometry = address.snapshot().bookGeometry;
    assert.equal(geometry.facePage, 19);
    assert.equal(geometry.rightCount, 1);
    assert.equal(geometry.leftCount, 18);
  },
);

test(
  'explicit local registration completes Mii, review and acknowledgement before returning to the book',
  { skip: !available },
  () => {
    const updates = [],
      pristine = JSON.stringify(layouts),
      address = createBoardAddress(layouts, { onContacts: (value) => updates.push(value) });
    address.advance(17);
    address.submit();
    address.advance(36);
    assert.equal(address.snapshot().step, 'kind');
    address.activate('address-wii');
    address.advance(61);
    assert.equal(address.snapshot().step, 'address');
    address.activate('address-edit');
    for (const value of '8742285515623182') address.keyInput(value);
    address.back();
    assert.equal(address.snapshot().editing, false);
    assert.equal(address.submit(), true);
    address.advance(40);
    assert.equal(address.snapshot().step, 'nickname');
    address.activate('address-edit');
    for (const value of 'Local') address.keyInput(value);
    address.back();
    address.submit();
    address.advance(42);
    assert.equal(address.snapshot().step, 'mii');
    address.submit();
    address.advance(40);
    assert.equal(address.snapshot().step, 'review');
    assert.equal(address.activate('address-save'), false);
    address.submit();
    address.advance(19);
    assert.equal(address.snapshot().dialog.kind, 'registered');
    assert.equal(address.snapshot().step, 'review');
    address.advance(25);
    address.activate('address-registered-ok');
    address.advance(41 + 17);
    assert.equal(address.snapshot().step, 'book');
    assert.equal(address.snapshot().page, 1);
    assert.deepEqual(updates, [[{ kind: 'wii', address: '8742285515623182', nickname: 'Local' }]]);
    address.activate('address-entry-0');
    address.advance(53);
    assert.equal(address.snapshot().step, 'contact');
    assert.equal(JSON.stringify(layouts), pristine);
  },
);

function populatedAddress(options = {}) {
  const contacts = [
    { kind: 'wii', address: '1234567812345678', nickname: 'First' },
    { kind: 'email', address: 'second@example.test', nickname: 'Second' },
  ];
  const address = createBoardAddress(layouts, { contacts, ...options });
  address.advance(17);
  address.activate('address-next');
  address.advance(15);
  address.activate('address-entry-0');
  address.advance(53);
  assert.equal(address.snapshot().step, 'contact');
  return address;
}

function changeNickname(address, value) {
  address.activate('address-edit-name');
  address.advance(61);
  assert.equal(address.snapshot().step, 'nickname');
  address.activate('address-edit');
  for (let i = 0; i < 10; i++) address.keyInput('Backspace');
  for (const letter of value) address.keyInput(letter);
  address.activate('key-ok');
  assert.equal(address.snapshot().editing, false);
}

test('Address interaction state follows transitions and saves without exposing private contacts',
  { skip: !available }, async (t) => {
    let resolve;
    const contacts = [{ kind: 'wii', address: '1234567812345678', nickname: 'First' }];
    const address = createBoardAddress(layouts, {
      contacts,
      onContacts: () => new Promise((done) => { resolve = done; }),
    });
    const clone = globalThis.structuredClone;
    let contactCopies = 0;
    t.mock.method(globalThis, 'structuredClone', (value, ...args) => {
      if (Array.isArray(value) && value[0]?.kind === 'wii') contactCopies += 1;
      return clone(value, ...args);
    });
    const check = (expected) => {
      contactCopies = 0;
      const state = address.interactionState();
      assert.equal(contactCopies, 0, 'status reads must not copy contact records');
      assert.equal(Object.hasOwn(state, 'contacts'), false);
      for (const [key, value] of Object.entries(expected)) assert.equal(state[key], value, key);
      const { contacts: records, ...fullState } = address.snapshot();
      assert.deepEqual(state, fullState);
      assert.equal(contactCopies, 1, 'public snapshots must retain defensive contact copies');
      return { state, records };
    };
    const initial = check({ step: 'book', locked: true, editing: false, saving: false });
    contacts[0].nickname = 'Changed by input caller';
    initial.records[0].nickname = 'Changed by snapshot caller';
    initial.state.bookGeometry.baseTranslation[0] = 999;
    assert.equal(address.snapshot().contacts[0].nickname, 'First');
    assert.notEqual(address.interactionState().bookGeometry.baseTranslation[0], 999);
    address.advance(17);
    check({ step: 'book', locked: false });
    address.activate('address-next');
    check({ step: 'book', locked: true });
    address.advance(15);
    check({ step: 'book', page: 1, locked: false });
    address.activate('address-entry-0');
    address.advance(53);
    check({ step: 'contact', locked: false });
    address.activate('address-info');
    address.advance(21);
    check({ modal: true, locked: true });
    address.advance(25);
    const notice = check({ modal: true, locked: false }).state;
    notice.dialog.phase = 'Changed by caller';
    assert.equal(address.interactionState().dialog.phase, 'idle');
    address.activate('address-info-ok');
    address.advance(41);
    address.activate('address-edit-name');
    address.advance(61);
    address.activate('address-edit');
    check({ step: 'nickname', editing: true });
    for (let index = 0; index < 10; index++) address.keyInput('Backspace');
    for (const letter of 'Renamed') address.keyInput(letter);
    address.activate('key-ok');
    check({ step: 'nickname', editing: false, locked: false });
    assert.equal(address.submit(), true);
    check({ saving: true, locked: true });
    assert.equal(address.back(), false);
    assert.equal(address.snapshot().contacts[0].nickname, 'First');
    resolve();
    await Promise.resolve();
    check({ saving: false, locked: true });
    address.advance(38);
    check({ step: 'contact', locked: false });
    const view = address.presentation();
    assert.equal(view.contacts[0].nickname, 'Renamed');
    view.contacts[0].nickname = 'Changed by presentation caller';
    assert.equal(address.snapshot().contacts[0].nickname, 'Renamed');
  });

test('registered contacts expose source card actions and retain the offline Send boundary',
  { skip: !available }, () => {
    const actions = [];
    const address = populatedAddress({ onAction: (...args) => actions.push(args) });
    const labels = address.controls().map(({ id, label }) => [id, label]);
    assert.deepEqual(labels, [['address-mii', 'Choose a Mii'], ['address-info', 'Wii Number'],
      ['address-send', 'Send Message'],
      ['address-edit-name', 'Change\nNickname'], ['address-erase', 'Erase']]);
    assert.equal(address.activate('address-edit-address'), false);
    assert.equal(address.activate('address-send'), true);
    address.advance(20);
    assert.deepEqual(actions, []);
    address.advance(1);
    assert.equal(actions[0][0], 'send-message');
    assert.equal(actions[0][1].changed, false);
    assert.equal(actions[0][1].contact.nickname, 'First');
    assert.equal(address.snapshot().contacts.length, 2);
  });

test('contact nickname changes remain drafts until OK and Back restores the original card',
  { skip: !available }, () => {
    const saved = [];
    const address = populatedAddress({ onContacts: (contacts) => saved.push(contacts) });
    changeNickname(address, 'Draft');
    const form = address.presentation().layers.find(({ prefix }) => prefix === 'address-form:').layout;
    assert.equal(indexLayout(form).panes.get('T_question_00').text, 'Nickname');
    assert.equal(indexLayout(form).panes.get('T_msg_00').text, 'Apply nickname');
    assert.equal(address.snapshot().contacts[0].nickname, 'First');
    assert.equal(address.back(), true);
    address.advance(38);
    assert.equal(address.snapshot().step, 'contact');
    assert.equal(saved.length, 0);
    let card = address.presentation().layers.find(({ prefix }) => prefix === 'address-card:').layout;
    assert.equal(indexLayout(card).panes.get('T_name_00').text, 'First');
    changeNickname(address, 'Renamed');
    assert.equal(address.submit(), true);
    address.advance(38);
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0].nickname, 'Renamed');
    assert.equal(saved[0][0].address, '1234567812345678');
    assert.equal(saved[0][1].nickname, 'Second');
    card = address.presentation().layers.find(({ prefix }) => prefix === 'address-card:').layout;
    assert.equal(indexLayout(card).panes.get('T_name_00').text, 'Renamed');
  });

test('erase waits for original No/Yes confirmation, cancels intact and preserves later slots on acceptance',
  { skip: !available }, () => {
    const saved = [];
    const sounds = [];
    const original = JSON.stringify(layouts);
    const address = populatedAddress({
      onContacts: (value) => saved.push(value), onSound: (value) => sounds.push(value),
    });
    const contacts = address.snapshot().contacts;
    address.activate('address-erase');
    address.advance(32);
    assert.equal(address.snapshot().dialog.phase, 'enter');
    assert.equal(address.snapshot().dialog.frame, 0);
    address.advance(25);
    assert.equal(address.snapshot().locked, true);
    assert.equal(address.activate('address-erase-yes'), false);
    address.advance(1);
    assert.equal(sounds.at(-1), 'WIPL_SE_INFO_WINDOW');
    address.hover('address-erase-no');
    assert.equal(sounds.at(-1), 'WIPL_SE_BT_TARGETTING');
    address.hover('address-erase-no');
    assert.equal(sounds.filter((value) => value === 'WIPL_SE_BT_TARGETTING').length, 1);
    const confirm = address.presentation();
    assert.deepEqual(confirm.controls.map(({ id, pane }) => [id, pane]),
      [['address-erase-yes', 'B_BtnA'], ['address-erase-no', 'B_BtnB']]);
    assert.equal(indexLayout(confirm.layers.find(({ prefix }) => prefix === 'address-dialog:').layout)
      .panes.get('N_Top').flags & 1, 0, 'the question belongs to the card, not the dialog top strip');
    assert.equal(indexLayout(confirm.layers.find(({ prefix }) => prefix === 'address-card:').layout)
      .panes.get('T_card_msg_00').text, 'Erase this?');
    assert.equal(address.activate('address-edit-name'), false);
    address.activate('address-erase-no');
    address.advance(21 + 26 + 21 + 11);
    assert.deepEqual(address.snapshot().contacts, contacts);
    assert.equal(address.snapshot().modal, false);
    assert.equal(saved.length, 0);
    address.activate('address-erase');
    address.advance(58);
    address.activate('address-erase-yes');
    address.advance(46);
    assert.equal(saved.length, 0, 'local mutation waits until the confirmation has closed');
    address.advance(1);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], [null, contacts[1]]);
    address.advance(21 + 25);
    assert.equal(address.snapshot().dialog.kind, 'erased');
    const success = address.presentation().layers.find(({ prefix }) => prefix === 'address-dialog:');
    assert.equal(indexLayout(success.layout).panes.get('T_Dialog').text, 'That Wii Friend has been erased.');
    address.activate('address-erased-ok');
    address.advance(17 + 21 + 19 + 17);
    assert.equal(address.snapshot().step, 'book');
    assert.equal(address.snapshot().page, 1);
    assert.equal(address.controls().find(({ id }) => id === 'address-entry-0').disabled, true);
    assert.equal(address.controls().find(({ id }) => id === 'address-entry-1').label, 'Second');
    address.activate('address-entry-1');
    address.advance(53);
    assert.equal(address.snapshot().step, 'contact');
    const card = address.presentation().layers.find(({ prefix }) => prefix === 'address-card:');
    assert.equal(indexLayout(card.layout).panes.get('N_crd_btn_10').scale[0], 1);
    assert.equal(JSON.stringify(layouts), original);
  });

test('empty local Mii fixture shows original message and returns without changing the contact',
  { skip: !available }, () => {
    const address = populatedAddress();
    const before = address.snapshot().contacts;
    address.activate('address-mii');
    address.advance(21 + 25);
    assert.equal(address.snapshot().dialog.kind, 'no-mii');
    const dialog = address.presentation().layers.find(({ prefix }) => prefix === 'address-dialog:');
    assert.match(indexLayout(dialog.layout).panes.get('T_Dialog').text, /No Miis have been registered/);
    assert.equal(address.activate('address-send'), false);
    address.back();
    address.advance(17 + 21);
    assert.equal(address.snapshot().dialog, null);
    assert.equal(address.snapshot().step, 'contact');
    assert.deepEqual(address.snapshot().contacts, before);
  });

test('address-value dialog preserves complete email text and uses the native number grouping',
  { skip: !available }, () => {
    const original = JSON.stringify(layouts);
    const fixtures = [
      { kind: 'wii', address: '1234567812345678', card: '1234 5678 1234 5678' },
      { kind: 'email', address: 'long.synthetic.address@example.test', card: 'long.synthetic...' },
      { kind: 'email', address: 'short@e.test', card: 'short@e.test' },
    ];
    for (const fixture of fixtures) {
      const writes = [];
      const address = populatedAddress({
        contacts: [{ kind: fixture.kind, address: fixture.address, nickname: 'Fixture' }],
        onContacts: (value) => writes.push(value),
      });
      const panes = () => indexLayout(address.presentation().layers.find(
        ({ prefix }) => prefix === 'address-card:',
      ).layout).panes;
      assert.equal(panes().get('T_frnd_crd_00').text, fixture.card);
      assert.equal(address.controls().find(({ id }) => id === 'address-info').pane, 'B_card_beta');
      const buttonScale = panes().get('N_crd_btn_10').scale[0];
      const addressScale = panes().get('T_frnd_crd_00').scale[0];
      address.hover('address-info');
      address.advance(10);
      assert.equal(panes().get('T_frnd_crd_00').scale[0], addressScale,
        'the source clip has no address-pane scale track; do not borrow another button\'s track');
      assert.equal(panes().get('N_crd_btn_10').scale[0], buttonScale,
        'address focus binds its pane without animating unrelated card buttons');
      address.activate('address-info');
      address.advance(20);
      assert.equal(address.snapshot().dialog, null);
      address.advance(1);
      assert.equal(address.snapshot().dialog.frame, 0);
      address.advance(25);
      const dialog = address.presentation().layers.find(({ prefix }) => prefix === 'address-dialog:');
      assert.equal(indexLayout(dialog.layout).panes.get('T_Dialog').text,
        fixture.kind === 'wii' ? fixture.card : fixture.address);
      assert.equal(address.activate('address-erase'), false);
      assert.equal(address.activate('address-info-ok'), true);
      address.advance(17 + 21);
      assert.equal(address.snapshot().step, 'contact');
      assert.equal(address.snapshot().dialog, null);
      assert.deepEqual(writes, []);
    }
    assert.equal(JSON.stringify(layouts), original);
  });

test('sparse contacts survive reload and registration reuses an empty slot within the 100-entry bound',
  { skip: !available }, () => {
    const contacts = Array(100).fill(null);
    contacts[99] = { kind: 'email', address: 'last@example.test', nickname: 'Last' };
    const saved = [];
    const address = createBoardAddress(layouts, { contacts, onContacts: (value) => saved.push(value) });
    address.advance(17);
    assert.equal(address.snapshot().rightDisabled, false);
    address.submit();
    address.advance(36);
    address.activate('address-wii');
    address.advance(61);
    address.activate('address-edit');
    for (const digit of '8742285515623182') address.keyInput(digit);
    address.activate('key-ok');
    address.submit();
    address.advance(40);
    address.activate('address-edit');
    for (const letter of 'New') address.keyInput(letter);
    address.activate('key-ok');
    address.submit();
    address.advance(42);
    address.submit();
    address.advance(40);
    address.submit();
    address.advance(19);
    assert.equal(saved[0].length, 100);
    assert.equal(saved[0][0].nickname, 'New');
    assert.deepEqual(saved[0][99], contacts[99]);
    assert.equal(saved[0][1], null);
    const full = createBoardAddress(layouts, { contacts: Array(100).fill(contacts[99]) });
    full.advance(17);
    assert.equal(full.snapshot().rightDisabled, false);
    assert.equal(full.submit(), true);
    assert.equal(full.snapshot().dialog.kind, 'book-full');
  });

test('nickname persistence failure retains its draft and waits for a successful retry',
  { skip: !available }, async () => {
    const errors = [];
    let attempt = 0;
    let resolve;
    const address = populatedAddress({
      onContacts() {
        if (++attempt === 1) throw new Error('Synthetic quota failure');
        return new Promise((done) => { resolve = done; });
      },
      onContactsError: (error) => errors.push(error.message),
    });
    const before = address.snapshot().contacts;
    changeNickname(address, 'Retained');
    assert.equal(address.submit(), true);
    assert.deepEqual(address.snapshot().contacts, before);
    assert.equal(address.snapshot().step, 'nickname');
    const form = address.presentation().layers.find(({ prefix }) => prefix === 'address-form:');
    assert.equal(indexLayout(form.layout).panes.get('T_name_00').text, 'Retained');
    assert.deepEqual(errors, ['Synthetic quota failure']);
    assert.equal(address.submit(), true);
    assert.equal(address.snapshot().locked, true);
    assert.deepEqual(address.controls(), []);
    assert.equal(address.submit(), false, 'an outstanding save retains mutation ownership');
    assert.equal(address.snapshot().dialog, null);
    assert.equal(address.back(), false);
    address.advance(100);
    assert.deepEqual(address.snapshot().contacts, before);
    resolve();
    await Promise.resolve();
    address.advance(38);
    assert.equal(address.snapshot().step, 'contact');
    assert.equal(address.snapshot().contacts[0].nickname, 'Retained');
    assert.deepEqual(address.snapshot().contacts[1], before[1]);
  });

test('contact erase does not announce success after a failed save and can retry its same slot',
  { skip: !available }, async () => {
    const errors = [];
    let reject;
    let attempt = 0;
    const address = populatedAddress({
      onContacts() {
        if (++attempt === 1) return new Promise((_resolve, fail) => { reject = fail; });
      },
      onContactsError: (error) => errors.push(error.message),
    });
    const before = address.snapshot().contacts;
    address.activate('address-erase');
    address.advance(58);
    address.activate('address-erase-yes');
    address.advance(47);
    assert.equal(address.snapshot().locked, true);
    assert.equal(address.snapshot().dialog, null);
    assert.deepEqual(address.snapshot().contacts, before);
    reject(new Error('Synthetic denied storage'));
    await Promise.resolve();
    address.advance(32);
    assert.equal(address.snapshot().step, 'contact');
    assert.equal(address.snapshot().dialog, null);
    assert.equal(address.snapshot().modal, false);
    assert.deepEqual(address.snapshot().contacts, before);
    assert.deepEqual(errors, ['Synthetic denied storage']);
    address.activate('address-erase');
    address.advance(58);
    address.activate('address-erase-yes');
    address.advance(47 + 21 + 25);
    assert.equal(address.snapshot().dialog.kind, 'erased');
    assert.deepEqual(address.snapshot().contacts, [null, before[1]]);
  });

test('failed registration retains review values and disposal suppresses late persistence callbacks',
  { skip: !available }, async () => {
    let reject;
    let attempts = 0;
    const errors = [];
    const address = createBoardAddress(layouts, {
      onContacts() {
        if (++attempts === 1) throw new Error('Synthetic full storage');
        return new Promise((_resolve, fail) => { reject = fail; });
      },
      onContactsError: (error) => errors.push(error.message),
    });
    address.advance(17);
    address.submit();
    address.advance(36);
    address.activate('address-wii');
    address.advance(61);
    address.activate('address-edit');
    for (const digit of '8742285515623182') address.keyInput(digit);
    address.activate('key-ok');
    address.submit();
    address.advance(40);
    address.activate('address-edit');
    for (const letter of 'Retained') address.keyInput(letter);
    address.activate('key-ok');
    address.submit();
    address.advance(42);
    address.submit();
    address.advance(40);
    address.submit();
    address.advance(40);
    assert.equal(address.snapshot().step, 'review');
    assert.deepEqual(address.snapshot().contacts, []);
    const card = address.presentation().layers.find(({ prefix }) => prefix === 'address-card:');
    assert.equal(indexLayout(card.layout).panes.get('T_name_00').text, 'Retained');
    assert.deepEqual(errors, ['Synthetic full storage']);
    address.submit();
    address.advance(21);
    assert.equal(address.snapshot().locked, true);
    address.dispose();
    reject(new Error('Late failure after scene disposal'));
    await Promise.resolve();
    assert.deepEqual(errors, ['Synthetic full storage']);
    assert.deepEqual(address.snapshot().contacts, []);
  });

test('duplicate Wii and exact email registration use original notices without changing occupied slots',
  { skip: !available }, () => {
    for (const fixture of [
      { kind: 'wii', address: '1234567812345678', message: 'That Wii Number is already registered.' },
      { kind: 'email', address: 'synthetic@example.test',
        message: 'That e-mail address is already registered.' },
    ]) {
      const existing = { kind: fixture.kind, address: fixture.address,
        nickname: 'Existing', confirmed: false };
      const writes = [];
      const address = createBoardAddress(layouts, {
        contacts: [null, existing], onContacts: (value) => writes.push(value),
      });
      address.advance(17);
      address.submit();
      address.advance(36);
      address.activate(`address-${fixture.kind}`);
      address.advance(61);
      address.activate('address-edit');
      for (const character of fixture.address) address.keyInput(character);
      address.activate('key-ok');
      assert.equal(address.snapshot().dialog.kind, `duplicate-${fixture.kind}`);
      assert.equal(address.snapshot().rightDisabled, true);
      address.advance(25);
      const notice = address.presentation().layers.at(-1);
      assert.equal(indexLayout(notice.layout).panes.get('T_Dialog').text, fixture.message);
      assert.deepEqual(address.controls().map(({ id }) => id), ['address-duplicate-ok']);
      address.activate('address-duplicate-ok');
      address.advance(38);
      assert.equal(address.snapshot().step, 'address');
      assert.equal(address.submit(), false);
      assert.equal(address.snapshot().dialog.kind, `duplicate-${fixture.kind}`);
      address.advance(25);
      address.activate('address-duplicate-ok');
      address.advance(38);
      assert.deepEqual(address.snapshot().contacts, [null, existing]);
      assert.deepEqual(writes, []);
      address.activate('address-edit');
      for (const character of fixture.address) address.keyInput('Backspace');
      const corrected = fixture.kind === 'wii' ? '8742285515623182' : 'corrected@example.test';
      for (const character of corrected) address.keyInput(character);
      address.activate('key-ok');
      assert.equal(address.snapshot().dialog, null);
      assert.equal(address.submit(), true);
      address.advance(40);
      assert.equal(address.snapshot().step, 'nickname', 'correcting the draft permits registration');
    }
  });

test('email duplicate matching preserves native byte case and keyboard cancellation does not show a notice',
  { skip: !available }, () => {
    for (const input of ['Synthetic@example.test', 'synthetic@example.test']) {
      const address = createBoardAddress(layouts, {
        contacts: [{ kind: 'email', address: 'synthetic@example.test', nickname: 'Existing' }],
      });
      address.advance(17);
      address.submit();
      address.advance(36);
      address.activate('address-email');
      address.advance(61);
      address.activate('address-edit');
      for (const character of input) address.keyInput(character);
      if (input.startsWith('S')) address.activate('key-ok');
      else address.back();
      assert.equal(address.snapshot().dialog, null);
      assert.equal(address.snapshot().rightDisabled, !input.startsWith('S'));
      assert.equal(address.submit(), input.startsWith('S'));
    }
  });

test('pending contact Send uses the gray resource branch and original notice before any Send action',
  { skip: !available }, () => {
    const original = JSON.stringify(layouts);
    const sounds = [];
    const actions = [];
    const contact = { kind: 'wii', address: '1234567812345678',
      nickname: 'Pending', confirmed: false };
    const address = populatedAddress({
      contacts: [contact], onSound: (value) => sounds.push(value),
      onAction: (value) => actions.push(value),
    });
    const card = () => indexLayout(address.presentation().layers.find(
      ({ prefix }) => prefix === 'address-card:',
    ).layout).panes;
    assert.deepEqual(card().get('N_crd_btn_00').scale, [0, 0]);
    assert.deepEqual(card().get('N_crd_btn_gry').scale, [1, 1]);
    assert.equal(card().get('T_crd_btn_gry').text, 'Send Message');
    sounds.length = 0;
    assert.equal(address.hover('address-send'), false);
    assert.deepEqual(sounds, []);
    assert.equal(address.activate('address-send'), true);
    assert.equal(address.snapshot().dialog.kind, 'pending-registration');
    assert.equal(address.snapshot().dialog.frame, 0);
    assert.deepEqual(sounds, ['WIPL_SE_INFO_WINDOW']);
    assert.deepEqual(actions, []);
    address.advance(25);
    const notice = address.presentation().layers.at(-1);
    assert.match(indexLayout(notice.layout).panes.get('T_Dialog').text, /Confirming registration/);
    address.activate('address-pending-ok');
    address.advance(38);
    assert.equal(address.snapshot().step, 'contact');
    address.activate('address-erase');
    address.advance(32);
    assert.deepEqual(card().get('N_crd_btn_gry').scale, [0, 0]);
    address.advance(26);
    address.activate('address-erase-no');
    address.advance(47 + 21 + 11);
    assert.deepEqual(card().get('N_crd_btn_gry').scale, [1, 1]);
    assert.deepEqual(card().get('N_crd_btn_00').scale, [0, 0]);
    assert.deepEqual(address.snapshot().contacts, [contact]);
    assert.equal(JSON.stringify(layouts), original);
  });

test('invalid registration preserves the draft and uses the same native priority from OK and submit',
  { skip: !available }, () => {
    const messages = { 86: 'own-number-86', 82: 'duplicate-number-82', 84: 'invalid-number-84',
      83: 'duplicate-email-83', 446: 'invalid-email-446' };
    const ownWiiNumber = '7053433507880718';
    for (const fixture of [
      { kind: 'wii', value: ownWiiNumber, ownWiiNumber, duplicate: true,
        issue: 'own-wii', message: messages[86] },
      { kind: 'wii', value: '1234567812345678', duplicate: true,
        issue: 'duplicate-wii', message: messages[82] },
      { kind: 'wii', value: '1234567812345678', issue: 'invalid-wii', message: messages[84] },
      { kind: 'wii', value: '3675735668494095', ownWiiNumber,
        issue: 'invalid-wii', message: messages[84] },
      { kind: 'email', value: 'a(b)@c', duplicate: true,
        issue: 'duplicate-email', message: messages[83] },
      { kind: 'email', value: 'a@wii.com', issue: 'invalid-email', message: messages[446] },
    ]) {
      for (const entryPoint of ['keyboard-ok', 'form-submit']) {
        const saved = [];
        const contacts = fixture.duplicate
          ? [{ kind: fixture.kind, address: fixture.value, nickname: 'Existing' }] : [];
        const address = registrationForm(fixture.kind, {
          contacts, messages, ownWiiNumber: fixture.ownWiiNumber,
          onContacts: (value) => saved.push(value),
        });
        address.activate('address-edit');
        for (const character of fixture.value) address.keyInput(character);
        if (entryPoint === 'keyboard-ok') address.activate('key-ok');
        else {
          address.back();
          assert.equal(address.snapshot().dialog, null, 'cancel completion does not show a notice');
          assert.equal(address.submit(), false, 'an invalid direct submit cannot advance');
        }
        assert.equal(address.snapshot().dialog.kind, fixture.issue, entryPoint);
        address.advance(25);
        assert.equal(indexLayout(address.presentation().layers.at(-1).layout)
          .panes.get('T_Dialog').text, fixture.message);
        const acknowledgement = address.controls()[0].id;
        address.activate(acknowledgement);
        address.advance(38);
        const form = address.presentation().layers.find(({ prefix }) => prefix === 'address-form:');
        assert.equal(indexLayout(form.layout).panes.get('T_name_00').text, fixture.value);
        assert.equal(address.snapshot().rightDisabled, true);
        assert.equal(address.activate('address-edit'), true);
        for (const character of fixture.value) address.keyInput('Backspace');
        const corrected = fixture.kind === 'wii' ? '8742285515623182' : 'corrected@fixture';
        for (const character of corrected) address.keyInput(character);
        address.activate('key-ok');
        assert.equal(address.snapshot().dialog, null);
        assert.equal(address.submit(), true);
        address.advance(40);
        assert.equal(address.snapshot().step, 'nickname');
        assert.deepEqual(address.snapshot().contacts, contacts);
        assert.deepEqual(saved, [], 'validation never persists an unfinished registration');
      }
    }
  });

test('empty registration completion stays editable without opening an error notice',
  { skip: !available }, () => {
    for (const kind of ['wii', 'email']) {
      const address = registrationForm(kind);
      address.activate('address-edit');
      address.activate('key-ok');
      assert.equal(address.snapshot().dialog, null);
      assert.equal(address.submit(), false);
      assert.equal(address.snapshot().dialog, null);
      assert.equal(address.snapshot().rightDisabled, true);
    }
  });
