import test from 'node:test';
import assert from 'node:assert/strict';
import { channelPreviewFontDescriptor, MENU_FALLBACK_FONT } from '../src/channel-preview-fonts.js';

const rodin48 = { url: 'fonts/menu-rodin48.json' };
const rodin32 = { url: 'fonts/shared-rodin32.json' };

test('a WAD-only preview uses the menu font when a custom channel requests an absent shared alias', () => {
  const manifest = { fonts: { [MENU_FALLBACK_FONT]: rodin48 } };
  const before = structuredClone(manifest);
  assert.equal(channelPreviewFontDescriptor(manifest, 'wbf1.brfna'), rodin48);
  assert.equal(channelPreviewFontDescriptor(manifest, undefined), rodin48);
  assert.deepEqual(manifest, before, 'fallback does not rewrite the prepared manifest');
});

test('an available exact shared font takes precedence over the menu fallback', () => {
  const manifest = { fonts: { [MENU_FALLBACK_FONT]: rodin48, 'wbf1.brfna': rodin32 } };
  assert.equal(channelPreviewFontDescriptor(manifest, 'wbf1.brfna'), rodin32);
  assert.equal(
    channelPreviewFontDescriptor({ fonts: { 'wbf1.brfna': rodin32 } }, 'wbf1.brfna'),
    rodin32,
  );
});

test('a preview reports missing preparation when neither requested nor fallback font exists', () => {
  assert.throws(() => channelPreviewFontDescriptor({}, 'wbf1.brfna'), /Prepare the menu assets/);
});
