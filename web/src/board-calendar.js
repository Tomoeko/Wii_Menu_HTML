import {
  identity,
  indexLayout,
  multiply,
  paneMatrix,
  poseLayout,
  transform3D,
} from './animation.js';
import { paneForDisplay, standardDisplay } from './display.js';
import { commonArrowDefinitions, createArrowInteraction, isArrowId } from './arrow-interaction.js';

export const CALENDAR_LAYOUTS = ['my_IplTop_g', 'my_IplTop_f', 'my_IplTop_e'];
export const CALENDAR_YEARS = Object.freeze({ min: 2000, max: 2035 });
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_IDS = [116, 110, 111, 112, 113, 114, 115];
const WEEK_PANES = [
  [0, 1, 2, 3, 4, 5, 6],
  [8, 9, 10, 11, 12, 13, 7],
  [16, 17, 18, 19, 20, 14, 15],
];
const FOOTER_PREFIX = 'calendar-footer:';
const clamp = (value, end) => Math.min(end, Math.max(0, value));
const dateParts = (value) =>
  value instanceof Date
    ? {
        year: value.getFullYear(),
        month: value.getMonth() + 1,
        day: value.getDate(),
      }
    : { year: value.year, month: value.month, day: value.day };
const localDate = (value) => new Date(value.year, value.month - 1, value.day, 12);
const sameDate = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;
const shiftMonth = (date, amount) => dateParts(new Date(date.year, date.month - 1 + amount, 1, 12));
const inRange = (date) => date.year >= CALENDAR_YEARS.min && date.year <= CALENDAR_YEARS.max;

/** Calendar::set_textbox_date uses whole weeks, including adjacent-month dates. */
export function calendarCells(value, { today = new Date(), mondayFirst = false } = {}) {
  const date = dateParts(value),
    now = dateParts(today);
  const first = new Date(date.year, date.month - 1, 1, 12);
  const start = (first.getDay() + (mondayFirst ? 6 : 0)) % 7;
  const count = new Date(date.year, date.month, 0, 12).getDate();
  const visible = Math.ceil((start + count) / 7) * 7;
  return Array.from({ length: visible }, (_, index) => {
    const actual = new Date(date.year, date.month - 1, index - start + 1, 12),
      parts = dateParts(actual);
    const current = parts.month === date.month && parts.year === date.year;
    return {
      index,
      ...parts,
      current,
      disabled: !inRange(parts),
      today: current && sameDate(parts, now),
      textFrame: current ? (actual.getDay() === 6 ? 1 : actual.getDay() === 0 ? 2 : 0) : 3,
      buttonFrame: current ? (sameDate(parts, now) ? 1 : 0) : 3,
    };
  });
}

function globalMatrices(layout, display) {
  const result = new Map();
  const visit = (pane, parent, root) => {
    const matrix = multiply(parent, paneMatrix(paneForDisplay(pane, display, { root })));
    result.set(pane.name, matrix);
    for (const child of pane.children || []) visit(child, matrix, false);
  };
  visit(layout.root, identity, true);
  return result;
}

// Date::onCmdRecv finishes the active enter/leave before honoring its queued
// opposite command. A quick pointer pass must not abruptly reset the scale.
function requestFocus(entries, id, entering) {
  if (!id) return;
  let entry = entries.get(id);
  if (!entry) {
    entry = { entering, desired: entering, frame: 0, playing: true };
    entries.set(id, entry);
  } else {
    entry.desired = entering;
    if (!entry.playing && entry.entering !== entering)
      Object.assign(entry, { entering, frame: 0, playing: true });
  }
}
function advanceFocus(entries, frames) {
  for (const entry of entries.values()) {
    let remaining = frames;
    while (entry.playing) {
      const duration = entry.entering ? 6 : 8,
        step = Math.min(remaining, duration - entry.frame);
      entry.frame += step;
      remaining -= step;
      if (entry.frame < duration) break;
      entry.playing = false;
      if (entry.desired !== entry.entering)
        Object.assign(entry, {
          entering: entry.desired,
          frame: 0,
          playing: true,
        });
      if (!remaining) break;
    }
  }
}

/** Original USA calendar layouts/controllers with local message date indicators.
 * Calendar.cpp: G_All 1000–1040 / 2000–2030 / 3000–3030 / 4000–4020.
 * Date.cpp: independent hover, weekday, today, message and selection bindings.
 * Button.cpp: calendar footer 2000–2050; return 3000–3050 or 3500–3550.
 */
