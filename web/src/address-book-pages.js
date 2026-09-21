import { indexLayout, walkPanes } from './animation.js';

const PAGE_COUNT = 20;

/** These sheets are recalculated separately with the restored native DrawInfo.
 * Address::draw retains the parent transform, but recalculates a/d/e opacity
 * outside N_note_all's recursion. The b/c faces retain the whole-tree result.
 */
export function addressBookAlphaRoots(layout) {
  return new Set(
    [...indexLayout(layout).panes.keys()].filter((name) =>
      /^N_note_[ade](?::stack-\d+)?$/.test(name),
    ),
  );
}

/** USA 4.3 Address state fields +0xb0/+0xb4/+0xb8, recovered from the binary.
 * Page zero is the closed cover; numbered pages are one through twenty.
 */
export function addressBookGeometry(page, nextPage = null, projectionWidth = 832) {
  let state = page === 0 ? 'cover' : 'normal';
  let rightCount = PAGE_COUNT - page;
  let leftCount = Math.max(0, page - 1);
  let baseSteps = page;
  let turningOffset = 0;
  let facePage = Math.max(1, page);
  let turnPage = facePage;
  let coverOffset;

  if (nextPage !== null) {
    if (page === PAGE_COUNT && nextPage === 0) {
      state = 'loop-forward';
      leftCount = 0;
      coverOffset = 1;
    } else if (page === 0 && nextPage === PAGE_COUNT) {
      state = 'loop-backward';
      rightCount = 0;
      baseSteps = PAGE_COUNT;
      facePage = PAGE_COUNT;
      coverOffset = 1;
    } else if (nextPage > page) {
      state = page === 0 ? 'cover-forward' : 'forward';
      rightCount--;
      baseSteps++;
      turningOffset = 1;
      facePage = nextPage;
    } else {
      state = nextPage === 0 ? 'cover-backward' : 'backward';
      leftCount = Math.max(0, leftCount - 1);
      turningOffset = 1;
      turnPage = Math.max(1, nextPage);
    }
  }

  return {
    state,
    rightCount,
    leftCount,
    baseTranslation: [-baseSteps * (608 / projectionWidth), -baseSteps],
    turningOffset,
    coverOffset: coverOffset ?? leftCount + turningOffset,
    // Address::draw 0x81382524 repeats offsets 1..19 in wrap states 7/8.
    coverCount: state.startsWith('loop-') ? PAGE_COUNT - 1 : 1,
    facePage,
    turnPage,
    turningSheet: state === 'forward' || state === 'backward',
  };
}

/** Address::draw (0x813822dc) redraws original page panes, in this exact order.
 * The per-sheet displacement is (-1,-1); add_vec2 (0x81384074) separately
 * adjusts only the book base's X displacement by 608/projection width.
 */
export function applyAddressBookGeometry(layout, geometry) {
  const panes = indexLayout(layout).panes;
  // Native creation clears this visibility bit (0x81381F48–0x81381F6C).
  // It is a separate contact-move overlay, outside the book fade group.
  // Ordinary page presentation must not expose its authored Mii placeholder.
  panes.get('N_note_move').flags &= ~1;
  const rightTemplate = panes.get('N_note_a');
  const face = panes.get('N_note_b');
  const turning = panes.get('N_note_c');
  const leftTemplate = panes.get('N_note_d');
  const cover = panes.get('N_note_e');
  const base = panes.get('N_note_base');
  base.translation[0] += geometry.baseTranslation[0];
  base.translation[1] += geometry.baseTranslation[1];

  function instance(template, x, y, index) {
    const pane = structuredClone(template);
    if (index > 0) walkPanes(pane, (child) => (child.name += `:stack-${index}`));
    pane.translation = [x, y, 0];
    return pane;
  }

  const sheets = [];
  for (let count = geometry.rightCount; count >= 1; count--) {
    sheets.push(instance(rightTemplate, -count, -count, geometry.rightCount - count));
  }
  if (!geometry.rightCount) {
    rightTemplate.flags &= ~1;
    sheets.push(rightTemplate);
  }
  sheets.push(face);
  if (!geometry.turningSheet) turning.flags &= ~1;
  sheets.push(turning);
  for (let index = 0; index < geometry.leftCount; index++) {
    const offset = index + geometry.turningOffset;
    sheets.push(instance(leftTemplate, offset, offset, index));
  }
  if (!geometry.leftCount) {
    leftTemplate.flags &= ~1;
    sheets.push(leftTemplate);
  }
  for (let index = 0; index < geometry.coverCount; index++) {
    const offset = geometry.coverOffset + index;
    sheets.push(instance(cover, offset, offset, index));
  }
  panes.get('N_note_all').children = sheets;
  return layout;
}
