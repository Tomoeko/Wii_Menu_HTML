const CONTACTS_KEY = 'wii-menu.contacts';

/** Preserve the existing browser-local slot array and any additional JSON
 * metadata. Validation never repairs or truncates a saved Address Book. */
export function validateContacts(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('The local Address Book must contain at most 100 slots.');
  }
  return Array.from(value, (contact) => {
    if (contact === null) return null;
    if (!contact || typeof contact !== 'object' || Array.isArray(contact)
        || !['wii', 'email'].includes(contact.kind)
        || typeof contact.address !== 'string'
        || typeof contact.nickname !== 'string'
        || !contact.nickname.trim() || contact.nickname.length > 10
        || /[\0\r\n]/.test(contact.nickname)) {
      throw new Error('The local Address Book contains an invalid contact.');
    }
    if (contact.confirmed !== undefined && typeof contact.confirmed !== 'boolean') {
      throw new Error('The local Address Book contains invalid contact confirmation.');
    }
    const validAddress = contact.kind === 'wii'
      ? /^\d{16}$/.test(contact.address)
      : contact.address.length <= 99 && /^[^\s@\0]+@[^\s@\0]+$/.test(contact.address);
    if (!validAddress) throw new Error('The local Address Book contains an invalid address.');
    return structuredClone(contact);
  });
}

export function createContactStorage(getStorage = () => globalThis.localStorage) {
  let baseline;
  let readSucceeded = false;
  return {
    read() {
      // A failed later read must not leave an earlier baseline writable.
      readSucceeded = false;
      const raw = getStorage().getItem(CONTACTS_KEY);
      const contacts = validateContacts(raw === null ? [] : JSON.parse(raw));
      baseline = raw;
      readSucceeded = true;
      return contacts;
    },
    save(value) {
      if (!readSucceeded) {
        throw new Error('Read the local Address Book successfully before saving changes.');
      }
      const contacts = validateContacts(value);
      const serialized = JSON.stringify(contacts);
      const storage = getStorage();
      if (storage.getItem(CONTACTS_KEY) !== baseline) {
        throw new Error('The local Address Book changed elsewhere. Reload before saving changes.');
      }
      // Storage.setItem either replaces this value or throws. Keep the baseline
      // unchanged after quota/security errors so the visible draft can retry.
      storage.setItem(CONTACTS_KEY, serialized);
      baseline = serialized;
      return structuredClone(contacts);
    },
  };
}

const storage = createContactStorage();
export const readContacts = () => storage.read();
export const saveContacts = (contacts) => storage.save(contacts);