export function createBoardCalendar(
  layouts,
  {
    onBack = () => {},
    onSelectDate = () => {},
    onSound = () => {},
    display = standardDisplay,
    messages = {},
    today = () => new Date(),
    mondayFirst = false,
    memos = [],
  } = {},
) {
  for (const key of CALENDAR_LAYOUTS)
    if (!layouts[key]) throw new Error(`Missing original calendar layout: ${key}`);
  const messageMap = messages.messages || messages;
  const sheetSource = layouts.my_IplTop_g,
    footerSource = layouts.my_IplTop_e;
  const arrows = createArrowInteraction(commonArrowDefinitions(footerSource));
  // Single-pane binding in Date::Date is represented by private one-pane groups;
  // the imported layout and the source animation's own targets remain intact.
  const daySource = {
    ...layouts.my_IplTop_f,
    groups: {
      ...layouts.my_IplTop_f.groups,
      dateHover: ['N_CalDay_r'],
      dateButton: ['W_Cal'],
      dateText: ['T_Cal'],
      dateSelect: ['Cal_Ac'],
      dateMessage: ['Info_a'],
    },
  };
  // Cal_Ac's visible texture ends at frame 75. Date::SELECT continues to
  // frame 80 so Calendar can wait for the authored body animation before
  // starting its exit; keep the texture itself from lingering for those last
  // five bookkeeping frames.
  const selectionVisibleFrames = 25;
  const clip = (source, group, frame) => ({
    animation: source.animations[source.name],
    group,
    frame,
    loop: false,
  });
  const sourceDayClip = (group, frame) => ({
    animation: daySource.animations.my_IplTop_f,
    group,
    frame,
    loop: false,
  });
  let date,
    oldMonth,
    cells = [],
    incoming = [],
    phase = 'closed',
    frame = 0,
    age = 0,
    selected = null;
  let dayOrder = [],
    hovered = null,
    footerFocus = new Map(),
    dayFocus = new Map(),
    dayCache = new Map();
  const messageDates = new Set();
  const setMemos = (records) => {
    messageDates.clear();
    for (const record of records) {
      const value = new Date(record.createdAt);
      if (Number.isFinite(value.getTime()))
        messageDates.add(`${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`);
    }
    dayCache.clear();
  };
  setMemos(memos);
  const clockToday = () => (typeof today === 'function' ? today() : today);
  const atLimit = (which, value = date) =>
    value.year === (which === 'prev' ? 2000 : 2035) && value.month === (which === 'prev' ? 1 : 12);
  const resetFocus = (preserveArrows = false) => {
    if (!preserveArrows) arrows.reset();
    if (!preserveArrows || !isArrowId(hovered)) hovered = null;
    dayFocus.clear();
    footerFocus.clear();
    dayCache.clear();
    dayOrder = cells.map((cell) => cell.index);
  };
  const startExit = () => {
    arrows.hover(null);
    phase = 'exit';
    frame = 0;
    hovered = null;
    footerFocus.clear();
  };
  const isScrolling = () => phase === 'next' || phase === 'prev';
  const sheetFrame = () =>
    phase === 'enter'
      ? 1000 + clamp(frame, 40)
      : isScrolling()
        ? (phase === 'next' ? 2000 : 3000) + clamp(frame, 30)
        : phase === 'exit'
          ? 4000 + clamp(frame, 20)
          : 1040;
  const footerFrame = () =>
    phase === 'exit' ? (selected ? 3500 : 3000) + clamp(frame, 50) : 2000 + clamp(age, 50);
  const datePrefix = (index) => `calendar-date-${index}:`;
  const controls = () => {
    if (phase === 'closed') return [];
    const locked = phase !== 'idle';
    return [
      {
        id: 'back',
        pane: 'B_CalExit',
        prefix: FOOTER_PREFIX,
        label: messageMap[35] ?? 'Back',
        disabled: locked || age < 50,
      },
      {
        id: 'prev',
        pane: 'B_ArwL',
        prefix: FOOTER_PREFIX,
        label: 'Previous month',
        disabled: locked || age < 50 || atLimit('prev'),
      },
      {
        id: 'next',
        pane: 'B_ArwR',
        prefix: FOOTER_PREFIX,
        label: 'Next month',
        disabled: locked || age < 50 || atLimit('next'),
      },
      ...cells.map((cell) => ({
        id: `date-${cell.index}`,
        pane: 'B_Cal',
        prefix: datePrefix(cell.index),
        label: `${messageMap[117 + cell.month] ?? MONTHS[cell.month - 1]} ${cell.day}, ${cell.year}`,
        disabled: locked || cell.disabled,
      })),
    ];
  };
  function sheet() {
    const result = poseLayout(sheetSource, [
      clip(sheetSource, 'G_All', sheetFrame()),
      clip(sheetSource, 'G_Yobi', mondayFirst ? 1 : 0),
    ]);
    const { panes } = indexLayout(result);
    const central = isScrolling() ? oldMonth : date;
    for (let i = 0; i < 3; i++) {
      const month = shiftMonth(central, i - 1);
      panes.get(`T_CalMonth_${'abc'[i]}`).text =
        `${messageMap[117 + month.month] ?? MONTHS[month.month - 1]} ${month.year}`;
      WEEK_PANES[i].forEach((number, day) => {
        const weekday = (day + (mondayFirst ? 1 : 0)) % 7;
        panes.get(`TextBox_${String(number).padStart(2, '0')}`).text =
          messageMap[DAY_IDS[weekday]] ?? DAYS[weekday];
      });
    }
    return result;
  }
  function dayLayer(cell, offset, anchor, rotation) {
    const index = cell.index + offset,
      focus = offset ? null : dayFocus.get(`date-${cell.index}`);
    const focusFrame = focus ? (focus.entering ? 0 : 10) + focus.frame : 0;
    const selectionFrame =
      !offset && selected?.index === cell.index
        ? 50 + clamp(phase === 'select' ? frame : selectionVisibleFrames, selectionVisibleFrames)
        : 50;
    const position = transform3D(anchor, (cell.index % 7) * 70, -Math.floor(cell.index / 7) * 48);
    const hasMessages = messageDates.has(`${cell.year}-${cell.month}-${cell.day}`);
    const signature = JSON.stringify([
      cell,
      position,
      rotation,
      focusFrame,
      selectionFrame,
      hasMessages,
    ]);
    if (dayCache.get(index)?.signature === signature) return dayCache.get(index).layer;
    const layout = poseLayout(daySource, [
      sourceDayClip('dateHover', focusFrame),
      sourceDayClip('dateSelect', selectionFrame),
      sourceDayClip('dateButton', cell.buttonFrame),
      sourceDayClip('dateText', cell.textFrame),
      sourceDayClip('dateMessage', hasMessages ? 1 : 0),
    ]);
    const { panes } = indexLayout(layout);
    panes.get('T_Cal').text = String(cell.day);
    panes.get('N_CalDay_t').translation = position;
    panes.get('N_CalDay_t').rotation = [...rotation];
    const layer = { layout, prefix: datePrefix(index) };
    dayCache.set(index, { signature, layer });
    return layer;
  }
  function footer() {
    const clips = [
      clip(footerSource, 'G_SeenChange', footerFrame()),
      clip(footerSource, 'G_ArwRoop', 10000 + (age % 55)),
    ];
    for (const id of ['prev', 'next']) {
      const side = id === 'prev' ? 'L' : 'R';
      let arrowFrame = atLimit(id) ? 10110 : 10160;
      if (age < 40) arrowFrame = 10110;
      else if (age < 50 && !atLimit(id)) arrowFrame = 10150 + (age - 40);
      if (isScrolling() && atLimit(id, oldMonth) !== atLimit(id))
        arrowFrame = (atLimit(id) ? 10100 : 10150) + clamp(frame, 10);
      if (phase === 'exit' && !atLimit(id)) arrowFrame = 10100 + clamp(frame, 10);
      clips.push(clip(footerSource, `G_Arw${side}_End`, arrowFrame));
    }
    for (const [id, focus] of footerFocus) {
      const button = ['G_CalExit', 2900, 2930, 6, 8];
      clips.push(
        clip(
          footerSource,
          button[0],
          button[focus.entering ? 1 : 2] + clamp(focus.frame, button[focus.entering ? 3 : 4]),
        ),
      );
    }
    clips.push(...arrows.clips());
    const result = poseLayout(footerSource, clips);
    for (const pane of indexLayout(result).panes.values())
      if (pane.type === 'txt1')
        pane.text = pane.name === 'T_CalExit' ? (messageMap[35] ?? 'Back') : '';
    return { layout: result, prefix: FOOTER_PREFIX };
  }
  const api = {
    setMemos,
    open(value = new Date()) {
      date = dateParts(value);
      if (
        !inRange(date) ||
        !Number.isInteger(date.month) ||
        date.month < 1 ||
        date.month > 12 ||
        !Number.isFinite(localDate(date).getTime())
      )
        throw new RangeError('Calendar date must be within 2000–2035');
      cells = calendarCells(date, { today: clockToday(), mondayFirst });
      incoming = [];
      oldMonth = null;
      selected = null;
      phase = 'enter';
      frame = age = 0;
      resetFocus();
      return true;
    },
    advance(frames) {
      if (!Number.isFinite(frames) || frames < 0)
        throw new RangeError('Frames must be nonnegative');
      age += frames;
      arrows.advance(frames);
      advanceFocus(dayFocus, frames);
      for (const focus of footerFocus.values()) focus.frame += frames;
      let remaining = frames;
      while (phase !== 'closed' && phase !== 'idle') {
        const duration = phase === 'enter' ? 40 : phase === 'exit' ? 50 : 30;
        const step = Math.min(remaining, duration - frame);
        frame += step;
        remaining -= step;
        if (frame < duration) break;
        if (phase === 'select') startExit();
        else if (phase === 'exit') {
          phase = 'closed';
          onBack();
        } else {
          if (isScrolling()) {
            cells = incoming;
            incoming = [];
            oldMonth = null;
            resetFocus(true);
          }
          phase = 'idle';
          frame = 0;
        }
        if (!remaining) break;
      }
    },
    hover(id) {
      if (isScrolling()) {
        const target = isArrowId(id) && !atLimit(id) ? id : null;
        const changed = arrows.hover(target);
        hovered = target;
        return changed;
      }
      if (
        phase !== 'idle' ||
        id === hovered ||
        (id && !controls().some((control) => control.id === id && !control.disabled))
      )
        return false;
      if (hovered?.startsWith('date-')) requestFocus(dayFocus, hovered, false);
      else if (hovered && !isArrowId(hovered))
        footerFocus.set(hovered, { entering: false, frame: 0 });
      hovered = id;
      arrows.hover(isArrowId(id) ? id : null);
      if (id?.startsWith('date-')) {
        requestFocus(dayFocus, id, true);
        const index = Number(id.slice(5));
        dayOrder = [...dayOrder.filter((value) => value !== index), index];
      } else if (id && !isArrowId(id)) footerFocus.set(id, { entering: true, frame: 0 });
      return true;
    },
    activate(id) {
      if (!controls().some((control) => control.id === id && !control.disabled)) return false;
      if (id === 'back') return api.back();
      if (id === 'prev' || id === 'next') {
        oldMonth = date;
        date = shiftMonth(date, id === 'next' ? 1 : -1);
        incoming = calendarCells(date, { today: clockToday(), mondayFirst });
        phase = id;
        frame = 0;
        arrows.press(id);
        resetFocus(true);
        if (arrows.hovered && atLimit(arrows.hovered)) {
          arrows.hover(null);
          hovered = null;
        }
      } else {
        selected = cells.find((cell) => `date-${cell.index}` === id);
        phase = 'select';
        frame = 0;
        onSelectDate(localDate(selected));
        onSound('WIPL_SE_DATE_SELECT');
      }
      return true;
    },
    back() {
      if (phase !== 'idle' || age < 50) return false;
      startExit();
      return true;
    },
    snapshot() {
      return {
        scene: 'calendar',
        phase,
        locked: phase !== 'idle',
        frame,
        date: date && localDate(date),
        month: date && { year: date.year, month: date.month },
        selectedDate: selected && localDate(selected),
      };
    },
    presentation() {
      if (phase === 'closed') return { ...api.snapshot(), layers: [], controls: [] };
      const layout = sheet(),
        matrices = globalMatrices(layout, display),
        { panes } = indexLayout(layout);
      const current = cells.map((cell) =>
        dayLayer(cell, 0, matrices.get('N_CalPos_b'), panes.get('N_Cal_b1').rotation),
      );
      let days;
      if (isScrolling()) {
        const side = phase === 'next' ? 'c' : 'a';
        const added = incoming.map((cell) =>
          dayLayer(
            cell,
            42,
            matrices.get(`N_CalPos_${side}`),
            panes.get(`N_Cal_${side}1`).rotation,
          ),
        );
        days = [...added.reverse(), ...current.reverse()];
      } else {
        // Pointer-owned cells draw last, matching Calendar::onPointDate/draw.
        const hoveredIndex = hovered?.startsWith('date-') ? Number(hovered.slice(5)) : -1;
        days = dayOrder.filter((index) => index !== hoveredIndex).map((index) => current[index]);
        if (hoveredIndex >= 0) days.push(current[hoveredIndex]);
      }
      return {
        ...api.snapshot(),
        sheetFrame: sheetFrame(),
        footerFrame: footerFrame(),
        layers: [{ layout, prefix: 'calendar-sheet:' }, ...days, footer()],
        controls: controls(),
      };
    },
  };
  return api;
}
