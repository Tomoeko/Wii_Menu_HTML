import {
  MAX_LOCAL_LETTER_UNITS,
  validateLocalAttachment,
  validateLocalLetter,
} from './message-service.js';

const identifier = /^[A-Za-z0-9_-]{1,64}$/;
const validId = (value) => typeof value === 'string' && identifier.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);

/** Explicit local erasure cannot be inferred from a stale complete Board save. */
export function validateIncomingLetterErase(value) {
  if (!value || value.version !== 1 || !validId(value.id)
      || Object.keys(value).some((key) => !['version', 'id'].includes(key))) {
    throw new Error('Expected a version 1 incoming Letter identifier.');
  }
  return { version: 1, id: value.id };
}

/** Prepared, local-only image metadata. The host must verify and decode its
 * source bytes before publishing this descriptor; this validator performs no IO.
 */
export function validateIncomingPhoto(value) {
  try {
    return validateLocalAttachment(value);
  } catch (error) {
    throw new Error(`Incoming photos require bounded dimensions and a prepared local asset: ${error.message}`);
  }
}

/** Each logical photo can have a separately prepared Board capture. Its fixed
 * subdirectory prevents thumbnail names from colliding with full-photo IDs. */
export function incomingPhotoAssets(value) {
  const photo = validateIncomingPhoto(value);
  if (!photo) return [];
  const { thumbnail, ...full } = photo;
  return [{ ...full, kind: 'photo' },
    ...(thumbnail ? [{ id: photo.id, ...thumbnail, kind: 'thumbnail' }] : [])];
}

export function validateIncomingLetter(value) {
  if (value?.kind !== 'letter' || !validId(value.id)
      || typeof value.header !== 'string' || value.header.length > 256 || value.header.includes('\0')
      || typeof value.text !== 'string' || value.text.length > MAX_LOCAL_LETTER_UNITS
      || value.text.includes('\0') || typeof value.createdAt !== 'string'
      || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Invalid incoming local Letter fixture.');
  }
  const photo = validateIncomingPhoto(value.photo);
  if (!value.text.length && !photo) throw new Error('An incoming Letter needs text or a photo.');
  if (value.replyAllowed !== undefined && typeof value.replyAllowed !== 'boolean') {
    throw new Error('Incoming Letter replyAllowed must be a boolean.');
  }
  if (value.sender === null && value.replyAllowed === true) {
    throw new Error('An incoming Letter without a sender cannot permit Reply.');
  }
  if (value.origin !== undefined && value.origin !== 'outbox') {
    throw new Error('Incoming Letter origin is unsupported.');
  }
  // Explicit null represents an original address type of NONE. An omitted or
  // malformed sender still fails recipient validation instead of silently
  // converting an incomplete fixture into a non-replyable message.
  const sender = value.sender === null ? null : validateLocalLetter({
    id: value.id, recipient: value.sender, text: value.text || ' ', attachment: null,
  }).recipient;
  return { kind: 'letter', id: value.id, createdAt: new Date(value.createdAt).toISOString(),
    header: value.header, text: value.text, sender, photo,
    ...(value.origin === 'outbox' ? { origin: 'outbox' } : {}),
    ...(value.replyAllowed === false ? { replyAllowed: false } : {}) };
}

export function validateIncomingLetterFixture(value) {
  if (value?.version !== 1 || !Array.isArray(value.letters) || value.letters.length > 200)
    throw new Error('Expected a version 1 incoming Letter fixture with at most 200 records.');
  const identifiers = new Set();
  const letters = value.letters.map((entry) => {
    const letter = validateIncomingLetter(entry);
    if (identifiers.has(letter.id)) throw new Error('Duplicate incoming Letter fixture identifier.');
    identifiers.add(letter.id);
    return letter;
  });
  return { version: 1, letters };
}

/** Native photo fitting (USA 4.3, 0x81399FEC) preserves the complete aspect. */
export function fitIncomingPhoto(photo, [width, height]) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Photo pane bounds must be positive.');
  const scale = Math.min(width / photo.width, height / photo.height);
  return [photo.width * scale, photo.height * scale];
}
