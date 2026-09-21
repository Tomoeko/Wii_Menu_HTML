const sameValue = (left, right) => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
      || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
};

export function boardConflict() {
  return Object.assign(new Error('The Message Board changed in another session. Reload before retrying.'), {
    code: 'BOARD_CONFLICT',
  });
}

/** Merge validated snapshots without treating omission as permission to erase.
 * Position is one field; independent read-time/content changes can coexist.
 * Explicit ID operations own deletion. No revisions or tombstones are stored.
 */
export function mergeMessageBoardRecords(base, current, desired) {
  const original = new Map(base.map((record) => [record.id, record]));
  const merged = new Map(current.map((record) => [record.id, structuredClone(record)]));
  for (const record of desired) {
    const before = original.get(record.id);
    const present = merged.get(record.id);
    if (!before) {
      if (present && !sameValue(record, present)) throw boardConflict();
      if (!present) merged.set(record.id, structuredClone(record));
      continue;
    }
    if (!present) {
      if (!sameValue(record, before)) throw boardConflict();
      continue;
    }
    for (const key of new Set([...Object.keys(before), ...Object.keys(record)])) {
      if (sameValue(record[key], before[key])) continue;
      if (!sameValue(present[key], before[key]) && !sameValue(present[key], record[key])) {
        throw boardConflict();
      }
      if (record[key] === undefined) delete present[key];
      else present[key] = structuredClone(record[key]);
    }
  }
  return [...merged.values()];
}
