import { validateIncomingLetter, validateIncomingLetterErase } from './incoming-letter-fixture.js';
import { createMessageBoardClient } from './message-board-client.js';
import { boardConflict } from './message-board-merge.js';

const endpoint = '/api/message-board';
const recordsFrom = (data) => {
  if (data.version !== 1 || !Array.isArray(data.memos)) {
    throw new Error('Unsupported Message Board data.');
  }
  return data.memos.map((record) => record?.kind === 'letter'
    ? { ...validateIncomingLetter(record), readAt: record.readAt, position: record.position }
    : record);
};
const incomingRecordsFrom = (data) => recordsFrom(data)
  .filter((record) => record.origin !== 'outbox');
const client = createMessageBoardClient({
  async read() {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Could not read .local/message-board.json.');
    return incomingRecordsFrom(await response.json());
  },
  async write(request) {
    const response = await fetch(endpoint, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (response.status === 409) throw boardConflict();
    if (!response.ok) throw new Error('Could not save .local/message-board.json.');
    return incomingRecordsFrom(await response.json());
  },
});

export async function readMessageBoard() {
  return client.read();
}

export function prepareMessageBoardSave(memos) {
  // Local outbox records are read-only projections from /api/letter-outbox;
  // sending them to the incoming Board endpoint would turn a local send into
  // an immutable incoming Letter and can make later Memo writes fail.
  return client.prepareSave(memos.filter((record) => record?.origin !== 'outbox'));
}

export function saveMessageBoard(memos) {
  return prepareMessageBoardSave(memos)();
}

/** The caller serializes this explicit operation with pending Board saves. */
export async function eraseIncomingLetter(id) {
  const request = validateIncomingLetterErase({ version: 1, id });
  const response = await fetch(`${endpoint}/erase-letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('Could not erase the local incoming Letter.');
  const result = await response.json();
  if (result.version !== 1 || result.id !== id || typeof result.erased !== 'boolean') {
    throw new Error('Unsupported incoming Letter erasure response.');
  }
  client.erased(id);
  return result;
}

export async function eraseMemo(id) {
  if (typeof id !== 'string' || !id.length || id.length > 128) {
    throw new Error('Expected a Memo identifier.');
  }
  const response = await fetch(`${endpoint}/erase-memo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, id }),
  });
  if (!response.ok) throw new Error('Could not erase the local Memo.');
  const result = await response.json();
  if (result.version !== 1 || result.id !== id || typeof result.erased !== 'boolean') {
    throw new Error('Unsupported Memo erasure response.');
  }
  client.erased(id);
  return result;
}
