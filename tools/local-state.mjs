import { formatJson } from './format-json.mjs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIncomingLetter, validateIncomingLetterErase } from '../web/src/incoming-letter-fixture.js';
import { createValidatedJsonState } from './validated-json-state.mjs';
import { mergeMessageBoardRecords } from '../web/src/message-board-merge.js';

export { validateChannelArrangement as validateArrangement } from '../web/src/channel-storage.js';
import { validateChannelArrangement as validateArrangement } from '../web/src/channel-storage.js';

/** Tracked default state files that every fresh install starts from. */
const defaultsDir = fileURLToPath(new URL('../defaults/', import.meta.url));

/** The project's own .local/ directory — tracked defaults only apply here. */
const projectLocalDir = fileURLToPath(new URL('../.local/', import.meta.url));

/**
 * Read a tracked default file and parse it as JSON. Returns undefined if the
 * file being read is outside the project's `.local/` directory (e.g. a test
 * fixture), or if the tracked default does not exist.
 */
async function readDefault(requestedFile, name) {
  if (!requestedFile.startsWith(projectLocalDir)) return undefined;
  try {
    return JSON.parse(await readFile(join(defaultsDir, name), 'utf8'));
  } catch {
    return undefined;
  }
}

export async function readArrangement(file) {
  try {
    return validateArrangement(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') {
      // No user state yet — try the tracked default before falling back to
      // the hardcoded null-slots sentinel that signals "no saved arrangement".
      const fallback = await readDefault(file, 'channel-layout.json');
      if (fallback) {
        try {
          return validateArrangement(fallback);
        } catch {
          // Tracked default is itself invalid; fall through to null-slots.
        }
      }
      return { version: 1, slots: null };
    }
    // File exists but is corrupted — warn and fall back to defaults rather
    // than crashing the entire channel manager or server endpoint.
    console.warn(
      `warning: ${file} failed validation (${error.message}); using default arrangement`,
    );
    const fallback = await readDefault(file, 'channel-layout.json');
    if (fallback) {
      try {
        return validateArrangement(fallback);
      } catch {
        // Fall through.
      }
    }
    return { version: 1, slots: null };
  }
}

let arrangementWrite = Promise.resolve();
export function writeArrangement(file, value) {
  const arrangement = validateArrangement(value);
  const write = arrangementWrite
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      const lock = `${file}.lock`;
      try {
        await mkdir(lock);
      } catch (error) {
        if (error.code === 'EEXIST') {
          throw Object.assign(new Error('Another channel arrangement command is running.'), {
            code: 'CHANNEL_BUSY',
          });
        }
        throw error;
      }
      try {
        await writeFile(temporary, formatJson(arrangement));
        await rename(temporary, file);
        return arrangement;
      } finally {
        await rm(temporary, { force: true });
        await rm(lock, { recursive: true, force: true });
      }
    });
  arrangementWrite = write;
  return write;
}

export function validateMessageBoard(value) {
  if (value?.version !== 1 || !Array.isArray(value.memos) || value.memos.length > 2000)
    throw new Error('Expected version 1 and at most 2000 memos.');
  const ids = new Set();
  const dateString = (date, label) => {
    if (typeof date !== 'string' || !Number.isFinite(new Date(date).getTime()))
      throw new Error(`Invalid ${label}.`);
    return new Date(date).toISOString();
  };
  const memos = value.memos.map((memo) => {
    if (
      !memo ||
      typeof memo.id !== 'string' ||
      !memo.id.length ||
      memo.id.length > 128 ||
      ids.has(memo.id)
    )
      throw new Error('Memo identifiers must be nonempty and unique.');
    if (typeof memo.text !== 'string' || memo.text.length > 10000)
      throw new Error('Memo text must contain at most 10000 characters.');
    ids.add(memo.id);
    const result = {
      ...(memo.kind === 'letter' ? validateIncomingLetter(memo) : {
        id: memo.id,
        text: memo.text,
        createdAt: dateString(memo.createdAt, 'creation date'),
      }),
      readAt: memo.readAt == null ? null : dateString(memo.readAt, 'read date'),
    };
    if (memo.position !== undefined) {
      const { x, y } = memo.position || {};
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < -230 ||
        x > 230 ||
        y < -80 ||
        y > 180
      )
        throw new Error('Memo position is outside the original Message Board bounds.');
      result.position = { x, y };
    }
    return result;
  });
  return { version: 1, memos };
}

