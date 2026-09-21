import { validateOwnWiiNumber } from './address-validation.js';

// Local fixture limit: the native work buffer has 1024 UTF-16 units; reserve
// its terminator until the exact editable-limit path is verified.
export const MAX_LOCAL_LETTER_UNITS = 1023;
export const MAX_LOCAL_LETTERS = 2000;
const localAttachmentId = /^[A-Za-z0-9_-]{1,64}$/;

/** Prepared local photo metadata used by the offline Letter fixture. The
 * importer verifies the bytes before publishing this descriptor; the browser
 * only accepts the bounded, deterministic path and dimensions here. */
export function validateLocalAttachment(value) {
  if (value === null) return null;
  if (!value || !localAttachmentId.test(value.id)
      || ['__proto__', 'constructor', 'prototype'].includes(value.id)
      || !Number.isInteger(value.width) || !Number.isInteger(value.height)
      || value.width < 1 || value.width > 512 || value.height < 1 || value.height > 456
      || value.localSrc !== `/assets/local-letters/${value.id}.png`
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('Local Letter attachments require bounded prepared photo metadata.');
  }
  const attachment = {
    id: value.id, width: value.width, height: value.height,
    localSrc: value.localSrc, sha256: value.sha256,
  };
  if (value.thumbnail !== undefined && value.thumbnail !== null) {
    const thumbnail = value.thumbnail;
    if (thumbnail.width !== 64 || thumbnail.height !== 48
        || thumbnail.localSrc !== `/assets/local-letters/thumbnails/${value.id}.png`
        || typeof thumbnail.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(thumbnail.sha256)) {
      throw new Error('Local Letter thumbnails require a prepared 64×48 asset.');
    }
    attachment.thumbnail = {
      width: 64, height: 48, localSrc: thumbnail.localSrc, sha256: thumbnail.sha256,
    };
  }
  return attachment;
}

export function defaultMessageFixture() {
  return { version: 1, letterService: 'offline', localRegistration: false, ownWiiNumber: null };
}

export function validateMessageFixture(value) {
  if (value?.version !== 1 || !['offline', 'local'].includes(value.letterService)) {
    throw new Error('Expected a version 1 offline or local Letter fixture.');
  }
  if (value.localRegistration !== undefined && typeof value.localRegistration !== 'boolean') {
    throw new Error('Local Address registration must be a Boolean.');
  }
  return {
    version: 1,
    letterService: value.letterService,
    localRegistration: value.localRegistration ?? false,
    ownWiiNumber: validateOwnWiiNumber(value.ownWiiNumber),
  };
}

export function validateLocalLetter(value) {
  if (typeof value?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id)) {
    throw new Error('A local Letter needs a stable request identifier.');
  }
  const recipient = value.recipient;
  if (!recipient || !['wii', 'email'].includes(recipient.kind)
      || typeof recipient.address !== 'string' || recipient.address.length > 256
      || typeof recipient.nickname !== 'string' || recipient.nickname.length > 10
      || recipient.nickname.includes('\0')) {
    throw new Error('Invalid local Letter recipient.');
  }
  const validAddress = recipient.kind === 'wii'
    ? /^\d{16}$/.test(recipient.address)
    : /^[^@\s\0]+@[^@\s\0]+$/.test(recipient.address);
  if (!validAddress) throw new Error('Invalid local Letter address.');
  const attachment = validateLocalAttachment(value.attachment ?? null);
  if (typeof value.text !== 'string' || (!value.text.length && !attachment)
      || value.text.length > MAX_LOCAL_LETTER_UNITS || value.text.includes('\0')) {
    throw new Error(`Local Letters need 1–${MAX_LOCAL_LETTER_UNITS} UTF-16 text units.`);
  }
  return {
    id: value.id,
    recipient: {
      kind: recipient.kind,
      address: recipient.address,
      nickname: recipient.nickname,
    },
    text: value.text,
    attachment,
  };
}

export function validateLetterOutbox(value) {
  if (value?.version !== 1 || !Array.isArray(value.letters)
      || value.letters.length > MAX_LOCAL_LETTERS) {
    throw new Error('Invalid version 1 local Letter outbox.');
  }
  const identifiers = new Set();
  const letters = value.letters.map((entry) => {
    const letter = validateLocalLetter(entry);
    if (identifiers.has(letter.id)) throw new Error('Duplicate local Letter identifier.');
    identifiers.add(letter.id);
    if (typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt))) {
      throw new Error('Invalid local Letter creation time.');
    }
    return { ...letter, createdAt: new Date(entry.createdAt).toISOString() };
  });
  return { version: 1, letters };
}

export async function readMessageFixture() {
  const response = await fetch('/api/message-fixture');
  if (!response.ok) throw new Error('Could not read the local message fixture.');
  return validateMessageFixture(await response.json());
}

function outboxRecordId(id) {
  const prefix = 'outbox-';
  if (id.length <= 64 - prefix.length) return `${prefix}${id}`;
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${prefix}${id.slice(0, 48)}-${hash.toString(16).padStart(8, '0')}`;
}

/** Adapt locally sent Letters into read-only Board records. The browser never
 * treats these records as delivered network mail or as incoming replies. */
export async function readLocalLetterOutbox() {
  const response = await fetch('/api/letter-outbox');
  if (!response.ok) throw new Error('Could not read the local Letter outbox.');
  const outbox = validateLetterOutbox(await response.json());
  return outbox.letters.map((letter) => ({
    kind: 'letter',
    id: outboxRecordId(letter.id),
    origin: 'outbox',
    createdAt: letter.createdAt,
    header: `To ${letter.recipient.nickname}`,
    text: letter.text,
    sender: null,
    replyAllowed: false,
    photo: letter.attachment,
  }));
}

export async function saveLocalLetter(value) {
  const letter = validateLocalLetter(value);
  const response = await fetch('/api/letter-outbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(letter),
  });
  if (!response.ok) {
    throw new Error('Could not save the Letter locally. Your draft has been retained.');
  }
  return validateLetterOutbox({ version: 1, letters: [await response.json()] }).letters[0];
}
