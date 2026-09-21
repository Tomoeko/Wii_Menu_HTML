import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  createBoardMemos,
  MEMO_LAYOUTS,
  memoPosition,
  memoThumbnail,
  newMemoPosition,
  memoSummary,
} from '../src/board-memos.js';
import { indexLayout, poseLayout } from '../src/animation.js';
import { createDisplay } from '../src/display.js';
import { renderedArrow } from './helpers/rendered-arrow.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && MEMO_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      MEMO_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
      ]),
    )
  : {};
const sourceTest = { skip: !available };
const date = new Date(2026, 8, 17, 12);
const record = (id, text = 'Testing one memo', at = date) => ({
  id,
  text,
  createdAt: at.toISOString(),
});
const pane = (layout, name) => indexLayout(layout).panes.get(name);
const layer = (view, prefix) => view.layers.find((item) => item.prefix === prefix)?.layout;
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} differs from ${expected}`);

test('incoming cards use original LetterS_b and header previews while Memo keeps its body',
  sourceTest, () => {
    const original = JSON.stringify(layouts);
    const incoming = {
      ...record('incoming-card', 'Body must not become the card preview'),
      kind: 'letter', header: 'Header\nsecond line',
      sender: { kind: 'wii', address: '1234567812345678', nickname: 'Synthetic' },
      photo: null, position: { x: 100, y: 80 },
    };
    const board = createBoardMemos(layouts, {
      date, now: () => date, memos: [record('memo-card', 'Memo preview'), incoming],
    });
    board.advance(20);
    const view = board.presentation();
    const letter = layer(view, 'memo-card-incoming-card:');
    const memo = layer(view, 'memo-card-memo-card:');
    assert.equal(letter.name, 'LetterS_b');
    assert.equal(memo.name, 'LetterS_a');
    assert.equal(pane(letter, 'T_Letter').text, 'Header');
    assert.equal(pane(memo, 'T_Letter').text, 'Memo p...');
    assert.equal(pane(letter, 'Nigaoe').flags & 1, 0);
    assert.equal(pane(letter, 'N_Pic').flags & 1, 0);
    board.activate('memo-open-incoming-card');
    board.advance(4);
    const expected = poseLayout(layouts.LetterS_b, [
      { animation: layouts.LetterS_b.animations.LetterS_b_PasteLetter, frame: 24 },
      { animation: layouts.LetterS_b.animations.LetterS_b_SelectLetter, frame: 4 },
    ]);
    const actualLetter = pane(layer(board.presentation(), 'memo-card-incoming-card:'), 'N_Letter');
    for (const property of ['translation', 'rotation', 'scale', 'size', 'alpha', 'flags'])
      assert.deepEqual(actualLetter[property], pane(expected, 'N_Letter')[property], property);
    assert.equal(JSON.stringify(layouts), original);
  });

test('photo Letters do not expose the resource sample as a fabricated card thumbnail',
  sourceTest, () => {
    const photo = { id: 'card-photo', width: 512, height: 256,
      localSrc: '/assets/local-letters/card-photo.png', sha256: 'a'.repeat(64) };
    const board = createBoardMemos(layouts, {
      date, memos: [{ ...record('photo-card', ''), kind: 'letter', header: 'Photo message',
        sender: { kind: 'email', nickname: 'Synthetic', address: 'synthetic@example.test' },
        photo }],
    });
    board.advance(20);
    const card = layer(board.presentation(), 'memo-card-photo-card:');
    assert.equal(card.name, 'LetterS_b');
    assert.equal(pane(card, 'T_Letter').text, 'Photo ...');
    assert.equal(pane(card, 'N_Pic').flags & 1, 0);
    board.activate('memo-open-photo-card');
    board.advance(26);
    assert.ok(board.presentation().controls.some(({ id }) => id === 'incoming-photo'));
    assert.deepEqual(board.records()[0].photo, photo);
  });

test('crowded dates page ten records at a time without losing or modifying records', sourceTest, () => {
  const records = Array.from({ length: 23 }, (_, index) => ({
    ...record(`record-${index}`, `Message ${index}`, new Date(2026, 8, 17, 12, index)),
    position: { x: 0, y: 53 },
    readAt: null,
  }));
  const writes = [];
  const sounds = [];
  const board = createBoardMemos(layouts, {
    date, memos: records, onMemos: (value) => writes.push(value),
    onSound: (symbol, options) => sounds.push({ symbol, options }),
  });
  board.advance(20);
  assert.equal(board.snapshot().pageCount, 3);
  assert.equal(board.snapshot().memoCount, 10);
  assert.equal(board.snapshot().dayMemoCount, 23);
  assert.equal(board.presentation().controls[0].id, 'memo-open-record-22');
  assert.equal(board.canTurnPage('next'), false);
  assert.equal(board.turnPage('prev'), true);
  assert.equal(board.turnPage('prev'), false);
  assert.equal(board.activate('memo-open-record-22'), false);
  board.advance(7.5);
  near(layer(board.presentation(), 'memo-card-record-22:').root.translation[0], 152);
  board.advance(7.5);
  assert.equal(board.snapshot().page, 1);
  assert.equal(board.presentation().controls[0].id, 'memo-open-record-12');
  assert.equal(board.turnPage('prev'), true);
  board.advance(15);
  assert.equal(board.snapshot().memoCount, 3);
  assert.equal(board.canTurnPage('prev'), false);
  assert.equal(board.turnPage('next'), true);
  board.advance(15);
  assert.equal(board.presentation().controls[0].id, 'memo-open-record-12');
  assert.deepEqual(board.records(), records);
  assert.deepEqual(writes, []);
  assert.deepEqual(sounds.map((entry) => entry.symbol), Array(3).fill('WIPL_SE_MSG_HOUSE'));
  assert.ok(sounds[0].options.pan > 0 && sounds[2].options.pan < 0);
  board.setDate(new Date(2026, 8, 18, 12));
  assert.equal(board.snapshot().page, 0);
  assert.equal(board.snapshot().memoCount, 0);
  board.setDate(date);
  assert.equal(board.snapshot().memoCount, 10);
});

test('erasing the last older-page memo and posting preserve page boundaries', sourceTest, () => {
  const records = Array.from({ length: 11 }, (_, index) => ({
    ...record(`record-${index}`, `Message ${index}`, new Date(2026, 8, 17, 12, index)),
    position: { x: 0, y: 53 },
  }));
  const writes = [];
  const board = createBoardMemos(layouts, {
    date,
    memos: records,
    onMemos: (value) => writes.push(value),
  });
  board.advance(20);
  board.turnPage('prev');
  board.advance(26);
  assert.equal(board.snapshot().page, 1);
  assert.equal(board.activate('memo-open-record-0'), true);
  board.advance(26);
  board.activate('memo-trash');
  board.advance(59);
  board.activate('memo-erase-yes');
  board.advance(47);
  board.advance(17);
  assert.equal(board.snapshot().page, 0);
  assert.equal(board.snapshot().pageCount, 1);
  assert.equal(board.snapshot().memoCount, 10);
  assert.equal(board.records().some((entry) => entry.id === 'record-0'), false);
  assert.equal(writes.at(-1).length, 10);

  board.addMemo(record('next', 'Next message', new Date(2026, 8, 17, 13)));
  board.advance(11);
  board.turnPage('prev');
  board.advance(26);
  assert.equal(board.snapshot().page, 1);
  board.addMemo(record('newest', 'Newest message', new Date(2026, 8, 17, 14)));
  assert.equal(board.snapshot().page, 0);
  assert.equal(board.snapshot().pageCount, 2);
  assert.equal(board.presentation().controls[0].id, 'memo-open-newest');
  assert.equal(board.records().length, 12);
});

test('Memo card text follows the native six-unit first-line thumbnail', () => {
  assert.equal(memoThumbnail('1234567'), '123456...');
  assert.equal(memoThumbnail('123456'), '123456');
  assert.equal(memoThumbnail('Hi\nSecond line'), 'Hi');
  assert.deepEqual(memoPosition({ position: { x: 400, y: -300 } }, 0), [230, -80, 0]);
});

test('new-message pins sample past timestamps once per card appearance', sourceTest, () => {
  let currentTime = date.getTime();
  const records = [
    record('recent', 'Recent', new Date(currentTime - 21600000 + 1)),
    record('old', 'Old', new Date(currentTime - 21600000)),
    record('future', 'Future', new Date(currentTime + 1000)),
    record('current', 'Current', date),
  ];
  const board = createBoardMemos(layouts, {
    date,
    now: () => new Date(currentTime),
    memos: records,
  });
  const pinAlpha = (id) => pane(layer(board.presentation(), `memo-card-${id}:`), 'Pin2').alpha;
  assert.equal(pinAlpha('recent'), 255);
  assert.equal(pinAlpha('old'), 0);
  assert.equal(pinAlpha('future'), 0);
  assert.equal(pinAlpha('current'), 0);
  currentTime += 2000;
  board.advance(30);
  assert.equal(pinAlpha('recent'), 255);
  assert.equal(pinAlpha('future'), 0);
  board.setDate(new Date(2026, 8, 18, 12));
  board.setDate(date);
  assert.equal(pinAlpha('recent'), 0);
  assert.equal(pinAlpha('future'), 255);
});

test('empty local board remains empty and records belong to their local date', sourceTest, () => {
  const board = createBoardMemos(layouts, { date });
  assert.deepEqual(board.presentation().layers, []);
  assert.deepEqual(board.presentation().controls, []);
  assert.equal(board.addMemo(record('today')), true);
  assert.equal(board.addMemo(record('tomorrow', 'Tomorrow', new Date(2026, 8, 18, 12))), true);
  assert.equal(board.addMemo({ id: 'invalid', text: 'Bad date', createdAt: 'invalid' }), false);
  assert.equal(board.snapshot().memoCount, 1);
  board.advance(11);
  assert.equal(board.presentation().controls[0].id, 'memo-open-today');
  assert.equal(pane(layer(board.presentation(), 'memo-card-today:'), 'T_Letter').text, 'Testin...');
  board.setDate(new Date(2026, 8, 18, 12));
  assert.equal(board.presentation().controls[0].id, 'memo-open-tomorrow');
  board.setDate(new Date(2026, 8, 19, 12));
  assert.equal(board.snapshot().memoCount, 0);
});

test(
  'card hover retains its endpoint and brings only that card to the foreground',
  sourceTest,
  () => {
    const before = JSON.stringify(layouts);
    const board = createBoardMemos(layouts, {
      date,
      now: date,
      memos: [record('a'), record('b')],
    });
    board.advance(11);
    board.hover('memo-open-a');
    board.advance(7);
    const focused = pane(layer(board.presentation(), 'memo-card-a:'), 'N_Letter').scale;
    assert.equal(board.presentation().cardLayers.at(-1).prefix, 'memo-card-a:');
    board.advance(300);
    assert.deepEqual(pane(layer(board.presentation(), 'memo-card-a:'), 'N_Letter').scale, focused);
    board.hover(null);
    board.advance(7);
    near(pane(layer(board.presentation(), 'memo-card-a:'), 'N_Letter').scale[0], 1);
    assert.equal(JSON.stringify(layouts), before);
  },
);

test('posting to the current day runs only the arriving card paste animation', sourceTest, () => {
  const board = createBoardMemos(layouts, { date, memos: [record('old')] });
  board.advance(100);
  const oldPose = pane(layer(board.presentation(), 'memo-card-old:'), 'N_Letter').scale;
  board.addMemo(record('new'));
  assert.equal(
    board.presentation().controls.find((control) => control.id === 'memo-open-new').disabled,
    true,
  );
  assert.equal(
    board.presentation().controls.find((control) => control.id === 'memo-open-old').disabled,
    false,
  );
  assert.deepEqual(pane(layer(board.presentation(), 'memo-card-old:'), 'N_Letter').scale, oldPose);
  board.advance(10);
  assert.equal(board.activate('memo-open-new'), false);
  board.advance(1);
  assert.equal(board.activate('memo-open-new'), true);
});

test('posted cards start their pin animation only when the composer has exited', sourceTest, () => {
  const sounds = [],
    writes = [];
  const board = createBoardMemos(layouts, {
    date,
    onSound: (id) => sounds.push(id),
    onMemos: (value) => writes.push(value),
  });
  board.addMemo(record('pending'), { deferAppearance: true });
  assert.equal(writes.length, 1);
  board.advance(100);
  assert.equal(layer(board.presentation(), 'memo-card-pending:'), undefined);
  assert.deepEqual(sounds, []);
  board.revealPendingMemos();
  assert.ok(layer(board.presentation(), 'memo-card-pending:'));
  assert.equal(board.presentation().controls[0].disabled, true);
  assert.deepEqual(sounds, ['WIPL_SE_MSG_DISP']);
  board.advance(11);
  assert.equal(board.presentation().controls[0].disabled, false);
  board.revealPendingMemos();
  assert.equal(sounds.length, 1);
});

test(
  'reader keeps original linear root travel, wrapped strips, and common footer sequence',
  sourceTest,
  () => {
    let backs = 0;
    const board = createBoardMemos(layouts, {
      date,
      memos: [{ ...record('a', 'A wrapped memo'), position: { x: 170, y: 113 } }],
      display: createDisplay('16:9'),
      measureTextLines: () => 5,
      onBack: () => backs++,
    });
    board.advance(11);
    near(layer(board.presentation(), 'memo-card-a:').root.translation[0], (170 * 832) / 608);
    assert.equal(board.activate('memo-open-a'), true);
    assert.equal(board.snapshot().locked, true);
    assert.equal(board.snapshot().footerFrame, 3100);
    board.advance(8.5);
    let reader = layer(board.presentation(), 'memo-reader:');
    near(reader.root.translation[0], 85);
    near(reader.root.translation[1], 56.5);
    assert.equal(pane(reader, 'T_Header').text, 'Memo');
    assert.equal(pane(reader, 'T_Letter').text, 'A wrapped memo');
    assert.equal(
      pane(reader, 'N_MemoRoot').children.filter((value) => value.name.startsWith('MemoReadRow'))
        .length,
      4,
    );
    near(pane(reader, 'N_Footer').translation[1], -168);
    board.advance(17.5);
    assert.equal(board.snapshot().phase, 'read');
    assert.equal(board.snapshot().footerFrame, 3613);
    assert.equal(board.snapshot().scrollLimit, 122);
    for (const control of board.presentation().controls)
      assert.ok(pane(layer(board.presentation(), control.prefix), control.pane), control.id);
    assert.equal(board.back(), true);
    board.advance(19);
    assert.equal(board.snapshot().phase, 'back-select');
    board.advance(1);
    assert.equal(board.snapshot().phase, 'close');
    assert.equal(board.snapshot().footerFrame, 3620);
    board.advance(17);
    assert.equal(layer(board.presentation(), 'memo-reader:'), undefined);
    assert.equal(board.snapshot().reading, true);
    assert.equal(backs, 0);
    board.advance(9);
    assert.equal(board.snapshot().reading, false);
    assert.equal(backs, 1);
    assert.equal(board.presentation().overlayLayers.length, 0);
    assert.equal(board.presentation().controls[0].id, 'memo-open-a');
    board.advance(100);
    assert.equal(backs, 1);
  },
);

test('Memo entry and exit reuse the shared ten-frame footer arrow transition', sourceTest, () => {
  const board = createBoardMemos(layouts, {
    date,
    memos: [record('a', 'A')],
  });
  const arrowTranslation = () =>
    pane(layer(board.presentation(), 'memo-footer:'), 'N_ArwL_End').translation[0];

  board.advance(11);
  assert.equal(board.activate('memo-open-a'), true);
  assert.equal(arrowTranslation(), 0);
  board.advance(5);
  assert.equal(arrowTranslation(), -100);
  board.advance(5);
  assert.equal(arrowTranslation(), -200);
  board.advance(16);
  assert.equal(board.snapshot().phase, 'read');
  assert.equal(arrowTranslation(), -200);

  assert.equal(board.back(), true);
  assert.equal(arrowTranslation(), -200);
  board.advance(19);
  assert.equal(board.snapshot().phase, 'back-select');
  assert.equal(arrowTranslation(), -200);
  board.advance(1);
  assert.equal(board.snapshot().phase, 'close');
  assert.equal(arrowTranslation(), -200);
  board.advance(5);
  assert.equal(arrowTranslation(), -100);
  board.advance(5);
  assert.equal(arrowTranslation(), 0);
});

test(
  'short reader repeats only actual text rows and long reader scroll is bounded',
  sourceTest,
  () => {
    const board = createBoardMemos(layouts, {
      date,
      memos: [record('a', 'A')],
      measureTextLines: () => 1,
    });
    board.advance(11);
    board.activate('memo-open-a');
    board.advance(26);
    assert.equal(board.snapshot().lineCount, 1);
    assert.equal(board.snapshot().scrollLimit, 0);
    assert.equal(board.activate('memo-down'), false);
    assert.equal(
      board.presentation().controls.find((control) => control.id === 'memo-trash').disabled,
      false,
    );
    const long = createBoardMemos(layouts, {
      date,
      memos: [record('b')],
      measureTextLines: () => 20,
    });
    long.advance(11);
    long.activate('memo-open-b');
    long.advance(26);
    assert.equal(long.keyInput('ArrowDown'), true);
    long.advance(1);
    assert.equal(long.snapshot().scroll, 0);
    long.advance(20);
    assert.equal(long.snapshot().scroll, 300);
    for (let i = 0; i < 10; i++) {
      long.activate('memo-down');
      long.advance(21);
    }
    assert.equal(long.snapshot().scroll, long.snapshot().scrollLimit);
    assert.equal(long.activate('memo-down'), false);
    assert.equal(long.keyInput('ArrowUp'), true);
    long.advance(21);
    assert.equal(long.snapshot().scroll, long.snapshot().scrollLimit - 300);
  },
);

test(
  'native record creation uses both uniform bounds and stores the result once',
  sourceTest,
  () => {
    const values = [0.25, 0.75];
    const board = createBoardMemos(layouts, {
      date,
      memos: [record('a')],
      random: () => values.shift(),
    });
    assert.deepEqual(board.records()[0].position, { x: 115, y: 115 });
    assert.deepEqual(
      newMemoPosition(() => 0),
      { x: -230, y: 180 },
    );
    const persisted = board.records();
    board.setMemos(persisted);
    assert.deepEqual(board.records(), persisted);
    assert.equal(values.length, 0);
  },
);

test(
  'pinch follows pointer without clamping, release clamps source bounds and cancel does not write',
  sourceTest,
  () => {
    const writes = [],
      sounds = [];
    const display = createDisplay('16:9');
    const board = createBoardMemos(layouts, {
      date,
      display,
      memos: [{ ...record('a'), position: { x: 20, y: 30 } }],
      onMemos: (value) => writes.push(value),
      onSound: (...sound) => sounds.push(sound),
    });
    board.advance(11);
    assert.equal(board.pointerDown('memo-open-a', { x: 0, y: 0 }), true);
    board.pointerMove({ x: 500 * display.rootScaleX, y: -500 });
    const card = layer(board.presentation(), 'memo-card-a:');
    near(card.root.translation[0], 520 * display.rootScaleX);
    near(card.root.translation[1], -470);
    board.advance(1);
    assert.equal(sounds.at(-1)[0], 'WIPL_SE_BOARD_DRAG');
    assert.equal(sounds.at(-1)[1].gain, 1);
    board.advance(1);
    assert.equal(sounds.at(-1)[1].gain, 0);
    assert.equal(board.activate('memo-open-a'), false);
    board.pointerUp();
    assert.deepEqual(writes[0][0].position, { x: 230, y: -80 });
    assert.equal(board.snapshot().draggingMemo, false);
    board.pointerDown('memo-open-a', { x: 0, y: 0 });
    board.pointerMove({ x: -100, y: 100 });
    board.cancelPointer();
    assert.equal(writes.length, 1);
    assert.deepEqual(board.records()[0].position, { x: 230, y: -80 });
  },
);

test(
  'native Trash dialog cancellation preserves the memo; acceptance erases after exit',
  sourceTest,
  () => {
    const writes = [],
      sounds = [];
    const board = createBoardMemos(layouts, {
      date,
      now: date,
      memos: [record('a')],
      onMemos: (value) => writes.push(value),
      onSound: (id) => sounds.push(id),
    });
    board.advance(11);
    board.activate('memo-open-a');
    board.advance(26);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].readAt, date.toISOString());
    board.activate('memo-trash');
    board.advance(32);
    assert.equal(board.snapshot().dialog, null);
    board.advance(1);
    assert.equal(board.snapshot().dialog.phase, 'enter');
    board.advance(26);
    const view = board.presentation();
    assert.equal(view.controls.length, 2);
    assert.equal(pane(layer(view, 'memo-erase-dialog:'), 'T_Dialog').text, 'Erase this message?');
    board.hover('memo-erase-no');
    assert.equal(sounds.at(-1), 'WIPL_SE_BT_TARGETTING');
    const hoverCount = sounds.length;
    board.hover('memo-erase-no');
    assert.equal(sounds.length, hoverCount, 'settled dialog focus does not replay its cue');
    assert.equal(board.activate('memo-erase-no'), true);
    board.advance(47);
    board.advance(13);
    assert.equal(board.snapshot().phase, 'read');
    assert.equal(board.records().length, 1);
    board.activate('memo-trash');
    board.advance(59);
    assert.equal(board.activate('memo-erase-yes'), true);
    board.advance(47);
    assert.equal(board.snapshot().phase, 'erase-close');
    assert.ok(sounds.includes('WIPL_SE_BOARD_DUMP'));
    assert.equal(board.presentation().cardLayers.length, 0);
    board.advance(16);
    assert.equal(board.records().length, 1);
    board.advance(1);
    assert.equal(board.records().length, 0);
    assert.deepEqual(writes.at(-1), []);
    assert.equal(board.presentation().layers.length, 0);
  },
);

test('Memo dialog status avoids poses and each presentation shares one layout with its controls',
  sourceTest, (t) => {
    const board = createBoardMemos(layouts, { date, memos: [record('status')] });
    board.advance(11);
    board.activate('memo-open-status');
    board.advance(26);
    board.activate('memo-trash');
    board.advance(33);
    const clone = globalThis.structuredClone;
    let dialogClones = 0;
    t.mock.method(globalThis, 'structuredClone', (value, ...args) => {
      if (value === layouts.my_DialogWindow_b.root ||
          value === layouts.my_DialogWindow_b.materials) dialogClones += 1;
      return clone(value, ...args);
    });
    const check = (phase, locked) => {
      dialogClones = 0;
      const state = board.snapshot();
      assert.equal(state.dialog.phase, phase);
      assert.equal(state.locked, locked);
      assert.equal(dialogClones, 0);
      const view = board.presentation();
      assert.equal(view.locked, locked);
      assert.equal(dialogClones, 2, 'one root/material pair serves dialog drawing and controls');
      assert.equal(view.layers.filter(layer => layer.prefix === 'memo-erase-dialog:').length, 1);
      assert.deepEqual(view.controls.map(control => control.disabled), [locked, locked]);
      view.controls[0].label = 'Changed by caller';
      assert.notEqual(board.presentation().controls[0].label, 'Changed by caller');
    };
    check('enter', true);
    board.advance(26);
    check('idle', false);
    board.activate('memo-erase-no');
    check('select', true);
    board.advance(layouts.my_DialogWindow_b.animations.my_DialogWindow_b_SelectBtn_Ac.frames);
    check('exit', true);
    board.advance(layouts.my_DialogWindow_b.animations.my_DialogWindow_b_DialogOut.frames);
    assert.equal(board.snapshot().dialog, null);
    assert.equal(board.records().length, 1);
  });

test('badge counts all current-day records independently of local read state', () => {
  const records = [
    record('a'),
    { ...record('b'), readAt: date.toISOString() },
    record('c', 'Yesterday', new Date(2026, 8, 16)),
  ];
  assert.deepEqual(memoSummary(records, date), { count: 2, unreadCount: 1 });
  assert.equal(
    memoSummary(
      Array.from({ length: 105 }, (_, i) => record(String(i))),
      date,
    ).count,
    99,
  );
});

test('Memo erasure waits for the host and original exit in either completion order', sourceTest,
  async () => {
    for (const commitFirst of [true, false]) {
      let resolve;
      const writes = [];
      const original = record('erase-one');
      const other = record('keep-one');
      const board = createBoardMemos(layouts, {
        date, memos: [original, other], onMemos: (records) => writes.push(records),
        onEraseMemo(id) {
          assert.equal(id, original.id);
          return new Promise((done) => { resolve = done; });
        },
      });
      board.advance(20);
      board.activate('memo-open-erase-one');
      board.advance(26);
      board.activate('memo-trash');
      board.advance(59);
      board.activate('memo-erase-yes');
      board.advance(47);
      const before = writes.length;
      if (commitFirst) { resolve(); await Promise.resolve(); }
      board.advance(16);
      assert.equal(board.records().length, 2);
      assert.equal(writes.length, before);
      board.advance(1);
      if (!commitFirst) {
        assert.equal(board.snapshot().phase, 'erase-wait');
        assert.equal(board.snapshot().locked, true);
        assert.equal(board.back(), false);
        assert.equal(board.records().length, 2);
        resolve();
        await Promise.resolve();
      }
      assert.equal(board.snapshot().phase, 'board');
      assert.deepEqual(board.records().map(({ id }) => id), [other.id]);
      assert.equal(writes.length, before + 1);
    }
  });

test('failed Memo erasure restores the reader without publishing deletion and supports retry',
  sourceTest, async () => {
    let reject;
    let attempts = 0;
    const errors = [];
    const writes = [];
    const board = createBoardMemos(layouts, {
      date, memos: [record('retry')], onMemos: (records) => writes.push(records),
      onEraseMemo: () => ++attempts === 1
        ? new Promise((resolve, fail) => { reject = fail; }) : Promise.resolve(),
      onBoardError: (error) => errors.push(error.message),
      measureTextLines: () => 30,
    });
    board.advance(20);
    board.activate('memo-open-retry');
    board.advance(26);
    board.activate('memo-down');
    board.advance(21);
    const position = board.snapshot().scroll;
    const confirm = () => {
      board.activate('memo-trash');
      board.advance(59);
      board.activate('memo-erase-yes');
      board.advance(47);
      board.advance(17);
    };
    const before = writes.length;
    confirm();
    reject(new Error('Synthetic write failure'));
    await Promise.resolve();
    assert.equal(board.snapshot().phase, 'trash-cancel');
    assert.equal(board.snapshot().scroll, position);
    assert.equal(board.records().length, 1);
    assert.equal(writes.length, before);
    board.advance(13);
    assert.equal(board.snapshot().phase, 'read');
    assert.deepEqual(errors, ['Synthetic write failure']);
    confirm();
    await Promise.resolve();
    assert.equal(board.records().length, 0);
    assert.equal(writes.length, before + 1);
  });


test('reader scroll keeps hover and live hit regions while rejecting overlapping triggers',
  sourceTest, () => {
    const board = createBoardMemos(layouts, {
      date, memos: [record('long')], measureTextLines: () => 40,
    });
    board.advance(11);
    board.activate('memo-open-long');
    board.advance(26);
    board.hover('memo-down');
    board.advance(20);
    const sample = () => renderedArrow(layer(board.presentation(), 'memo-reader:'), 'L');
    const focused = sample();
    assert.equal(focused.bubble, 255);
    assert.equal(board.activate('memo-down'), true);
    board.advance(6);
    assert.equal(board.presentation().controls.find((control) => control.id === 'memo-down').disabled,
      false, 'scroll movement must not remove the hover target');
    const partial = board.snapshot().scroll;
    assert.ok(partial > 0 && partial < 300);
    assert.equal(board.activate('memo-down'), false, 'native Scroller rejects overlapping triggers');
    board.advance(15);
    assert.equal(board.snapshot().scroll, 300, 'rejected click must not restart the 21-update motion');
    board.advance(40);
    assert.equal(sample().bubble, focused.bubble);
    assert.equal(sample().pressed, 0);
    board.hover(null);
    board.advance(20);
    assert.equal(sample().bubble, 0, 'pointer departure removes focus');
    assert.equal(sample().pressed, 0);
  });

test('reader pointer hold triggers once, preserves hover on release, and stops at its bounds',
  sourceTest, () => {
    const board = createBoardMemos(layouts, {
      date, memos: [record('long')], measureTextLines: () => 15,
    });
    board.advance(11);
    board.activate('memo-open-long');
    board.advance(26);
    assert.equal(board.holdControl('memo-down'), true);
    board.advance(121);
    assert.equal(board.snapshot().scroll, 300, 'reader downTrg is not the editor held-A repeat');
    board.releaseControl();
    board.advance(20);
    assert.equal(renderedArrow(layer(board.presentation(), 'memo-reader:'), 'L').bubble, 255);
    assert.equal(board.holdControl('memo-down'), true);
    board.advance(21);
    assert.equal(board.snapshot().scroll, board.snapshot().scrollLimit);
    board.advance(20);
    assert.equal(board.presentation().controls.some((control) => control.id === 'memo-down'), false);
    assert.equal(renderedArrow(layer(board.presentation(), 'memo-reader:'), 'L').bubble, 0);
    assert.equal(board.holdControl('memo-down'), false);
    assert.equal(board.holdControl('memo-up'), true);
    board.advance(21);
    assert.equal(board.snapshot().scroll, board.snapshot().scrollLimit - 300);
    board.keyInput('', { type: 'blur' });
    board.advance(20);
    assert.equal(renderedArrow(layer(board.presentation(), 'memo-reader:'), 'R').bubble, 0);
    board.back();
    assert.equal(board.holdControl('memo-up'), false);
    board.advance(46);
    board.activate('memo-open-long');
    board.advance(46);
    assert.equal(board.snapshot().scroll, 0);
    assert.equal(renderedArrow(layer(board.presentation(), 'memo-reader:'), 'L').bubble, 0);
  });

test('reader arrow targeting and held movement sound follow their native trigger boundaries',
  sourceTest, () => {
    const sounds = [];
    const board = createBoardMemos(layouts, {
      date, memos: [record('long')], measureTextLines: () => 40,
      onSound: (symbol, options) => sounds.push({ symbol, options }),
    });
    board.advance(11);
    board.activate('memo-open-long');
    board.advance(26);
    sounds.length = 0;
    board.hover('memo-down');
    board.hover('memo-down');
    assert.deepEqual(sounds, [{ symbol: 'WIPL_SE_BT_TARGETTING', options: undefined }]);
    board.activate('memo-down');
    board.advance(1);
    assert.equal(board.snapshot().scroll, 0);
    assert.equal(sounds.length, 1, 'initial Scroller update does not move or hold audio');
    board.advance(1);
    assert.deepEqual(sounds.at(-1), { symbol: 'WIPL_SE_MESSAGE_SCROLL', options: { loop: true } });
    board.advance(9);
    near(board.snapshot().scroll, 150);
    assert.equal(sounds.length, 2, 'moving updates keep one owned loop');
    board.advance(10);
    near(board.snapshot().scroll, 300);
    assert.equal(sounds.length, 2, 'last native movement still exceeds one unit');
    board.advance(1);
    assert.deepEqual(sounds.at(-1), { symbol: 'WIPL_SE_MESSAGE_SCROLL', options: { loop: false } });
    board.advance(20);
    assert.equal(sounds.length, 3, 'idle cannot replay the movement sound');
  });

test('short reader movement reaches its clamped endpoint smoothly and releases audio before curve end',
  sourceTest, () => {
    const sounds = [];
    const board = createBoardMemos(layouts, {
      date, memos: [record('short')], measureTextLines: () => 5,
      onSound: (symbol, options) => {
        if (symbol === 'WIPL_SE_MESSAGE_SCROLL') sounds.push(options.loop);
      },
    });
    board.advance(11);
    board.activate('memo-open-short');
    board.advance(26);
    assert.equal(board.snapshot().scrollLimit, 122);
    board.activate('memo-down');
    board.advance(6);
    near(board.snapshot().scroll, 46.875);
    assert.deepEqual(sounds, [true]);
    board.advance(4);
    assert.equal(board.snapshot().scroll, 122);
    board.advance(1);
    assert.deepEqual(sounds, [true, false]);
    assert.equal(board.activate('memo-up'), false, 'clamping does not end the authored movement clock');
    board.advance(10);
    board.activate('memo-up');
    board.advance(6);
    assert.ok(board.snapshot().scroll > 0 && board.snapshot().scroll < 122);
    board.advance(15);
    assert.equal(board.snapshot().scroll, 0);
    assert.deepEqual(sounds, [true, false, true, false]);
  });

test('reader movement cue is released by suspension, close and local-record replacement',
  sourceTest, () => {
    for (const stop of ['suspend', 'back', 'replace', 'date']) {
      const sounds = [];
      const board = createBoardMemos(layouts, {
        date, memos: [record('long')], measureTextLines: () => 40,
        onSound: (symbol, options) => {
          if (symbol === 'WIPL_SE_MESSAGE_SCROLL') sounds.push(options.loop);
        },
      });
      board.advance(11);
      board.activate('memo-open-long');
      board.advance(26);
      board.activate('memo-down');
      board.advance(5);
      if (stop === 'suspend') board.suspendAudio();
      else if (stop === 'back') board.back();
      else if (stop === 'replace') board.setMemos([]);
      else board.setDate(new Date(2026, 9, 1));
      assert.deepEqual(sounds, [true, false], stop);
      if (stop === 'suspend') {
        board.advance(1);
        assert.deepEqual(sounds, [true, false, true], 'resumed movement reacquires its cue');
      }
      board.advance(100);
      assert.equal(sounds.at(-1), false, `${stop} cannot leave a running cue`);
    }
  });

test('a delayed reader update cannot start sound after the complete motion has elapsed',
  sourceTest, () => {
    const sounds = [];
    const board = createBoardMemos(layouts, {
      date, memos: [record('long')], measureTextLines: () => 40,
      onSound: (symbol) => sounds.push(symbol),
    });
    board.advance(11);
    board.activate('memo-open-long');
    board.advance(26);
    sounds.length = 0;
    board.activate('memo-down');
    board.advance(100);
    assert.equal(board.snapshot().scroll, 300);
    assert.deepEqual(sounds, []);
  });

test('predecoded photo thumbnail replaces only LetterPic map zero and retains every authored card transform',
  sourceTest, () => {
    const source = structuredClone(layouts.LetterS_b);
    const materialIndex = pane(source, 'LetterPic').material;
    source.materials[materialIndex].textureMaps.push({ texture: 0, wrapS: 1, wrapT: 2 });
    const pristine = JSON.stringify(source);
    const photo = { id: 'explicit-thumbnail', width: 512, height: 256,
      localSrc: '/assets/local-letters/explicit-thumbnail.png', sha256: 'a'.repeat(64),
      thumbnail: { width: 64, height: 48, sha256: 'b'.repeat(64),
        localSrc: '/assets/local-letters/thumbnails/explicit-thumbnail.png' } };
    const incoming = { ...record('thumbnail-card', ''), kind: 'letter', header: 'Photo',
      sender: { kind: 'email', nickname: 'Synthetic', address: 'synthetic@example.test' }, photo };
    const board = createBoardMemos({ ...layouts, LetterS_b: source }, {
      date, now: () => date, memos: [incoming],
    });
    const check = (clips) => {
      const card = layer(board.presentation(), 'memo-card-thumbnail-card:');
      const expected = poseLayout(source, clips);
      for (const name of ['N_Pic', 'LetterPic', 'PicBase', 'W_PicShade']) {
        assert.deepEqual(pane(card, name), pane(expected, name), name);
      }
      const map = card.materials[materialIndex].textureMaps[0];
      assert.deepEqual(map, { ...source.materials[materialIndex].textureMaps[0], texture: source.textures.length });
      assert.deepEqual(card.materials[materialIndex].textureMaps.slice(1),
        source.materials[materialIndex].textureMaps.slice(1));
      const expectedMaterials = structuredClone(expected.materials);
      expectedMaterials[materialIndex].textureMaps[0] = map;
      assert.deepEqual(card.materials, expectedMaterials);
      assert.equal(card.textures.at(-1).url, photo.thumbnail.localSrc);
      assert.equal(card.textures.at(-1).width, 64);
      assert.equal(card.textures.at(-1).height, 48);
      assert.equal(pane(card, 'N_Pic').flags & 1, 1);
      assert.equal(JSON.stringify(source), pristine);
    };
    check([{ animation: source.animations.LetterS_b_PasteLetter, frame: 0 }]);
    board.advance(20);
    board.hover('memo-open-thumbnail-card');
    board.advance(4);
    check([{ animation: source.animations.LetterS_b_PasteLetter, frame: 24 },
      { animation: source.animations.LetterS_b_FocusIn, frame: 4 }]);
    assert.deepEqual(board.presentation().controls.map(({ id }) => id), ['memo-open-thumbnail-card']);
    board.activate('memo-open-thumbnail-card');
    board.advance(4);
    check([{ animation: source.animations.LetterS_b_PasteLetter, frame: 28 },
      { animation: source.animations.LetterS_b_FocusIn, frame: 8 },
      { animation: source.animations.LetterS_b_SelectLetter, frame: 4 }]);
  });

test('thumbnail and full-photo failures keep independent card and reader ownership', sourceTest, () => {
  const photo = { id: 'independent-photo', width: 512, height: 256,
    localSrc: '/assets/local-letters/independent-photo.png', sha256: 'a'.repeat(64),
    thumbnail: { width: 64, height: 48, sha256: 'b'.repeat(64),
      localSrc: '/assets/local-letters/thumbnails/independent-photo.png' } };
  for (const failed of ['thumbnail', 'photo']) {
    const board = createBoardMemos(layouts, {
      date, now: () => date,
      unavailablePhotoIds: new Set(failed === 'photo' ? [photo.id] : []),
      unavailableThumbnailIds: new Set(failed === 'thumbnail' ? [photo.id] : []),
      memos: [{ ...record('partial-photo', 'Readable Letter'), kind: 'letter', header: 'Photo',
        sender: { kind: 'email', nickname: 'Synthetic', address: 'synthetic@example.test' }, photo }],
    });
    board.advance(20);
    const card = layer(board.presentation(), 'memo-card-partial-photo:');
    assert.equal(pane(card, 'N_Pic').flags & 1, failed === 'thumbnail' ? 0 : 1);
    if (failed === 'thumbnail') assert.equal(card.textures.length, layouts.LetterS_b.textures.length);
    board.activate('memo-open-partial-photo');
    board.advance(26);
    assert.equal(board.presentation().controls.some(({ id }) => id === 'incoming-photo'), failed !== 'photo');
    assert.deepEqual(board.records()[0].photo, photo);
  }
});
