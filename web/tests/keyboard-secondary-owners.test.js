import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { indexLayout } from '../src/animation.js';
import { createMenuScenes, MENU_SCENE_LAYOUTS } from '../src/menu-scenes.js';
import { createBoardCreate } from '../src/board-create.js';
import { createIncomingLetterSession } from '../src/incoming-letter-session.js';
import { createSettingsKeyboard } from '../src/settings-keyboard.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && MENU_SCENE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available ? Object.fromEntries(MENU_SCENE_LAYOUTS.map((key) => [
  key, JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
])) : {};
const sourceTest = { skip: !available };
const secondary = { secondary: true };
const getKeyboardPreferences = () => ({ layoutMode: 'phone', phoneMode: 1 });
const contact = { kind: 'wii', address: '1234567812345678', nickname: 'S' };
const date = new Date(2026, 8, 21, 12);
const incoming = {
  kind: 'letter', id: 'secondary-owner-letter', createdAt: date.toISOString(),
  header: 'Synthetic sender', text: 'Synthetic Letter', sender: contact,
  photo: null, readAt: null, position: { x: 0, y: 50 },
};

function rejectSecondary(owner, ids, snapshot = () => owner.snapshot()) {
  const before = snapshot();
  for (const id of ids) assert.equal(owner.activate(id, secondary), false, id);
  assert.deepEqual(snapshot(), before, 'rejected input leaves its owner unchanged');
}

function textPane(owner, prefix, name) {
  const layer = owner.presentation().layers.findLast((item) => item.prefix === prefix);
  assert.ok(layer, prefix);
  return indexLayout(layer.layout).panes.get(name).text;
}

function enterContact(create) {
  create.advance(39);
  create.activate('address');
  create.advance(29);
  rejectSecondary(create, ['address-next', 'submit']);
  create.activate('address-next');
  create.advance(15);
  create.activate('address-entry-0');
  create.advance(53);
}

test('Settings forwards secondary triggers only while its field keyboard accepts input', sourceTest, () => {
  const completed = [];
  const settings = createSettingsKeyboard(layouts, {
    getKeyboardPreferences, onComplete: (value) => completed.push(value),
  });
  const snapshot = () => settings.getSnapshot();
  rejectSecondary(settings, ['key-phone-1'], snapshot);
  settings.open({ requestId: 1, formId: 1, profile: 'console-nickname', text: '' });
  rejectSecondary(settings, ['key-phone-1'], snapshot);
  settings.advance(30);
  assert.equal(settings.activate('key-phone-1', secondary), true);
  assert.equal(settings.getSnapshot().keyboard.text, '2');
  assert.equal(settings.activate('key-phone-1', secondary), true);
  assert.equal(settings.getSnapshot().keyboard.text, 'c');
  rejectSecondary(settings, ['key-back', 'key-ok', 'key-delete'], snapshot);
  settings.activate('key-ok');
  rejectSecondary(settings, ['key-phone-1'], snapshot);
  settings.advance(30);
  assert.equal(completed.length, 1);
  assert.equal(settings.active, false);
});

test('Menu and Create forward secondary triggers through the active Memo editor', sourceTest, () => {
  const drafts = [];
  const scene = createMenuScenes(layouts, {
    getKeyboardPreferences, onDraft: (value) => drafts.push(value),
  });
  scene.open('board');
  scene.advance(40);
  rejectSecondary(scene, ['create', 'calendar', 'next']);
  scene.activate('create');
  scene.advance(39);
  rejectSecondary(scene, ['memo', 'letter', 'address', 'back']);
  scene.activate('memo');
  scene.advance(27);
  rejectSecondary(scene, ['memo-edit', 'submit', 'back']);
  scene.activate('memo-edit');
  rejectSecondary(scene, ['key-phone-1']);
  scene.advance(30);
  assert.equal(scene.activate('key-phone-1', secondary), true);
  assert.equal(drafts.at(-1), '2');
  assert.equal(scene.activate('key-phone-1', secondary), true);
  assert.equal(drafts.at(-1), 'c');
  rejectSecondary(scene, ['key-back', 'key-ok', 'memo-scroll-down']);
  scene.keyInput('Escape');
  scene.advance(30);
  assert.equal(scene.snapshot().editing, false);
  rejectSecondary(scene, ['memo-edit', 'submit']);
});

