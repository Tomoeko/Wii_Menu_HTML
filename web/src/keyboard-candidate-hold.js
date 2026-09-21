import { createKeyboardHeldInput } from './keyboard-held-input.js';

/** tiCandidateBox arrow event 2 (USA 4.3 0x8142D824) uses the continuously
 * incremented 16-bit hover counter. It requests another page on nonmultiples
 * of 20; the independent candidate movement rejects requests while busy.
 */
export function createCandidateArrowHold(options) {
  return createKeyboardHeldInput({ ...options, repeatAt: (counter) => counter % 20 !== 0 });
}
