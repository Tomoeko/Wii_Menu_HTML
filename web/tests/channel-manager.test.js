import test from 'node:test';
import assert from 'node:assert/strict';
import { createExampleAudio } from '../../tools/custom-channel-audio.mjs';
import {
  describeChannel,
  planFolderImport,
  UPLOAD_LIMITS,
  validateAudioBytes,
  validateChannelDetails,
  validateImageBytes,
  validateMediaBudget,
} from '../src/channel-manager.js';

function pngHeader(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const file = (path, size = 128) => ({ webkitRelativePath: path, size });

test('channel inventory distinguishes fixed, hidden, missing and unplaced channels', () => {
  const disc = describeChannel({
    id: 'disc',
    source: 'system-menu',
    enabled: true,
    slot: 0,
    status: 'visible',
  });
  assert.equal(disc.fixed, true);
  assert.equal(disc.position, 'Page 1 · Slot 1');
  assert.equal(disc.source, 'Built-in');
  const custom = { id: 'custom-a', source: 'custom', enabled: true, slot: 47, status: 'visible' };
  assert.equal(describeChannel(custom).position, 'Page 4 · Slot 12');
  const hidden = describeChannel({ ...custom, enabled: false, slot: null, status: 'disabled' });
  assert.equal(hidden.canPreview, true);
  assert.equal(hidden.status, 'Hidden');
  assert.equal(hidden.position, 'Position remembered');
  assert.equal(
    describeChannel({ ...custom, slot: null, status: 'unplaced' }).status,
    'Waiting for a slot',
  );
  assert.equal(
    describeChannel({ ...custom, missing: ['icon'], status: 'disabled' }).canPreview,
    false,
  );
  assert.equal(describeChannel({ ...custom, status: 'unknown' }).canPreview, false);
  assert.equal(
    describeChannel({ ...custom, id: 'custom-a&kind=icon' }).previewUrl,
    '/channel-preview.html?channel=custom-a%26kind%3Dicon',
  );
});

test('custom channel details validate the public title and color limits', () => {
  assert.deepEqual(validateChannelDetails('  My Channel  ', '#173657', '#56D5EB'), {
    title: 'My Channel',
    colors: { background: '#173657', accent: '#56D5EB' },
  });
  assert.throws(() => validateChannelDetails(' ', '#173657', '#56d5eb'), /name/);
  assert.throws(() => validateChannelDetails('a'.repeat(81), '#173657', '#56d5eb'), /80/);
  assert.throws(() => validateChannelDetails('Channel', 'red', '#56d5eb'), /color/);
});

test('image headers accept SVG guides and reject wrong formats or unsafe dimensions', () => {
  assert.deepEqual(validateImageBytes(pngHeader(240, 160)), { width: 240, height: 160 });
  assert.deepEqual(
    validateImageBytes(Buffer.from('<svg width="832" height="456"></svg>')),
    { width: 832, height: 456 },
  );
  const padded = Buffer.concat([Buffer.alloc(7), pngHeader(4096, 1), Buffer.alloc(3)]);
  assert.deepEqual(validateImageBytes(padded.subarray(7, 40)), { width: 4096, height: 1 });
  assert.throws(() => validateImageBytes(Buffer.from('not an image')), /PNG/);
  assert.throws(() => validateImageBytes(pngHeader(4097, 100)), /4096/);
  assert.throws(() => validateImageBytes(pngHeader(0, 100)), /4096/);
  assert.throws(() => validateImageBytes(pngHeader(240, 160).subarray(0, 20)), /PNG/);
});

test('WAV preflight accepts original example PCM and rejects malformed or compressed audio', () => {
  const original = createExampleAudio();
  const metadata = validateAudioBytes(original);
  assert.equal(metadata.sampleRate, 32000);
  assert.equal(metadata.channels, 2);
  assert.equal(metadata.bits, 16);
  assert.equal(metadata.duration, 2.4);
  assert.equal(original.length, UPLOAD_LIMITS.exampleAudioBytes);
  assert.throws(() => validateAudioBytes(original.subarray(0, -2)), /PCM WAV/);
  for (const [offset, value] of [
    [20, 3],
    [22, 3],
    [32, 1],
    [34, 12],
  ]) {
    const invalid = Buffer.from(original);
    invalid.writeUInt16LE(value, offset);
    assert.throws(() => validateAudioBytes(invalid), /PCM WAV/);
  }
  const invalidRate = Buffer.from(original);
  invalidRate.writeUInt32LE(1000, 24);
  assert.throws(() => validateAudioBytes(invalidRate), /PCM WAV/);
});

test('media size checks reserve space for the default example sound', () => {
  const nearLimit = [{ size: UPLOAD_LIMITS.mediaBytes - 1 }];
  assert.equal(validateMediaBudget(nearLimit, 'none'), UPLOAD_LIMITS.mediaBytes - 1);
  assert.throws(() => validateMediaBudget(nearLimit, 'example'), /32 MiB/);
  assert.throws(
    () => validateMediaBudget([{ size: UPLOAD_LIMITS.mediaBytes + 1 }], 'upload'),
    /32 MiB/,
  );
});

test('folder import preserves supported nested resources and rejects ambiguous paths before upload', () => {
  const planned = planFolderImport([
    file('My Folder/channel.json'),
    file('My Folder/layouts/icon.json'),
    file('My Folder/media/icon.png'),
    file('My Folder/media/banner-guide.svg'),
    file('My Folder/README.md'),
    file('My Folder/.DS_Store'),
  ]);
  assert.deepEqual(
    planned.files.map((entry) => entry.path),
    ['channel.json', 'layouts/icon.json', 'media/icon.png', 'media/banner-guide.svg', 'README.md'],
  );
  assert.equal(planned.ignored, 1);
  assert.throws(() => planFolderImport([file('Package/layouts/icon.json')]), /channel.json/);
  assert.throws(
    () => planFolderImport([file('Package/channel.json'), file('Other/banner.json')]),
    /one|top level/,
  );
  assert.throws(
    () => planFolderImport([file('Package/channel.json'), file('Package/../file.png')]),
    /relative/,
  );
  assert.throws(
    () =>
      planFolderImport([
        file('Package/channel.json'),
        file('Package/Icon.png'),
        file('Package/icon.png'),
      ]),
    /duplicate/,
  );
  assert.throws(
    () => planFolderImport([file('Package/channel.json', UPLOAD_LIMITS.jsonBytes + 1)]),
    /2 MiB/,
  );
  assert.throws(
    () =>
      planFolderImport([
        file('Package/channel.json'),
        file('Package/README.md', UPLOAD_LIMITS.jsonBytes + 1),
      ]),
    /2 MiB/,
  );
  assert.throws(
    () =>
      planFolderImport([
        file('Package/channel.json'),
        file('Package/a.png', UPLOAD_LIMITS.mediaBytes),
        file('Package/b.wav', 1),
      ]),
    /32 MiB/,
  );
  assert.throws(
    () =>
      planFolderImport([
        file('Package/channel.json'),
        ...Array.from({ length: 260 }, (_, index) => file(`Package/${index}.md`)),
      ]),
    /260/,
  );
});
