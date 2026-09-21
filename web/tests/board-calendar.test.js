import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { calendarCells, CALENDAR_LAYOUTS, createBoardCalendar } from '../src/board-calendar.js';
import { indexLayout } from '../src/animation.js';
import { createDisplay } from '../src/display.js';
import { Renderer } from '../src/renderer.js';
import { renderedArrow } from './helpers/rendered-arrow.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && CALENDAR_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      CALENDAR_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
      ]),
    )
  : {};
const sourceTest = { skip: !available };
const date = (year, month, day = 1) => new Date(year, month - 1, day, 12);
const dayLayout = (view, index) =>
  view.layers.find((layer) => layer.prefix === `calendar-date-${index}:`).layout;
const pane = (layout, name) => indexLayout(layout).panes.get(name);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} differs from ${b}`);

test(
  'Calendar month arrows retain focus independently of press and retire at the final month',
  sourceTest,
  () => {
    const calendar = createBoardCalendar(layouts);
    calendar.open(date(2035, 10));
    calendar.advance(50);
    const arrow = () =>
      renderedArrow(
        calendar.presentation().layers.find((layer) => layer.prefix === 'calendar-footer:').layout,
      );
    calendar.hover('next');
    calendar.advance(15);
    assert.ok(arrow().bubble > 0);
    calendar.activate('next');
    calendar.advance(3);
    assert.ok(arrow().pressed > 0);
    assert.ok(arrow().bubble > 0);
    calendar.advance(300);
    assert.ok(arrow().bubble > 0);
    calendar.activate('prev');
    calendar.advance(3);
    calendar.hover(null);
    calendar.advance(15);
    assert.equal(arrow().bubble, 0);
    calendar.advance(12);
    calendar.hover('next');
    calendar.advance(15);
    calendar.activate('next');
    calendar.advance(30);
    calendar.activate('next');
    calendar.advance(45);
    assert.equal(arrow().bubble, 0);
    assert.equal(calendar.activate('next'), false);
  },
);

test('calendar cells preserve leap days, whole weeks, weekends and local today', () => {
  const cells = calendarCells(date(2024, 2), { today: date(2024, 2, 29) });
  assert.equal(cells.length, 35);
  assert.deepEqual(
    cells.filter((cell) => cell.current).map((cell) => cell.day),
    Array.from({ length: 29 }, (_, index) => index + 1),
  );
  assert.equal(cells[0].month, 1);
  assert.equal(cells[0].day, 28);
  assert.equal(cells.at(-1).day, 2);
  assert.equal(cells.find((cell) => cell.current && cell.day === 29).buttonFrame, 1);
  assert.equal(cells.find((cell) => cell.current && cell.day === 3).textFrame, 1);
  assert.equal(cells.find((cell) => cell.current && cell.day === 4).textFrame, 2);
  assert.equal(cells[0].textFrame, 3);
  assert.equal(calendarCells(date(2015, 2)).length, 28);
  assert.equal(calendarCells(date(2026, 8)).length, 42);
  const monday = calendarCells(date(2024, 2), { mondayFirst: true });
  assert.equal(monday[0].day, 29);
});

test('calendar uses original forty-frame entry and fifty-frame common footer', sourceTest, () => {
  const calendar = createBoardCalendar(layouts, {
    messages: { 126: 'September', 116: 'Sun' },
  });
  calendar.open(date(2026, 9, 17));
  assert.equal(calendar.presentation().sheetFrame, 1000);
  assert.equal(calendar.presentation().footerFrame, 2000);
  calendar.advance(39);
  assert.equal(calendar.activate('date-2'), false);
  calendar.advance(1);
  const view = calendar.presentation();
  assert.equal(view.locked, false);
  assert.equal(view.sheetFrame, 1040);
  assert.equal(view.footerFrame, 2040);
  assert.equal(view.controls.find((control) => control.id === 'date-2').disabled, false);
  assert.equal(view.controls.find((control) => control.id === 'back').disabled, true);
  assert.equal(pane(view.layers[0].layout, 'T_CalMonth_b').text, 'September 2026');
  calendar.advance(10);
  assert.equal(calendar.presentation().footerFrame, 2050);
  assert.equal(
    calendar.presentation().controls.find((control) => control.id === 'back').disabled,
    false,
  );
  for (const control of calendar.presentation().controls) {
    const layer = calendar.presentation().layers.find((item) => item.prefix === control.prefix);
    assert.ok(layer && pane(layer.layout, control.pane), control.id);
  }
  calendar.hover('back');
  assert.equal(
    calendar.presentation().layers.filter((layer) => layer.prefix.startsWith('calendar-date-'))
      .length,
    35,
  );
});

test(
  'month transition draws both original sheets and resets only after thirty frames',
  sourceTest,
  () => {
    const before = JSON.stringify(layouts),
      calendar = createBoardCalendar(layouts);
    calendar.open(date(2026, 12, 17));
    calendar.advance(50);
    assert.equal(calendar.activate('next'), true);
    calendar.advance(15);
    let view = calendar.presentation();
    assert.equal(view.sheetFrame, 2015);
    assert.equal(view.locked, true);
    assert.equal(pane(view.layers[0].layout, 'T_CalMonth_b').text, 'December 2026');
    assert.equal(pane(view.layers[0].layout, 'T_CalMonth_c').text, 'January 2027');
    assert.ok(view.layers.some((layer) => layer.prefix === 'calendar-date-42:'));
    calendar.advance(14);
    assert.equal(calendar.activate('prev'), false);
    calendar.advance(1);
    view = calendar.presentation();
    assert.deepEqual(calendar.snapshot().month, { year: 2027, month: 1 });
    assert.equal(view.sheetFrame, 1040);
    assert.equal(
      view.layers.some((layer) => layer.prefix === 'calendar-date-42:'),
      false,
    );
    assert.equal(pane(view.layers[0].layout, 'T_CalMonth_b').text, 'January 2027');
    calendar.activate('prev');
    calendar.advance(30);
    assert.deepEqual(calendar.snapshot().month, { year: 2026, month: 12 });
    assert.equal(JSON.stringify(layouts), before);
  },
);

test('date hover queues departure and selection binds the actual flash pane', sourceTest, () => {
  const events = [],
    sounds = [],
    calendar = createBoardCalendar(layouts, {
      onSelectDate: (value) => events.push(value),
      onBack: () => events.push('back'),
      onSound: (value) => sounds.push(value),
    });
  calendar.open(date(2026, 9));
  calendar.advance(50);
  calendar.hover('date-2');
  calendar.advance(3);
  calendar.hover(null);
  calendar.advance(3);
  near(pane(dayLayout(calendar.presentation(), 2), 'N_CalDay_r').scale[0], 1.2);
  calendar.advance(8);
  near(pane(dayLayout(calendar.presentation(), 2), 'N_CalDay_r').scale[0], 1);
  calendar.hover('date-3');
  calendar.advance(6);
  const dayLayers = calendar
    .presentation()
    .layers.filter((layer) => layer.prefix.startsWith('calendar-date-'));
  assert.equal(dayLayers.at(-1).prefix, 'calendar-date-3:');
  assert.equal(calendar.activate('date-3'), true);
  assert.equal(events[0].getDate(), 2);
  assert.equal(events[0].getMonth(), 8);
  assert.deepEqual(sounds, ['WIPL_SE_DATE_SELECT']);
  calendar.advance(3);
  const flash = dayLayout(calendar.presentation(), 3);
  assert.equal(flash.materials[pane(flash, 'Cal_Ac').material].colors[1][3], 240);
  calendar.advance(22);
  const endedFlash = dayLayout(calendar.presentation(), 3);
  assert.equal(endedFlash.materials[pane(endedFlash, 'Cal_Ac').material].colors[1][3], 0);
  calendar.advance(4);
  assert.equal(calendar.snapshot().phase, 'select');
  calendar.advance(1);
  assert.equal(calendar.snapshot().phase, 'exit');
  assert.equal(calendar.presentation().footerFrame, 3500);
  calendar.advance(20);
  assert.equal(calendar.presentation().sheetFrame, 4020);
  assert.equal(events.length, 1);
  calendar.advance(29);
  assert.equal(events.length, 1);
  calendar.advance(1);
  assert.equal(events[1], 'back');
  assert.deepEqual(calendar.presentation().layers, []);
  calendar.advance(100);
  assert.equal(events.length, 2);
});

test(
  'ordinary Back keeps the native common footer return alive after sheet exit',
  sourceTest,
  () => {
    let backs = 0;
    const calendar = createBoardCalendar(layouts, { onBack: () => backs++ });
    calendar.open(date(2026, 9));
    calendar.advance(50);
    calendar.back();
    calendar.advance(20);
    assert.equal(calendar.presentation().sheetFrame, 4020);
    assert.equal(calendar.presentation().footerFrame, 3020);
    assert.equal(backs, 0);
    calendar.advance(30);
    assert.equal(backs, 1);
  },
);

test('calendar enforces source 2000–2035 limits including adjacent-month dates', sourceTest, () => {
  const selected = [],
    calendar = createBoardCalendar(layouts, {
      onSelectDate: (value) => selected.push(value),
    });
  calendar.open(date(2000, 1));
  calendar.advance(50);
  assert.equal(calendar.activate('prev'), false);
  assert.equal(calendar.activate('date-0'), false);
  assert.equal(calendar.activate('next'), true);
  calendar.advance(30);
  assert.equal(
    calendar.presentation().controls.find((control) => control.id === 'prev').disabled,
    false,
  );
  calendar.open(date(2035, 12));
  calendar.advance(50);
  assert.equal(calendar.activate('next'), false);
  assert.equal(calendar.activate('date-0'), true);
  assert.equal(selected[0].getMonth(), 10);
  assert.throws(() => calendar.open(date(2036, 1)), RangeError);
  assert.throws(() => calendar.advance(-1), RangeError);
});

test(
  'separate day layouts copy source anchors without widescreen double scaling',
  sourceTest,
  () => {
    for (const aspect of ['4:3', '16:9']) {
      const display = createDisplay(aspect),
        calendar = createBoardCalendar(layouts, { display });
      calendar.open(date(2026, 9));
      calendar.advance(50);
      const view = calendar.presentation(),
        renderer = Object.create(Renderer.prototype);
      renderer.bounds = new Map();
      renderer.display = display;
      renderer.quad = () => {};
      for (const layer of view.layers) renderer.draw(layer.layout, { prefix: layer.prefix });
      const a = renderer.rect('calendar-date-0:B_Cal'),
        b = renderer.rect('calendar-date-1:B_Cal'),
        down = renderer.rect('calendar-date-7:B_Cal');
      near(a.x + a.w / 2, display.halfWidth - 210);
      near(a.y + a.h / 2, 228 - 137);
      near(b.x - a.x, 70);
      near(down.y - a.y, 48);
      near(a.w, 66);
      near(a.h, 44);
      assert.deepEqual(pane(dayLayout(view, 0), 'N_CalDay_t').rotation, [0, 0, 0]);
      const cell = dayLayout(view, 18),
        message = cell.materials[pane(cell, 'Info_a').material];
      assert.equal(message.colors[1][3], 0);
    }
  },
);

test('message days bind the original Info_a marker and refresh after erasure', sourceTest, () => {
  const calendar = createBoardCalendar(layouts, {
    today: () => date(2026, 9, 17),
    memos: [{ createdAt: date(2026, 9, 17).toISOString() }],
  });
  calendar.open(date(2026, 9, 17));
  calendar.advance(50);
  const cells = calendarCells(date(2026, 9, 17));
  const index = cells.find((cell) => cell.month === 9 && cell.day === 17).index;
  const alpha = (index) =>
    indexLayout(dayLayout(calendar.presentation(), index)).materials.get('Info_a').colors[1][3];
  assert.equal(alpha(index), 255);
  assert.equal(alpha(index + 1), 0);
  calendar.setMemos([]);
  assert.equal(alpha(index), 0);
});
