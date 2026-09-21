import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { indexLayout } from '../src/animation.js';
import { createBoardAddress } from '../src/board-address.js';
import { createLetterRecipientPicker, LETTER_RECIPIENT_LAYOUTS } from '../src/letter-recipient-picker.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && LETTER_RECIPIENT_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available ? Object.fromEntries(LETTER_RECIPIENT_LAYOUTS.map((key) => [key,
  JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
])) : {};
const contact = { kind: 'wii', address: '1234567812345678', nickname: 'Synthetic' };
const pane = (picker, prefix, name) => indexLayout(picker.presentation().layers
  .find((layer) => layer.prefix === prefix).layout).panes.get(name);

test('recipient mode uses the original prompt and opens page one after entry, retaining sparse slots',
  { skip: !available }, () => {
    const pristine = JSON.stringify(layouts);
    const contacts = [...Array(7).fill(null), contact];
    const picker = createLetterRecipientPicker(layouts, { contacts });
    assert.equal(picker.snapshot().page, 0);
    assert.equal(pane(picker, 'address-prompt:', 'T_Dialog').text, 'Choose an address');
    assert.equal(picker.activate('address-next'), false);
    picker.advance(25);
    assert.equal(picker.snapshot().bookGeometry.state, 'cover');
    picker.advance(1);
    assert.equal(picker.snapshot().bookGeometry.state, 'cover-forward');
    picker.advance(14);
    assert.equal(picker.snapshot().locked, true);
    picker.advance(1);
    assert.equal(picker.snapshot().page, 1);
    assert.equal(picker.snapshot().locked, false);
    assert.equal(picker.snapshot().rightLabel, '');
    assert.equal(picker.controls().filter((item) => item.id.startsWith('address-entry-'))
      .every((item) => item.disabled), true);
    assert.equal(picker.activate('address-next'), true);
    picker.advance(16);
    assert.equal(picker.snapshot().page, 2);
    assert.equal(pane(picker, 'address-book:', 'T_name_b_02').text, 'Synthetic');
    assert.deepEqual(picker.snapshot().contacts, contacts);
    assert.equal(JSON.stringify(layouts), pristine);
  });

test('empty recipient book remains on cover and offers browsing and cancellation without registration',
  { skip: !available }, () => {
    const picker = createLetterRecipientPicker(layouts);
    picker.advance(100);
    assert.equal(picker.snapshot().page, 0);
    assert.deepEqual(picker.controls().map((item) => item.id),
      ['address-prev', 'address-next', 'recipient-back']);
    assert.equal(picker.activate('address-prev'), true);
    picker.advance(15);
    assert.equal(picker.snapshot().page, 20);
    assert.equal(picker.activate('address-entry-0'), false);
    const address = createBoardAddress(layouts, { mode: 'recipient' });
    address.advance(26);
    assert.equal(address.submit(), false);
  });

test('recipient selection bypasses contact actions and waits for departure before the composer handoff',
  { skip: !available }, () => {
    const recipients = [];
    const sounds = [];
    const picker = createLetterRecipientPicker(layouts, {
      contacts: [contact, { kind: 'email', address: 'synthetic@example.test', nickname: 'Mail' }],
      onSelect: (...args) => recipients.push(args), onSound: (cue) => sounds.push(cue),
    });
    picker.advance(41);
    assert.equal(picker.activate('address-entry-1'), true);
    assert.equal(picker.snapshot().step, 'book');
    assert.equal(picker.back(), false);
    picker.advance(15);
    assert.equal(pane(picker, 'recipient-footer:', 'T_CalExit').text, 'Quit');
    assert.equal(pane(picker, 'recipient-footer:', 'T_CalAdd_R').text, 'Send');
    picker.advance(15);
    assert.equal(picker.snapshot().locked, true, 'the footer completes before the prompt departure');
    assert.equal(pane(picker, 'recipient-footer:', 'T_CalExit').text, 'Quit');
    picker.advance(12);
    assert.deepEqual(recipients, []);
    picker.advance(1000);
    assert.deepEqual(recipients, [[{
      kind: 'email', address: 'synthetic@example.test', nickname: 'Mail',
    }, { footerAlreadyEntered: true }]]);
    assert.equal(picker.snapshot().closed, true);
    assert.deepEqual(picker.controls(), []);
    assert.deepEqual(sounds, ['WIPL_SE_FL_PAGE_INC', 'WIPL_SE_DECIDE']);
    picker.advance(1000);
    assert.equal(recipients.length, 1);
  });

