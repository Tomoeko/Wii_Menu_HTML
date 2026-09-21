import { incomingPhotoAssets } from './incoming-letter-fixture.js';

/** Load each immutable local image once before Board construction. Full photos
 * and predecoded card thumbnails fail independently; neither uses the original
 * resource's sample texture as a replacement for a missing local asset. */
export async function preloadIncomingLetterAssets(records, loadTexture) {
  if (typeof loadTexture !== 'function') throw new TypeError('An image loader is required.');
  const assets = new Map();
  for (const record of records) {
    if (record.kind !== 'letter' || !record.photo) continue;
    for (const asset of incomingPhotoAssets(record.photo)) {
      const existing = assets.get(asset.localSrc);
      if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) {
        throw new Error('Conflicting incoming Letter image descriptors.');
      }
      assets.set(asset.localSrc, asset);
    }
  }
  const images = [...assets.values()];
  const results = await Promise.allSettled(images.map(async (image) => loadTexture(image.localSrc)));
  const unavailablePhotoIds = new Set();
  const unavailableThumbnailIds = new Set();
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const image = images[index];
    (image.kind === 'photo' ? unavailablePhotoIds : unavailableThumbnailIds).add(image.id);
  });
  return { unavailablePhotoIds, unavailableThumbnailIds };
}