test('Create forwards secondary triggers through Address nickname and local Letter children',
  sourceTest, () => {
    for (const child of ['address', 'letter']) {
      const create = createBoardCreate(layouts, {
        contacts: [contact], letterService: 'local', getKeyboardPreferences,
      });
      enterContact(create);
      rejectSecondary(create, ['address-edit-name', 'address-send', 'address-erase']);
      if (child === 'address') {
        create.activate('address-edit-name');
        create.advance(100);
        rejectSecondary(create, ['address-edit', 'submit']);
        create.activate('address-edit');
        create.keyInput('Backspace');
      } else {
        create.activate('address-send');
        create.advance(40);
        create.advance(17);
        rejectSecondary(create, ['letter-edit', 'submit', 'back']);
        create.activate('letter-edit');
        create.advance(30);
      }
      assert.equal(create.activate('key-phone-1', secondary), true, child);
      assert.equal(create.activate('key-phone-1', secondary), true, child);
      const value = child === 'address'
        ? textPane(create, 'keyboard-text:', 'T_2l_TextBox')
        : create.snapshot().letter.text;
      assert.equal(value, 'c', child);
      rejectSecondary(create, ['key-back', 'key-ok', 'key-delete', 'key-phone-mode-2']);
      create.dispose();
      rejectSecondary(create, ['key-phone-1']);
    }
  });

test('Menu, MemoBoard and incoming session forward B only into the active Reply keyboard',
  sourceTest, () => {
    const scene = createMenuScenes(layouts, {
      memos: [incoming], letterService: 'local', getKeyboardPreferences,
    });
    scene.open('board');
    scene.presentation({ date });
    scene.advance(50);
    rejectSecondary(scene, [`memo-open-${incoming.id}`]);
    scene.activate(`memo-open-${incoming.id}`);
    scene.advance(26);
    rejectSecondary(scene, ['incoming-reply', 'incoming-trash', 'incoming-back']);
    scene.activate('incoming-reply');
    scene.advance(47);
    scene.advance(30);
    rejectSecondary(scene, ['letter-edit', 'submit', 'back']);
    scene.activate('letter-edit');
    scene.advance(30);
    assert.equal(scene.activate('key-phone-1', secondary), true);
    assert.equal(scene.activate('key-phone-1', secondary), true);
    assert.equal(textPane(scene, 'letter-body:', 'T_Letter'), 'c');
    rejectSecondary(scene, ['incoming-trash', 'incoming-back', 'key-back']);
    scene.open('options');
    scene.advance(32);
    rejectSecondary(scene, ['key-phone-1', 'data', 'system', 'back']);
  });

test('secondary triggers cannot operate storage, Calendar or incoming service dialogs', sourceTest, () => {
  const scene = createMenuScenes(layouts);
  scene.advance(32);
  scene.activate('data');
  scene.advance(56);
  scene.activate('save');
  scene.advance(56);
  scene.activate('wii');
  scene.advance(108);
  rejectSecondary(scene, ['storage-sd', 'storage-wii', 'storage-next', 'back']);
  scene.open('board');
  scene.advance(40);
  scene.activate('calendar');
  scene.advance(60);
  rejectSecondary(scene, scene.presentation().controls.map((item) => item.id));

  const session = createIncomingLetterSession(layouts, { record: incoming });
  session.advance(26);
  session.activate('incoming-reply');
  session.advance(21);
  session.advance(100);
  assert.equal(session.snapshot().modal, true);
  rejectSecondary(session, ['network-quit', 'network-settings', 'incoming-back']);
});