test('pending local contacts show original message 87, have no hover cue, and never become recipients',
  { skip: !available }, () => {
    const recipients = [];
    const sounds = [];
    const picker = createLetterRecipientPicker(layouts, {
      contacts: [{ ...contact, confirmed: false }, contact],
      messages: { 87: 'Original pending-registration message' },
      onSelect: (value) => recipients.push(value), onSound: (cue) => sounds.push(cue),
    });
    picker.advance(41);
    const book = picker.presentation().layers.find((layer) => layer.prefix === 'address-book:').layout;
    const panes = indexLayout(book).panes;
    assert.deepEqual(book.materials[panes.get('T_name_b_00').material].colors[0], [200, 200, 200, 0]);
    assert.deepEqual(book.materials[panes.get('T_name_b_01').material].colors[0], [120, 120, 120, 0]);
    assert.equal(picker.hover('address-entry-0'), false);
    assert.deepEqual(sounds, ['WIPL_SE_FL_PAGE_INC']);
    assert.equal(picker.activate('address-entry-0'), true);
    assert.equal(pane(picker, 'address-dialog:', 'T_Dialog').text,
      'Original pending-registration message');
    assert.equal(picker.presentation().layers.some((layer) => layer.prefix === 'recipient-footer:'), false);
    picker.advance(100);
    assert.deepEqual(picker.controls().map((item) => item.id), ['address-pending-ok']);
    assert.equal(picker.activate('address-pending-ok'), true);
    picker.advance(100);
    assert.equal(picker.snapshot().modal, false);
    assert.equal(picker.snapshot().page, 1);
    assert.deepEqual(recipients, []);
    assert.equal(picker.hover('address-entry-1'), true);
    assert.equal(sounds.at(-1), 'WIPL_SE_BT_TARGETTING');
  });

test('Back cancels after the complete footer queue and disposal suppresses pending completion',
  { skip: !available }, () => {
    for (const contacts of [[], [contact]]) {
      const results = [];
      const picker = createLetterRecipientPicker(layouts, {
        contacts, onSelect: () => results.push('selected'), onCancel: () => results.push('cancelled'),
      });
      picker.advance(41);
      assert.equal(picker.back(), true);
      picker.advance(26);
      assert.equal(picker.snapshot().finished, true, 'book and prompt finished departure');
      assert.deepEqual(results, [], 'footer still owns the transition');
      picker.advance(22);
      assert.deepEqual(results, []);
      picker.advance(1);
      assert.deepEqual(results, ['cancelled']);
      picker.advance(100);
      assert.deepEqual(results, ['cancelled']);
    }
    const results = [];
    const picker = createLetterRecipientPicker(layouts, {
      contacts: [contact], onSelect: () => results.push('selected'), onCancel: () => results.push('cancelled'),
    });
    picker.advance(41);
    picker.activate('address-entry-0');
    picker.advance(42);
    picker.dispose();
    picker.advance(1000);
    assert.deepEqual(results, []);
  });

test('recipient fixture rejects ambiguous confirmation and invalid deltas', { skip: !available }, () => {
  assert.throws(() => createLetterRecipientPicker(layouts, {
    contacts: [{ ...contact, confirmed: 'yes' }],
  }), /confirmation/);
  const picker = createLetterRecipientPicker(layouts);
  for (const frames of [-1, Infinity, NaN]) assert.throws(() => picker.advance(frames), /delta/);
});
