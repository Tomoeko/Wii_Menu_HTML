import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createMenuScenes, MENU_SCENE_LAYOUTS } from '../src/menu-scenes.js';
import { createBoardMemos } from '../src/board-memos.js';
import { createIncomingLetterSession } from '../src/incoming-letter-session.js';
import { indexLayout } from '../src/animation.js';
import { createDisplay } from '../src/display.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && MENU_SCENE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available ? Object.fromEntries(MENU_SCENE_LAYOUTS.map((key) => [
  key, JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
])) : {};
const sourceTest = { skip: !available };
const date = new Date(2026, 8, 21, 12);
const record = (overrides = {}) => ({
  kind: 'letter', id: 'incoming-integration', createdAt: date.toISOString(),
  header: 'Synthetic sender', text: 'A locally imported Letter.',
  sender: { kind: 'wii', address: '1234567812345678', nickname: 'Synthetic' },
  photo: null, readAt: null, position: { x: 100, y: 80 }, ...overrides,
});
const pane = (view, prefix, name) => indexLayout(
  view.layers.find((entry) => entry.prefix === prefix).layout,
).panes.get(name);

test('Board removes only the committed incoming record after exit and retains every other card',
  sourceTest, async () => {
    let resolve;
    const writes = [];
    const second = record({ id: 'incoming-second', header: 'Other sender' });
    const memo = { id: 'memo-preserved', text: 'Keep this Memo', createdAt: date.toISOString(),
      readAt: null, position: { x: -100, y: 70 } };
    const board = createBoardMemos(layouts, {
      date, memos: [record(), second, memo], onMemos: (value) => writes.push(value),
      onEraseLetter: (id) => {
        assert.equal(id, record().id);
        return new Promise((done) => { resolve = done; });
      },
    });
    board.advance(20);
    board.activate(`memo-open-${record().id}`);
    board.advance(26);
    board.activate('incoming-trash');
    board.advance(33);
    board.advance(100);
    board.activate('memo-erase-yes');
    board.advance(100);
    assert.equal(board.snapshot().erasing, true);
    assert.equal(board.presentation().layers.some((entry) =>
      entry.prefix === `memo-card-${record().id}:`), false);
    board.advance(100);
    assert.equal(board.records().length, 3);
    const beforeCommit = writes.length;
    resolve();
    await Promise.resolve();
    assert.equal(board.snapshot().reading, false);
    assert.equal(board.records().length, 2);
    assert.deepEqual(board.records(), [second, memo]);
    assert.equal(writes.length, beforeCommit + 1);
    assert.deepEqual(writes.at(-1), [second, memo]);
    assert.deepEqual(board.presentation().controls.map(({ id }) => id),
      ['memo-open-incoming-second', 'memo-open-memo-preserved']);
  });

test('Board selects an incoming Letter, persists read state and restores its card after Back',
  sourceTest, () => {
    const writes = [];
    const sounds = [];
    const board = createBoardMemos(layouts, {
      date, now: () => date, memos: [record()],
      onMemos: (value) => writes.push(value), onSound: (name) => sounds.push(name),
    });
    board.advance(20);
    assert.equal(board.activate('memo-open-incoming-integration'), true);
    assert.equal(board.snapshot().scene, 'incoming-letter');
    assert.equal(board.snapshot().reading, true);
    assert.equal(writes.at(-1)[0].readAt, date.toISOString());
    assert.deepEqual(writes.at(-1)[0].sender, record().sender);
    assert.equal(sounds.filter((name) => name === 'WIPL_SE_BOARD_SELECT').length, 1);
    board.advance(26);
    assert.equal(pane(board.presentation(), 'incoming-letter:', 'T_Header').text, record().header);
    assert.equal(board.back(), true);
    board.advance(47);
    assert.equal(board.snapshot().reading, false);
    assert.equal(board.presentation().controls[0].id, 'memo-open-incoming-integration');
    assert.deepEqual(board.records()[0].position, record().position);
  });

test('offline incoming Reply owns the configuration dialog and returns input to the reader',
  sourceTest, () => {
    const actions = [];
    const session = createIncomingLetterSession(layouts, {
      record: record(), onAction: (action) => actions.push(action),
    });
    session.advance(26);
    assert.equal(session.activate('incoming-reply'), true);
    session.advance(21);
    assert.equal(session.snapshot().modal, true);
    session.advance(layouts.my_DialogWindow_a2.animations.my_DialogWindow_a2_DialogIn.frames);
    assert.deepEqual(session.presentation().controls.map(({ id }) => id),
      ['network-quit', 'network-settings']);
    assert.equal(session.activate('incoming-back'), false);
    assert.equal(session.activate('network-quit'), true);
    session.advance(100);
    assert.equal(session.snapshot().modal, false);
    assert.equal(session.snapshot().reading, true);
    assert.deepEqual(actions, []);
    session.activate('incoming-reply');
    session.advance(21);
    session.advance(layouts.my_DialogWindow_a2.animations.my_DialogWindow_a2_DialogIn.frames);
    session.activate('network-settings');
    session.advance(100);
    assert.deepEqual(actions, ['network-settings']);
  });

test('local Reply uses the existing composer, preserves a canceled draft and disposes on date change',
  sourceTest, () => {
    const board = createBoardMemos(layouts, { date, memos: [record()], letterService: 'local' });
    board.advance(20);
    board.activate('memo-open-incoming-integration');
    board.advance(26);
    board.activate('incoming-reply');
    board.advance(47);
    assert.equal(board.snapshot().composing, true);
    board.advance(30);
    assert.equal(board.presentation().controls.some(({ id }) => id === 'letter-edit'), true);
    board.activate('letter-edit');
    board.advance(30);
    board.keyInput('R');
    board.keyInput('e');
    assert.equal(board.snapshot().editing, true);
    assert.equal(board.keyInput('Escape', { type: 'keydown' }), true);
    board.advance(30);
    assert.equal(board.keyInput('Escape', { type: 'keyup' }), false);
    assert.equal(board.snapshot().composing, true);
    assert.equal(board.snapshot().editing, false);
    assert.equal(board.back(), true);
    board.advance(30);
    board.advance(30);
    assert.equal(board.snapshot().composing, false);
    board.activate('incoming-reply');
    board.advance(47);
    board.advance(30);
    assert.equal(pane(board.presentation(), 'letter-body:', 'T_Letter').text, 'Re');
    board.setDate(new Date(2026, 8, 22, 12));
    assert.equal(board.snapshot().reading, false);
    assert.equal(board.snapshot().memoCount, 0);
    assert.equal(board.presentation().layers.some(({ prefix }) => prefix === 'letter-body:'), false);
  });

test('menu routing passes reader, photo and composer controls through the scene boundary',
  sourceTest, () => {
    const scene = createMenuScenes(layouts, {
      memos: [record()], display: createDisplay('16:9'), letterService: 'local',
    });
    scene.open('board');
    scene.presentation({ date });
    scene.advance(50);
    assert.equal(scene.activate('memo-open-incoming-integration'), true);
    scene.advance(26);
    assert.equal(scene.activate('incoming-reply'), true);
    scene.advance(47);
    scene.advance(30);
    assert.equal(scene.activate('letter-edit'), true);
    scene.advance(30);
    assert.equal(scene.snapshot().editing, true);
    assert.equal(scene.keyInput('T'), true);
    scene.open('options');
    assert.equal(scene.snapshot().readingMemo, false);
    assert.equal(scene.snapshot().editing, false);
  });
