const NUMBER_MASK = (1n << 53n) - 1n;
const NIBBLE_SUBSTITUTION = [13, 5, 9, 7, 0, 15, 10, 2, 12, 3, 14, 1, 8, 6, 11, 4];
const BYTE_PERMUTATION = [1, 5, 0, 4, 2, 3];

function rotateNumber(value, count) {
  return ((value << count) | (value >> (53n - count))) & NUMBER_MASK;
}

/** USA 4.3 NWC24 transform at 0x814AE130. All arithmetic stays integral;
 * decimal Wii Numbers can exceed JavaScript's exact Number range. */
function decodeWiiNumber(value) {
  const rotated = rotateNumber((BigInt(value) & NUMBER_MASK) ^ 0x5e5e5e5e5e5en, 52n);
  let transformed = rotated & (31n << 48n);
  for (const [target, source] of BYTE_PERMUTATION.entries()) {
    const byte = Number((rotated >> BigInt(source * 8)) & 255n);
    const substituted = (NIBBLE_SUBSTITUTION[byte >> 4] << 4)
      | NIBBLE_SUBSTITUTION[byte & 15];
    transformed |= BigInt(substituted) << BigInt(target * 8);
  }
  return rotateNumber(transformed, 10n) ^ 0xb3b3b3b3b3b3n;
}

export function isValidWiiNumber(value) {
  if (typeof value !== 'string' || !/^[0-9]{16}$/.test(value)) return false;
  let remainder = decodeWiiNumber(value);
  // Original 0x814AE098 divides its 53-bit codeword by polynomial 0x635.
  for (let shift = 42n; shift >= 0n; shift--) {
    if (remainder & (1n << (shift + 10n))) remainder ^= 0x635n << shift;
  }
  return remainder === 0n;
}

export function validateOwnWiiNumber(value) {
  if (value === undefined || value === null) return null;
  if (!isValidWiiNumber(value)) {
    throw new Error('The local console fixture needs a checksum-valid 16-digit Wii Number.');
  }
  return value;
}

/** Address profile 7 limits input to 99 units. The original byte predicate
 * 0x8138807C accepts ASCII syntax, including a domain without a dot; its
 * initialized NWC24 domain at 0x8166D6DC is excluded without case sensitivity. */
export function isValidRegistrationEmail(value) {
  if (typeof value !== 'string' || !value.length || value.length > 99) return false;
  const separator = value.indexOf('@');
  if (separator <= 0) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (!/^[\x21-\x7e]+$/.test(local) || /[()<>\[\]:;\\,"]/.test(local)) return false;
  if (!/^[A-Za-z0-9_.-]+$/.test(domain)
      || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  return domain.toLowerCase() !== 'wii.com';
}

/** Registration-only policy. Persisted contacts retain their older storage
 * contract; a validation upgrade must not strand a user's existing records.
 * Original dialog priority at 0x8138A91C is own, duplicate, then invalid. */
export function registrationAddressIssue(contact, { contacts = [], ownWiiNumber = null } = {}) {
  const { kind, address } = contact;
  if (kind === 'wii' && ownWiiNumber !== null && address === ownWiiNumber) return 'own-wii';
  if (contacts.some((entry) => entry && entry.kind === kind && entry.address === address)) {
    return kind === 'wii' ? 'duplicate-wii' : 'duplicate-email';
  }
  if (kind === 'email') return isValidRegistrationEmail(address) ? null : 'invalid-email';
  if (kind !== 'wii' || !isValidWiiNumber(address)) return 'invalid-wii';
  if (ownWiiNumber !== null) {
    const ownType = (decodeWiiNumber(ownWiiNumber) >> 47n) & 7n;
    const recipientType = (decodeWiiNumber(address) >> 47n) & 7n;
    // 0x814ADFAC also rejects a nonzero recipient type when the console's
    // decoded type is zero. Without an explicit fixture, that type is unknown.
    if (ownType === 0n && recipientType !== 0n) return 'invalid-wii';
  }
  return null;
}
