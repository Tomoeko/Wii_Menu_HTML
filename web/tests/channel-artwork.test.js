import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createChannelManager } from '../../tools/channel-manager.mjs';
import { decodeGif } from '../../tools/gif-image.mjs';
import { imageMetadata, encodeRgbaPng } from '../../tools/channel-image.mjs';
import { readCustomPackage } from '../../tools/custom-channels.mjs';
import { indexLayout } from '../src/animation.js';
import { imageFrameTexture } from '../src/channel-artwork.js';
import { poseChannel } from '../src/channel-animation.js';
import { createDisplay, prepareAspectLayout } from '../src/display.js';
import { inspectImageHeader } from '../src/image-format.js';
import { Renderer } from '../src/renderer.js';

// Original 8×8 alternating red/green artwork, encoded independently with Pillow.
// Its compressed stream exercises dictionary reuse and variable-width codes.
const gif = Buffer.from(
  'R0lGODlhCAAIAIEAAP8AAAD/AAAAAAAAACH/C05FVFNDQVBFMi4wAwEBAAAh+QQABwAAACwAAAAACAAIAAAIFAABBBBIcKDBgggPKkzIcKHDhgEBACH5BAENAAIALAAAAAAIAAgAgf8AAAD/AAAAAAAAAAgUAAMAEEhwoMGCCA8qTMhwocOGAQEAOw==',
  'base64',
);

// Original solid orange 3×2 JPEG, independently encoded for format tests.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDTooor8/PtD//Z',
  'base64',
);

