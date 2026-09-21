import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CREATE_LAYOUTS, createBoardCreate } from '../src/board-create.js';
import { indexLayout, poseLayout } from '../src/animation.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && CREATE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available ? Object.fromEntries(CREATE_LAYOUTS.map((key) => [key,
  JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
])) : {};
const sourceTest = { skip: !available };
const contacts = [
  { kind: 'wii', address: '1234567812345678', nickname: 'First' },
  { kind: 'email', address: 'second@example.test', nickname: 'Second' },
];
const attachments = [
  { id: 'first-photo', width: 256, height: 192,
    localSrc: '/assets/local-letters/first-photo.png', sha256: 'a'.repeat(64) },
  { id: 'second-photo', width: 320, height: 240,
    localSrc: '/assets/local-letters/second-photo.png', sha256: 'b'.repeat(64) },
];
const fixture = (options = {}) => {
  const create = createBoardCreate(layouts, { contacts, letterService: 'local', ...options });
  create.advance(39);
  return create;
};
const choose = (create, index = 0) => {
  assert.equal(create.activate('letter'), true);
  create.advance(41);
  assert.equal(create.activate(`address-entry-${index}`), true);
  create.advance(43);
  assert.equal(create.snapshot().letter.frame, 0);
  create.advance(17);
};
const write = (create, value) => {
  assert.equal(create.activate('letter-edit'), true);
  create.advance(30);
  for (const character of value) assert.equal(create.keyInput(character), true);
  assert.equal(create.activate('key-ok'), true);
  create.advance(30);
};
const cancelComposer = (create) => {
  assert.equal(create.back(), true);
  create.advance(50);
  assert.equal(create.snapshot().page, 'selector');
  assert.equal(create.snapshot().frame, 0);
  create.advance(27);
};
const footer = (create) => indexLayout(create.presentation().layers.find(
  ({ prefix }) => prefix === 'letter-footer:',
).layout).panes;

test('local Letter selector owns only its source transition and hands an entered footer to its composer',
  sourceTest, () => {
    const original = JSON.stringify(layouts);
    const create = fixture();
    assert.equal(create.activate('letter'), true);
    let view = create.presentation();
    assert.equal(create.snapshot().networkDialog, false);
    assert.equal(create.snapshot().page, 'letter-picker');
    assert.equal(create.snapshot().duration, 27, 'original LetterIn belongs to the parent');
    assert.equal(view.layers.filter(({ prefix }) => prefix.includes('footer:')).length, 1);
    assert.ok(view.layers.some(({ prefix }) => prefix === 'recipient-footer:'));
    assert.ok(view.controls.every(({ disabled }) => disabled));
    create.advance(41);
    assert.equal(create.snapshot().recipientPicker.step, 'book');
    assert.equal(create.activate('address-entry-1'), true);
    create.advance(42);
    assert.equal(create.snapshot().letter, null);
    create.advance(1000);
    assert.equal(create.snapshot().letter.phase, 'enter');
    assert.equal(create.snapshot().letter.frame, 0, 'departed picker does not advance the new child');
    assert.deepEqual(create.snapshot().letter.recipient, contacts[1]);
    view = create.presentation();
    assert.ok(view.layers.every(({ prefix }) => prefix.startsWith('letter-')));
    assert.equal(footer(create).get('T_CalExit').text, 'Quit');
    const source = layouts.my_IplTop_e;
    const expected = indexLayout(poseLayout(source, [{ animation: source.animations.my_IplTop_e,
      group: 'G_SeenChange', frame: 3326, loop: false }])).panes;
    for (const name of source.groups.G_SeenChange)
      assert.deepEqual(footer(create).get(name).translation, expected.get(name).translation, name);
    assert.equal(JSON.stringify(layouts), original);
  });