const messageBoardState = createValidatedJsonState({
  validate: validateMessageBoard,
  fallback: async (file) => validateMessageBoard(
    await readDefault(file, 'message-board.json') ?? { version: 1, memos: [] },
  ),
  maxBytes: 64 * 1024 * 1024,
  label: 'Message Board',
});

export const readMessageBoard = messageBoardState.read;

/** The import and ordinary writer share this transaction and process lock. */
export const updateMessageBoard = messageBoardState.update;

export function writeMessageBoard(file, value) {
  const state = validateMessageBoard(value);
  return updateMessageBoard(file, (previous) => {
    const imported = new Map(previous.memos.filter((memo) => memo.kind === 'letter')
      .map((memo) => [memo.id, memo]));
    for (const memo of state.memos) {
      const existing = imported.get(memo.id);
      if (memo.kind === 'letter' || existing) {
        if (!existing || memo.kind !== 'letter' ||
            JSON.stringify(validateIncomingLetter(existing)) !==
            JSON.stringify(validateIncomingLetter(memo))) {
          throw new Error('Incoming Letter content is immutable; use the verified local import.');
        }
        imported.delete(memo.id);
      }
    }
    // A browser opened before an import may submit an older complete snapshot.
    // Only an explicit ID erasure may remove an import; omission is not consent.
    return { version: 1, memos: [...state.memos, ...imported.values()] };
  });
}

/** Browser edits merge against the last accepted server snapshot. CLI import
 * deliberately retains the separate complete-replacement writer above.
 */
export function mergeMessageBoard(file, value) {
  if (value?.version !== 1 || !Array.isArray(value.base)) {
    throw new Error('A browser Board save requires its accepted base records.');
  }
  const desired = validateMessageBoard(value);
  const base = validateMessageBoard({ version: 1, memos: value.base });
  return updateMessageBoard(file, (previous) => {
    const memos = mergeMessageBoardRecords(base.memos, previous.memos, desired.memos);
    const existing = new Map(previous.memos.map((record) => [record.id, record]));
    for (const record of memos) {
      const original = existing.get(record.id);
      if (record.kind === 'letter' || original?.kind === 'letter') {
        if (!original || record.kind !== 'letter'
            || JSON.stringify(validateIncomingLetter(record)) !==
              JSON.stringify(validateIncomingLetter(original))) {
          throw new Error('Incoming Letter content is immutable; use the verified local import.');
        }
      }
    }
    return { version: 1, memos };
  });
}

/** Remove one local fixture record under the same lock as imports and saves.
 * Photo assets may be shared and remain available for deliberate reimport.
 */
export async function eraseIncomingLetter(file, value) {
  const request = validateIncomingLetterErase(value);
  let erased = false;
  await updateMessageBoard(file, (previous) => {
    const record = previous.memos.find((memo) => memo.id === request.id);
    if (record && record.kind !== 'letter') {
      throw new Error('The requested identifier does not belong to an incoming Letter.');
    }
    erased = Boolean(record);
    return { version: 1, memos: previous.memos.filter((memo) => memo.id !== request.id) };
  });
  return { ...request, erased };
}

/** Explicit Memo removal does not replace other records in the collection. */
export async function eraseMemo(file, value) {
  if (!value || value.version !== 1 || typeof value.id !== 'string'
      || !value.id.length || value.id.length > 128
      || Object.keys(value).some((key) => !['version', 'id'].includes(key))) {
    throw new Error('Expected a version 1 Memo identifier.');
  }
  let erased = false;
  await updateMessageBoard(file, (previous) => {
    const record = previous.memos.find((memo) => memo.id === value.id);
    if (record?.kind === 'letter') {
      throw new Error('The requested identifier belongs to an incoming Letter.');
    }
    erased = Boolean(record);
    return { version: 1, memos: previous.memos.filter((memo) => memo.id !== value.id) };
  });
  return { version: 1, id: value.id, erased };
}