function tinyGif(frames, { width = 2, height = 1, loop = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.write('GIF89a');
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  header[10] = 0x81;
  const parts = [header, Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0])];
  if (loop !== null) {
    parts.push(Buffer.from([0x21, 0xff, 11]), Buffer.from('NETSCAPE2.0'));
    parts.push(Buffer.from([3, 1, loop & 255, loop >> 8, 0]));
  }
  for (const {
    pixels,
    left = 0,
    top = 0,
    w = width,
    h = height,
    disposal = 1,
    transparent = -1,
    interlaced = false,
  } of frames) {
    parts.push(
      Buffer.from([
        0x21,
        0xf9,
        4,
        (disposal << 2) | (transparent >= 0 ? 1 : 0),
        5,
        0,
        Math.max(0, transparent),
        0,
      ]),
    );
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(left, 1);
    descriptor.writeUInt16LE(top, 3);
    descriptor.writeUInt16LE(w, 5);
    descriptor.writeUInt16LE(h, 7);
    descriptor[9] = interlaced ? 0x40 : 0;
    const codes = pixels.flatMap((pixel) => [4, pixel]).concat(5);
    const bytes = Buffer.alloc(Math.ceil((codes.length * 3) / 8));
    codes.forEach((code, index) => {
      const bit = index * 3;
      bytes[bit >> 3] |= code << (bit & 7);
      if ((bit & 7) > 5) bytes[(bit >> 3) + 1] |= code >> (8 - (bit & 7));
    });
    parts.push(descriptor, Buffer.from([2, bytes.length]), bytes, Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

const colors = (frame) =>
  Array.from({ length: frame.rgba.length / 4 }, (_, index) => [
    ...frame.rgba.subarray(index * 4, index * 4 + 4),
  ]);
const red = [255, 0, 0, 255];
const green = [0, 255, 0, 255];
const blue = [0, 0, 255, 255];
const clear = [0, 0, 0, 0];

test('GIF decoder preserves independent encoder pixels, centisecond delays and repeat count', () => {
  const decoded = decodeGif(gif);
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 8);
  assert.equal(decoded.repetitions, 2);
  assert.deepEqual(
    decoded.frames.map((frame) => frame.durationMs),
    [70, 130],
  );
  assert.deepEqual(
    colors(decoded.frames[0]),
    Array.from({ length: 64 }, (_, i) => (i % 2 ? green : red)),
  );
  assert.deepEqual(
    colors(decoded.frames[1]),
    Array.from({ length: 64 }, (_, i) => (i % 2 ? red : green)),
  );
});

test('GIF compositor applies transparency, subrectangles and restore-previous disposal', () => {
  const decoded = decodeGif(
    tinyGif([
      { pixels: [0, 0] },
      { pixels: [1], left: 1, w: 1, disposal: 3 },
      { pixels: [2, 3], transparent: 3 },
    ]),
  );
  assert.deepEqual(colors(decoded.frames[1]), [red, green]);
  assert.deepEqual(colors(decoded.frames[2]), [blue, red]);
  assert.equal(decoded.repetitions, 0);
  const background = decodeGif(
    tinyGif(
      [
        { pixels: [0, 0], transparent: 3 },
        { pixels: [1], left: 1, w: 1, disposal: 2, transparent: 3 },
        { pixels: [3, 3], transparent: 3 },
      ],
      { loop: null },
    ),
  );
  assert.deepEqual(colors(background.frames[2]), [red, clear]);
  assert.equal(background.repetitions, 1);
});

test('GIF interlacing restores row order and damaged/oversized streams are rejected', () => {
  const decoded = decodeGif(
    tinyGif([{ pixels: [0, 2, 1, 3], interlaced: true }], { width: 1, height: 4 }),
  );
  assert.deepEqual(colors(decoded.frames[0]), [red, green, blue, [0, 0, 0, 255]]);
  assert.throws(() => decodeGif(gif.subarray(0, -2)), /Invalid GIF/);
  assert.throws(() => decodeGif(tinyGif([{ pixels: [0], left: 2, w: 1 }])), /outside/);
  assert.throws(
    () => decodeGif(tinyGif(Array.from({ length: 129 }, () => ({ pixels: [0, 1] })))),
    /128 frames/,
  );
  const broken = tinyGif([{ pixels: [0, 1] }]);
  broken[broken.length - 4] = 0xff;
  assert.throws(() => decodeGif(broken), /LZW/);
});

test('image header preflight and full PNG validation preserve safe formats and dimensions', () => {
  const png = encodeRgbaPng(2, 1, Buffer.from([...red, ...green]));
  assert.deepEqual(inspectImageHeader(png), {
    format: 'png',
    extension: 'png',
    width: 2,
    height: 1,
  });
  assert.deepEqual(imageMetadata(png), inspectImageHeader(png));
  assert.deepEqual(inspectImageHeader(gif), {
    format: 'gif',
    extension: 'gif',
    width: 8,
    height: 8,
  });
  const broken = Buffer.from(png);
  broken[broken.length - 5] ^= 1;
  assert.throws(() => imageMetadata(broken), /checksum/);
});

test('JPEG preflight supports bounded scans, EXIF display orientation and malformed segment rejection', () => {
  assert.deepEqual(inspectImageHeader(jpeg), {
    format: 'jpeg',
    extension: 'jpg',
    width: 3,
    height: 2,
  });
  assert.deepEqual(imageMetadata(jpeg), inspectImageHeader(jpeg));
  const exif = Buffer.alloc(36);
  exif.writeUInt16BE(0xffe1, 0);
  exif.writeUInt16BE(34, 2);
  exif.write('Exif', 4);
  exif.write('II', 10);
  exif.writeUInt16LE(42, 12);
  exif.writeUInt32LE(8, 14);
  exif.writeUInt16LE(1, 18);
  exif.writeUInt16LE(0x112, 20);
  exif.writeUInt16LE(3, 22);
  exif.writeUInt32LE(1, 24);
  exif.writeUInt16LE(6, 28);
  const rotated = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  assert.deepEqual(inspectImageHeader(rotated), {
    format: 'jpeg',
    extension: 'jpg',
    width: 2,
    height: 3,
  });
  const invalidOrientation = Buffer.from(rotated);
  invalidOrientation.writeUInt16LE(9, 30);
  assert.deepEqual(inspectImageHeader(invalidOrientation), {
    format: 'jpeg',
    extension: 'jpg',
    width: 3,
    height: 2,
  });
  const invalidTiff = Buffer.from(rotated);
  invalidTiff.writeUInt16LE(43, 14);
  assert.deepEqual(inspectImageHeader(invalidTiff), {
    format: 'jpeg',
    extension: 'jpg',
    width: 3,
    height: 2,
  });
  assert.throws(() => inspectImageHeader(jpeg.subarray(0, -2)), /ending/);
  assert.throws(
    () => inspectImageHeader(Buffer.from('ffd8ffc00008080001000100ffda0002ffd9', 'hex')),
    /frame components/,
  );
  const broken = Buffer.from(jpeg);
  broken.writeUInt16BE(65535, 4);
  assert.throws(() => inspectImageHeader(broken), /Truncated JPEG/);
});

test('GIF frame clocks preserve boundary timing, repeat counts and replay from zero', () => {
  const animation = {
    repetitions: 2,
    frames: [
      { texture: 3, durationMs: 70 },
      { texture: 4, durationMs: 130 },
    ],
  };
  assert.equal(imageFrameTexture(animation, 4), 3);
  assert.equal(imageFrameTexture(animation, 5), 4);
  assert.equal(imageFrameTexture(animation, 12), 3);
  assert.equal(imageFrameTexture(animation, 24), 4);
  assert.equal(imageFrameTexture(animation, 1000), 4);
  assert.equal(imageFrameTexture(animation, 0), 3);
  assert.equal(imageFrameTexture({ ...animation, repetitions: 0 }, 24), 3);
});

async function managerFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wii-artwork-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    assets: join(directory, 'assets'),
    localDirectory: join(directory, '.local'),
    configFile: join(directory, 'config.json'),
    layoutFile: join(directory, 'layout.json'),
  };
  await mkdir(paths.assets);
  await writeFile(paths.configFile, '{}\n');
  return { manager: createChannelManager(paths), paths };
}

