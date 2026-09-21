/** Static previews have no local Trash; a running server must return valid state. */
export async function readDeletedChannelIds(fetcher = fetch) {
  const response = await fetcher('/api/channels', { cache: 'no-store' });
  if (response.status === 404) return [];
  if (!response.ok)
    throw new Error('Could not load channel recovery state. Check Channel Manager.');
  const inventory = await response.json();
  if (!Array.isArray(inventory.deletedIds)) {
    throw new Error('Channel recovery state is invalid. Restart the local server.');
  }
  return inventory.deletedIds;
}
