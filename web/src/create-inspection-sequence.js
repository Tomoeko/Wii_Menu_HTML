import { createMenuScenes } from './menu-scenes.js';

export const CREATE_INSPECTION_FLOWS = {
  enter: { label: 'Create selector → Address Book', duration: 28, pageTurns: 0 },
  'exit-cover': { label: 'Address Book cover → Create selector', duration: 48, pageTurns: 0 },
  'exit-page': {
    label: 'Address Book after one page turn → Create selector',
    duration: 48,
    pageTurns: 1,
  },
};

/** Drives the same scene hierarchy as main, without a wall clock or persisted data.
 * Frame zero is the pose immediately after the selected action is accepted.
 * The final frame is the first settled pose after the complete transition. */
export function createInspectionSequence(
  layouts,
  { flow = 'enter', date = new Date(2026, 8, 17, 12), focusFrames = 15, ...options } = {},
) {
  const definition = CREATE_INSPECTION_FLOWS[flow];
  if (!definition) throw new RangeError('Unknown Create inspection flow');
  if (!Number.isInteger(focusFrames) || focusFrames < 0 || focusFrames > 60)
    throw new RangeError('Focus duration must be an integer from 0 to 60');
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
    throw new RangeError('A valid inspection date is required');
  const fixedDate = new Date(date);
  let scenes;
  let frame;
  const actions = [];

  function reset() {
    actions.length = 0;
    scenes = createMenuScenes(layouts, options);
    scenes.open('board');
    scenes.advance(40);
    scenes.presentation({ date: fixedDate });
    action('create');
    scenes.advance(39);
    focus('address');
    action('address');
    if (flow !== 'enter') {
      scenes.advance(28);
      if (definition.pageTurns) {
        focus('address-next');
        action('address-next');
        scenes.advance(16);
        scenes.hover(null);
        scenes.advance(15);
      }
      focus('back');
      action('back');
    }
    frame = 0;
  }

  function focus(id) {
    if (focusFrames === 0) return;
    scenes.hover(id);
    scenes.advance(focusFrames);
  }

  function action(id) {
    if (!scenes.activate(id)) throw new Error(`Inspection setup could not activate ${id}`);
    actions.push(id);
  }

  reset();
  return {
    ...definition,
    flow,
    sample(requestedFrame) {
      if (
        !Number.isInteger(requestedFrame) ||
        requestedFrame < 0 ||
        requestedFrame > definition.duration
      ) {
        throw new RangeError(
          `Inspection frame must be an integer from 0 to ${definition.duration}`,
        );
      }
      if (requestedFrame < frame) reset();
      scenes.advance(requestedFrame - frame);
      frame = requestedFrame;
      return {
        presentation: scenes.presentation({ date: fixedDate }),
        metadata: {
          flow,
          frame,
          duration: definition.duration,
          pageTurns: definition.pageTurns,
          focusFrames,
          date: `${fixedDate.getFullYear()}-${String(fixedDate.getMonth() + 1).padStart(2, '0')}-${String(fixedDate.getDate()).padStart(2, '0')}`,
          actions: [...actions],
          state: scenes.snapshot(),
        },
      };
    },
  };
}
