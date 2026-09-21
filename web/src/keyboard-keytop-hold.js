import { createKeyboardHeldInput } from './keyboard-held-input.js';

/** ASCII (0x81415994) and telephone (0x8141B55C) repeat only their delete/space
 * panes. The native condition first succeeds at 36, then every nine updates;
 * the ordinary keytops never enter this branch.
 */
export function createKeytopHold(options) {
  return createKeyboardHeldInput({
    ...options,
    repeatAt: (counter) => counter >= 30 && counter % 9 === 0,
  });
}