test('uploads occupy stationary aspect-preserving surfaces while GIF pixels animate in production poses', async (t) => {
  const { manager, paths } = await managerFixture(t);
  const png = encodeRgbaPng(2, 1, Buffer.from([...red, ...green]));
  const created = await manager.create({
    title: 'Picture',
    icon: { base64: png.toString('base64') },
    banner: { base64: gif.toString('base64') },
    audio: { kind: 'none' },
  });
  const prepared = await readCustomPackage(
    join(paths.localDirectory, 'custom-channels', created.channel.id),
  );
  assert.ok(
    (
      await readFile(
        join(paths.localDirectory, 'custom-channels', created.channel.id, 'banner.gif'),
      )
    ).equals(gif),
  );
  for (const aspect of ['4:3', '16:9']) {
    const display = createDisplay(aspect);
    for (const kind of ['icon', 'banner']) {
      const source = prepareAspectLayout(prepared.layouts[kind], display);
      const first = poseChannel({ [kind]: source }, kind, 0);
      const later = poseChannel({ [kind]: source }, kind, 90);
      const panes = indexLayout(first).panes;
      assert.equal(panes.get('Content').flags & 1, 0);
      assert.deepEqual(panes.get('Artwork'), indexLayout(later).panes.get('Artwork'));
      const renderer = Object.create(Renderer.prototype);
      renderer.bounds = new Map();
      renderer.quad = () => {};
      renderer.display = display;
      renderer.draw(first);
      const rectangle = renderer.rect('Artwork');
      const displayedAspect =
        (rectangle.w * display.outputAspect * display.height) / display.width / rectangle.h;
      assert.ok(Math.abs(displayedAspect - source.artwork.width / source.artwork.height) < 1e-10);
      assert.ok(
        rectangle.w <= (kind === 'icon' ? display.thumbnailHalfWidth * 2 : display.width) + 1e-10,
      );
      assert.ok(rectangle.h <= (kind === 'icon' ? 96 : display.height) + 1e-10);
    }
  }
  const banner = prepared.layouts.banner;
  const atZero = poseChannel({ banner }, 'banner', 0);
  const atFive = poseChannel({ banner }, 'banner', 5);
  assert.equal(atZero.materials.at(-1).textureMaps[0].texture, 0);
  assert.equal(atFive.materials.at(-1).textureMaps[0].texture, 1);
  assert.equal(banner.materials.at(-1).textureMaps[0].texture, 0);
});

test('JPEG files stay editable and install without conversion or filename ambiguity', async (t) => {
  const { manager, paths } = await managerFixture(t);
  const created = await manager.create({
    title: 'JPEG Picture',
    icon: { base64: jpeg.toString('base64') },
    audio: { kind: 'none' },
  });
  const source = join(paths.localDirectory, 'custom-channels', created.channel.id);
  assert.ok((await readFile(join(source, 'icon.jpg'))).equals(jpeg));
  const prepared = await readCustomPackage(source);
  assert.deepEqual(prepared.layouts.icon.textures[0], {
    name: 'icon-artwork',
    url: 'icon.jpg',
    width: 3,
    height: 2,
  });
  const catalog = JSON.parse(await readFile(join(paths.assets, 'custom-channels.json')));
  const installed = JSON.parse(await readFile(join(paths.assets, catalog.channels[0].iconLayout)));
  assert.ok((await readFile(join(paths.assets, installed.textures[0].url))).equals(jpeg));
});