test('picker cancellation restores Create after its departure, without selecting or writing a contact',
  sourceTest, () => {
    const calls = [];
    const create = fixture({ onLetter: (value) => calls.push(value),
      onContacts: (value) => calls.push(value), onBack: () => calls.push('back') });
    create.activate('letter');
    create.advance(41);
    assert.equal(create.keyInput('Escape', { type: 'keyup' }), false);
    assert.equal(create.keyInput('Escape'), true);
    create.advance(48);
    assert.equal(create.snapshot().page, 'letter-picker');
    create.advance(500);
    assert.equal(create.snapshot().page, 'selector');
    assert.equal(create.snapshot().duration, 27, 'source LetterOut starts after child completion');
    assert.equal(create.snapshot().frame, 0);
    create.advance(27);
    assert.deepEqual(create.presentation().controls.map(({ id }) => id),
      ['memo', 'letter', 'address', 'back']);
    assert.deepEqual(calls, []);
  });

test('Quit restores the route-zero footer and retains a separate draft for each recipient',
  sourceTest, () => {
    const calls = [];
    const create = fixture({ onLetter: (value) => calls.push(value), onBack: () => calls.push('back') });
    choose(create);
    write(create, 'First draft');
    assert.equal(create.back(), true);
    create.advance(34);
    assert.equal(footer(create).get('T_CalExit').text, 'Quit');
    create.advance(1);
    assert.equal(footer(create).get('T_CalExit').text, 'Back');
    create.advance(14);
    assert.equal(create.snapshot().page, 'letter');
    create.advance(1);
    assert.equal(create.snapshot().page, 'selector');
    assert.equal(create.snapshot().frame, 0);
    create.advance(27);
    choose(create, 1);
    assert.equal(create.snapshot().letter.text, '');
    write(create, 'Second draft');
    cancelComposer(create);
    choose(create);
    assert.equal(create.snapshot().letter.text, 'First draft');
    cancelComposer(create);
    choose(create, 1);
    assert.equal(create.snapshot().letter.text, 'Second draft');
    assert.deepEqual(calls, []);
  });

test('local Letter selection sends only the chosen recipient and leaves Create after the commit',
  sourceTest, async () => {
    const calls = [];
    let complete;
    const create = fixture({ onLetter: (payload) => {
      calls.push(payload);
      return new Promise((resolve) => { complete = resolve; });
    }, onBack: () => calls.push('back') });
    choose(create, 1);
    write(create, 'Local text');
    assert.equal(create.activate('submit'), true);
    create.advance(21);
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].recipient, contacts[1]);
    assert.equal(calls[0].attachment, null);
    create.advance(211);
    assert.equal(create.snapshot().letter.phase, 'saving');
    complete();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(create.snapshot().page, 'selector');
    assert.equal(create.snapshot().frame, 0);
    assert.equal(create.snapshot().duration, 21);
    create.advance(20);
    assert.equal(calls.length, 1);
    create.advance(1);
    assert.equal(create.snapshot().page, 'closed');
    assert.equal(calls.at(-1), 'back');
    create.advance(100);
    assert.equal(calls.length, 2);
  });

test('Create passes the verified photo catalog into the local Letter picker', sourceTest, () => {
  const create = fixture({ attachments });
  choose(create);
  assert.equal(create.activate('letter-photo'), true);
  assert.equal(create.snapshot().letter.pickerOpen, true);
  assert.deepEqual(create.presentation().controls.map(({ id }) => id), [
    'letter-attachment-0', 'letter-attachment-1', 'letter-picker-cancel',
  ]);
  assert.equal(create.activate('letter-attachment-1'), true);
  assert.deepEqual(create.snapshot().letter.attachment, attachments[1]);
  assert.equal(create.snapshot().letter.pickerOpen, false);
});

test('disposing a departing picker prevents recipient handoff and allows a clean Create reopen',
  sourceTest, () => {
    const calls = [];
    const create = fixture({ onLetter: (payload) => calls.push(payload),
      onBack: () => calls.push('back') });
    create.activate('letter');
    create.advance(41);
    create.activate('address-entry-0');
    create.advance(20);
    create.dispose();
    create.advance(1000);
    assert.equal(create.snapshot().letter, null);
    assert.equal(create.snapshot().recipientPicker, null);
    assert.deepEqual(calls, []);
    create.open();
    create.advance(39);
    choose(create, 1);
    assert.deepEqual(create.snapshot().letter.recipient, contacts[1]);
    assert.equal(create.snapshot().letter.text, '');
  });
