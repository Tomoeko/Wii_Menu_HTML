import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readCustomPackage } from '../../tools/custom-channels.mjs';
import { inspectImageHeader } from '../src/image-format.js';
import { indexLayout } from '../src/animation.js';
import { createDisplay, prepareAspectLayout } from '../src/display.js';
import { poseChannel } from '../src/channel-animation.js';
import { Renderer } from '../src/renderer.js';

const project = new URL('../../', import.meta.url).pathname;
const example = join(project, 'examples/custom-channels/custom-style-guide-svg');

function guideRectangle(layout, display, kind) {
  const source = prepareAspectLayout(layout, display);
  const posed = poseChannel({ [kind]: source, shortId: 'CUSTOM', custom: true }, kind, 0);
  const renderer = Object.create(Renderer.prototype);
  renderer.bounds = new Map();
  renderer.quad = () => {};
  renderer.display = display;
  renderer.draw(posed);
  return renderer.rect('Guide');
}

test('SVG style-guide example is self-contained and preserves both guide aspect assets', async () => {
  const prepared = await readCustomPackage(example);
  assert.equal(prepared.manifest.id, 'custom-style-guide-svg');
  assert.equal(prepared.audio, undefined);
  for (const kind of ['icon', 'banner']) {
    const layout = prepared.layouts[kind];
    assert.deepEqual(
      layout.textures.map(({ url, width, height }) => [url, width, height]),
      [
        [`${kind}-guide-16x9.svg`, 832, 456],
        [`${kind}-guide-4x3.svg`, 608, 456],
      ],
    );
    assert.equal(indexLayout(layout).panes.get('Guide').material, 0);
    for (const texture of layout.textures) {
      const metadata = inspectImageHeader(await readFile(join(example, texture.url)));
      assert.deepEqual([metadata.format, metadata.width, metadata.height], ['svg', texture.width, texture.height]);
    }
    assert.ok(prepared.files.has(`${kind}-guide-16x9.svg`));
    assert.ok(prepared.files.has(`${kind}-guide-4x3.svg`));
  }
});

test('visible guide texture fills the native 16:9 preview frame', async () => {
  const prepared = await readCustomPackage(example);
  const display = createDisplay('16:9');
  for (const kind of ['icon', 'banner']) {
    const rectangle = guideRectangle(prepared.layouts[kind], display, kind);
    assert.ok(rectangle);
    assert.ok(Math.abs(rectangle.x) < 1e-10);
    assert.ok(Math.abs(rectangle.w - display.width) < 1e-10);
    assert.ok(Math.abs(rectangle.h - display.height) < 1e-10);
  }
});

test('SVG preflight accepts viewBox dimensions and rejects executable content', () => {
  assert.deepEqual(
    inspectImageHeader(Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 12 9"></svg>')),
    { format: 'svg', extension: 'svg', width: 12, height: 9 },
  );
  assert.throws(
    () => inspectImageHeader(Buffer.from('<svg width="12" height="9"><script>alert(1)</script></svg>')),
    /local, static artwork/,
  );
});
