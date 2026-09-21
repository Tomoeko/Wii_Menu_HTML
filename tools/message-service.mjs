import {
  defaultMessageFixture,
  MAX_LOCAL_LETTERS,
  validateLetterOutbox,
  validateLocalLetter,
  validateMessageFixture,
} from '../web/src/message-service.js';
import { createValidatedJsonState } from './validated-json-state.mjs';

const fixture = createValidatedJsonState({
  validate: validateMessageFixture,
  fallback: defaultMessageFixture,
  maxBytes: 4096,
  label: 'Local message fixture',
});
const outbox = createValidatedJsonState({
  validate: validateLetterOutbox,
  fallback: () => ({ version: 1, letters: [] }),
  maxBytes: 16 * 1024 * 1024,
  label: 'Local Letter outbox',
});

export const readMessageFixture = fixture.read;
export const readLetterOutbox = outbox.read;

export async function appendLocalLetter(file, value) {
  const letter = validateLocalLetter(value);
  const saved = await outbox.update(file, (current) => {
    const existing = current.letters.find((entry) => entry.id === letter.id);
    if (existing) {
      if (JSON.stringify(validateLocalLetter(existing)) !== JSON.stringify(letter)) {
        throw new Error('A different local Letter already uses this request identifier.');
      }
      return current;
    }
    if (current.letters.length >= MAX_LOCAL_LETTERS) {
      throw new Error('The local Letter outbox is full.');
    }
    return {
      version: 1,
      letters: [...current.letters, { ...letter, createdAt: new Date().toISOString() }],
    };
  });
  return saved.letters.find((entry) => entry.id === letter.id);
}
