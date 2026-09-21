import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidRegistrationEmail,
  isValidWiiNumber,
  registrationAddressIssue,
  validateOwnWiiNumber,
} from '../src/address-validation.js';
import { validateContacts } from '../src/contact-storage.js';

// These unassigned structural fixtures were generated from payloads 1, 2, 3,
// 42 and 2**37 and verified with the original USA 4.3 functions in isolated
// PowerPC memory. They are not console identities obtained from NAND data.
const generated = ['7053433507880718', '8742285515623182', '8179332609414415',
  '0860984825562383', '3675735668494095'];

test('Wii Number validation matches original checksum vectors without decimal precision loss', () => {
  for (const number of generated) assert.equal(isValidWiiNumber(number), true, number);
  // The original transform masks to 53 bits; this exact 16-digit input is a
  // valid alias above Number.MAX_SAFE_INTEGER, not a rounded JS Number.
  assert.equal(isValidWiiNumber('9868184080303375'), true);
  for (const number of ['1234567812345678', '0000000000000000', '7053433507880719',
    '705343350788071', '07053433507880718', '7053 4335 0788 0718', '', 7053433507880718, null]) {
    assert.equal(isValidWiiNumber(number), false, String(number));
  }
  assert.equal(validateOwnWiiNumber(undefined), null);
  assert.equal(validateOwnWiiNumber(null), null);
  assert.equal(validateOwnWiiNumber(generated[0]), generated[0]);
  assert.throws(() => validateOwnWiiNumber('1234567812345678'));
});

test('registration preserves native own, duplicate and decoded type rejection priorities', () => {
  const own = { kind: 'wii', address: generated[0] };
  assert.equal(registrationAddressIssue(own, {
    contacts: [own], ownWiiNumber: generated[0],
  }), 'own-wii');
  const invalidLegacy = { kind: 'wii', address: '1234567812345678', nickname: 'Legacy' };
  assert.equal(registrationAddressIssue(invalidLegacy, { contacts: [invalidLegacy] }), 'duplicate-wii');
  assert.equal(registrationAddressIssue(invalidLegacy), 'invalid-wii');
  assert.equal(registrationAddressIssue({ kind: 'wii', address: generated[1] }, {
    ownWiiNumber: generated[0],
  }), null);
  const otherType = { kind: 'wii', address: generated[4] };
  assert.equal(registrationAddressIssue(otherType), null, 'unknown local identity does not imply type 0');
  assert.equal(registrationAddressIssue(otherType, { ownWiiNumber: generated[0] }), 'invalid-wii');
  assert.equal(registrationAddressIssue(otherType, {
    contacts: [otherType], ownWiiNumber: generated[0],
  }), 'duplicate-wii');
  assert.deepEqual(validateContacts([null, invalidLegacy]), [null, invalidLegacy],
    'registration validation does not strand older saved contacts');
});

test('email registration uses original ASCII and domain rules within the 99-unit field', () => {
  for (const address of ['a@b', '.a..@b', 'a@-b_', 'a+tag@b.c', "a'b@c",
    'a@wii.com.example', 'A@EXAMPLE.INVALID', `${'a'.repeat(97)}@b`]) {
    assert.equal(isValidRegistrationEmail(address), true, address);
  }
  for (const address of ['a@wii.com', 'a@WII.COM', 'a@.b', 'a@b.', 'a@b..c',
    'a@b+c', 'a@@b', '@b', 'a@', 'a b@c', 'é@b', 'a@é', 'a\0@b', '',
    `${'a'.repeat(98)}@b`]) {
    assert.equal(isValidRegistrationEmail(address), false, address);
  }
  for (const character of '()<>[]:;\\,"') {
    assert.equal(isValidRegistrationEmail(`a${character}b@c`), false, character);
  }
  const legacy = { kind: 'email', address: 'a(b)@c', nickname: 'Legacy' };
  assert.equal(registrationAddressIssue(legacy, { contacts: [legacy] }), 'duplicate-email');
  assert.equal(registrationAddressIssue(legacy), 'invalid-email');
  assert.equal(registrationAddressIssue({ kind: 'email', address: 'A@b' }, {
    contacts: [{ kind: 'email', address: 'a@b' }],
  }), null, 'duplicate matching remains byte-exact');
  assert.deepEqual(validateContacts([legacy]), [legacy]);
});
