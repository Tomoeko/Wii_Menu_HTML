import { boardConflict, mergeMessageBoardRecords } from './message-board-merge.js';

/** Accepted server records and proposed UI records have different ownership.
 * Capture an operation when the UI changes, then enqueue its returned function.
 * A later response cannot turn an older queued snapshot into an overwrite of
 * unrelated changes learned from the server.
 */
export function createMessageBoardClient({ read, write }) {
  let accepted = null;
  let proposed = null;
  let failedBase = null;
  const acceptedIds = new Set();
  const remember = (records) => {
    accepted = structuredClone(records);
    for (const { id } of records) acceptedIds.add(id);
  };
  return {
    async read() {
      const records = await read();
      remember(records);
      proposed = structuredClone(records);
      failedBase = null;
      return structuredClone(records);
    },
    prepareSave(records) {
      if (!accepted) throw new Error('Read the Message Board before saving changes.');
      const previousProposal = structuredClone(proposed);
      const desired = structuredClone(records);
      proposed = structuredClone(records);
      return async () => {
        // A failed first post has never been accepted. A following local edit
        // can still post it; an ID once accepted and later erased cannot return.
        const previous = failedBase ?? previousProposal;
        try {
          const localBase = previous.filter(({ id }) => acceptedIds.has(id));
          const next = mergeMessageBoardRecords(localBase, accepted, desired);
          const result = await write({ version: 1, base: structuredClone(accepted), memos: next });
          remember(result);
          failedBase = null;
          return structuredClone(result);
        } catch (error) {
          // Later UI snapshots still contain a failed operation's intent.
          // Compare against its earlier proposal until a save is accepted,
          // including when later operations were queued before this failure.
          failedBase ??= structuredClone(previous);
          throw error;
        }
      };
    },
    erased(id) {
      if (!accepted) return;
      acceptedIds.add(id);
      accepted = accepted.filter((record) => record.id !== id);
    },
    baseline() {
      if (!accepted) throw boardConflict();
      return structuredClone(accepted);
    },
  };
}
