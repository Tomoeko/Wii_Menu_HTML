import { PHONE_MODES, symbolPages } from './keyboard-data.js';

export const KEYBOARD_PREFERENCES_VERSION = 2;

/** Stored separately from a draft so closing or cancelling text preserves setup.
 * Version one contained only the dictionary toggle and language. New fields use
 * the browser's supported UI choices, not the native record's unrelated modes.
 */
export function normalizeKeyboardPreferences(value) {
  const supported = value?.schemaVersion === 1 || value?.schemaVersion === 2;
  const current = value?.schemaVersion === 2;
  return {
    schemaVersion: KEYBOARD_PREFERENCES_VERSION,
    predictionEnabled: supported && value.predictionEnabled === true,
    dictionaryLanguage: supported && ['en', 'fr', 'es'].includes(value.dictionaryLanguage)
      ? value.dictionaryLanguage
      : 'en',
    layoutMode: current && value.layoutMode === 'phone' ? 'phone' : 'qwerty',
    phoneMode: current && Number.isInteger(value.phoneMode) &&
        value.phoneMode >= 0 && value.phoneMode < PHONE_MODES.length
      ? value.phoneMode
      : 0,
    symbolPage: current && Number.isInteger(value.symbolPage) &&
        value.symbolPage >= 0 && value.symbolPage < symbolPages.length
      ? value.symbolPage
      : 0,
  };
}
