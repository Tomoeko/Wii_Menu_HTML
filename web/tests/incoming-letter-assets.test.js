import test from 'node:test';
import assert from 'node:assert/strict';
import { preloadIncomingLetterAssets } from '../src/incoming-letter-assets.js';
import { validateIncomingPhoto, incomingPhotoAssets } from '../src/incoming-letter-fixture.js';

const photo = { id: 'synthetic-photo', width: 512, height: 256,
  localSrc: '/assets/local-letters/synthetic-photo.png', sha256: 'a'.repeat(64) };
const thumbnail = { width: 64, height: 48,
  localSrc: '/assets/local-letters/thumbnails/synthetic-photo.png', sha256: 'b'.repeat(64) };
const record = (value) => ({ kind: 'letter', photo: value });

test('optional thumbnails preserve legacy photo shape and validate their separate fixed-size asset', () => {
  assert.deepEqual(validateIncomingPhoto(photo), photo);
  assert.deepEqual(validateIncomingPhoto({ ...photo, thumbnail: null }), photo);
  const input = { ...photo, thumbnail: { ...thumbnail, privatePath: '/not-exported' } };
  const result = validateIncomingPhoto(input);
  assert.deepEqual(result, { ...photo, thumbnail });
  result.thumbnail.width = 1;
  assert.equal(input.thumbnail.width, 64);
  assert.deepEqual(incomingPhotoAssets({ ...photo, thumbnail }).map(({ kind, localSrc }) =>
    ({ kind, localSrc })), [
    { kind: 'photo', localSrc: photo.localSrc },
    { kind: 'thumbnail', localSrc: thumbnail.localSrc },
  ]);
  for (const change of [{ width: 63 }, { height: 49 }, { width: '64' }, { sha256: 'invalid' },
    { localSrc: photo.localSrc }, { localSrc: thumbnail.localSrc + '?alternate=1' },
    { localSrc: '/assets/local-letters/thumbnails/../synthetic-photo.png' }]) {
    assert.throws(() => validateIncomingPhoto({ ...photo, thumbnail: { ...thumbnail, ...change } }),
      /64×48 asset/);
  }
});

test('incoming preload deduplicates shared full and thumbnail images and waits for both owners', async () => {
  const requests = [];
  const pending = [];
  const records = [record(photo), ...Array.from({ length: 20 }, () => record({ ...photo, thumbnail }))];
  let completed = false;
  const loading = preloadIncomingLetterAssets(records, (src) => {
    requests.push(src);
    return new Promise((resolve) => pending.push(resolve));
  }).then((result) => { completed = true; return result; });
  assert.deepEqual(requests, [photo.localSrc, thumbnail.localSrc]);
  pending[0]();
  await Promise.resolve();
  assert.equal(completed, false, 'Board construction cannot proceed while its thumbnail is pending');
  pending[1]();
  const result = await loading;
  assert.deepEqual([...result.unavailablePhotoIds], []);
  assert.deepEqual([...result.unavailableThumbnailIds], []);
});

test('failed thumbnails and full photos are independent and never retry through the sample resource', async () => {
  for (const failed of ['photo', 'thumbnail']) {
    const requested = [];
    const result = await preloadIncomingLetterAssets([record({ ...photo, thumbnail })], (src) => {
      requested.push(src);
      if (src === (failed === 'photo' ? photo : thumbnail).localSrc) {
        throw new Error('Synthetic missing prepared image');
      }
      return Promise.resolve();
    });
    assert.deepEqual(requested, [photo.localSrc, thumbnail.localSrc]);
    assert.deepEqual([...result.unavailablePhotoIds], failed === 'photo' ? [photo.id] : []);
    assert.deepEqual([...result.unavailableThumbnailIds], failed === 'thumbnail' ? [photo.id] : []);
  }
  let loads = 0;
  await assert.rejects(preloadIncomingLetterAssets([
    record(photo), record({ ...photo, sha256: 'c'.repeat(64) }),
  ], () => { loads++; }), /Conflicting/);
  assert.equal(loads, 0, 'conflicting descriptors are rejected before image requests');
});
