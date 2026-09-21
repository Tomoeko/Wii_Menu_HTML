/** Primary remains the default for existing semantic control activations.
 * Secondary is an explicit fresh trigger, never an inferred held-button state.
 */
export function isPrimaryKeyboardTrigger({ secondary = false, primary = !secondary } = {}) {
  return Boolean(primary);
}
