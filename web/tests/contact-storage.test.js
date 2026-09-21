import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactStorage, validateContacts } from '../src/contact-storage.js';

const contact = {
  kind: 'email', address: 'synthetic@example.test', nickname: 'Synthetic',
  confirmed: false, fixtureMetadata: { marker: 'preserved' },
};

function memoryStorage(initial = null) {
  let value = initial;
  let failure = null;
  return {
    getItem: () => value,
    setItem(_key, next) {
      if (failure) throw failure;
      value = next;
    },
    fail(error) { failure = error; },
  };
}

test('contact storage retains sparse slot ownership and additional JSON metadata', () => {
  const original = [null, contact];
  const memory = memoryStorage(JSON.stringify(original));
  const storage = createContactStorage(() => memory);
  const read = storage.read();
  read[1].fixtureMetadata.marker = 'edited';
  assert.deepEqual(JSON.parse(memory.getItem()), original, 'reading returns an independent draft');
  storage.save(read);
  assert.deepEqual(storage.read(), read);
  assert.equal(storage.read()[1].confirmed, false);
});

test('contact read validation blocks mutation without replacing unreadable or invalid records', () => {
  const invalid = [
    '{', '{}', JSON.stringify([null, { ...contact, confirmed: 'yes' }]),
    JSON.stringify(Array(101).fill(null)), JSON.stringify([{ ...contact, nickname: '12345678901' }]),
    JSON.stringify([{ ...contact, kind: 'wii', address: '1234' }]),
  ];
  for (const raw of invalid) {
    const memory = memoryStorage(raw);
    const storage = createContactStorage(() => memory);
    assert.throws(() => storage.read());
    assert.throws(() => storage.save([]), /Read the local Address Book successfully/);
    assert.equal(memory.getItem(), raw);
  }
  assert.throws(() => validateContacts(Array(1)), /invalid contact/);
  assert.throws(() => validateContacts([{ ...contact, nickname: 'a\0b' }]), /invalid contact/);
});

test('contact quota failure preserves its previous baseline so the same draft can retry', () => {
  const memory = memoryStorage(JSON.stringify([contact]));
  const storage = createContactStorage(() => memory);
  const previous = storage.read();
  const edited = [{ ...contact, nickname: 'Renamed' }];
  memory.fail(new Error('Synthetic quota failure'));
  assert.throws(() => storage.save(edited), /Synthetic quota/);
  assert.deepEqual(JSON.parse(memory.getItem()), previous);
  memory.fail(null);
  assert.deepEqual(storage.save(edited), edited);
  assert.deepEqual(storage.read(), edited);
});

test('a previously observed foreign contact change is never overwritten by a stale slot array', () => {
  const memory = memoryStorage(JSON.stringify([contact]));
  const first = createContactStorage(() => memory);
  const second = createContactStorage(() => memory);
  first.read();
  second.read();
  second.save([null, contact]);
  assert.throws(() => first.save([{ ...contact, nickname: 'Old tab' }]), /changed elsewhere/);
  assert.deepEqual(JSON.parse(memory.getItem()), [null, contact]);
  assert.deepEqual(first.read(), [null, contact]);
  first.save([contact, contact]);
  assert.deepEqual(JSON.parse(memory.getItem()), [contact, contact]);
});
