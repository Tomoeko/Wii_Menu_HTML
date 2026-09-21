import { deflateSync, inflateSync } from 'node:zlib';
import { decodeGif } from './gif-image.mjs';
import { inspectImageHeader } from '../web/src/image-format.js';

function invalid(message) {
  throw new Error(message);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Check compressed image data before publishing it as a browser texture. */
export function pngDimensions(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    invalid('Artwork must be a PNG, JPEG, or GIF image.');
  }
  let header;
  let ended = false;
  let palette = false;
  const data = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) invalid('Truncated PNG image.');
    const length = bytes.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > bytes.length) invalid('Truncated PNG chunk.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      invalid('PNG image checksum is invalid.');
    }
    if (!header && type !== 'IHDR') invalid('PNG image header is missing.');
    if (type === 'IHDR') {
      if (header || length !== 13) invalid('Invalid PNG image header.');
      header = bytes.subarray(offset + 8, end - 4);
    } else if (type === 'IDAT') data.push(bytes.subarray(offset + 8, end - 4));
    else if (type === 'PLTE') palette = length > 0 && length <= 768 && length % 3 === 0;
    else if (type === 'IEND') {
      if (length || end !== bytes.length) invalid('Invalid PNG image ending.');
      ended = true;
    } else if (!/^[a-z]/.test(type) && !['cHRM', 'gAMA', 'sRGB', 'iCCP'].includes(type)) {
      invalid('Unsupported critical PNG chunk.');
    }
    offset = end;
  }
  if (!header || !ended || !data.length) invalid('Incomplete PNG image.');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const color = header[9];
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (
    width < 1 ||
    width > 4096 ||
    height < 1 ||
    height > 4096 ||
    !depths[color]?.includes(depth) ||
    header[10] !== 0 ||
    header[11] !== 0 ||
    header[12] > 1 ||
    (color === 3 && !palette)
  )
    invalid('PNG images must have valid pixels and dimensions from 1 to 4096.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const passes =
    header[12] === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  const rows = [];
  for (const [x, y, stepX, stepY] of passes) {
    const columns = Math.max(0, Math.ceil((width - x) / stepX));
    const count = Math.max(0, Math.ceil((height - y) / stepY));
    if (columns) {
      for (let row = 0; row < count; row++)
        rows.push(1 + Math.ceil((columns * channels * depth) / 8));
    }
  }
  const expected = rows.reduce((sum, length) => sum + length, 0);
  let pixels;
  try {
    pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  } catch {
    invalid('PNG pixel data is damaged.');
  }
  if (pixels.length !== expected) invalid('PNG pixel data has the wrong length.');
  let offset = 0;
  for (const length of rows) {
    if (pixels[offset] > 4) invalid('PNG image uses an invalid row filter.');
    offset += length;
  }
  return [width, height];
}

export function imageMetadata(bytes, { decode = true } = {}) {
  const metadata = inspectImageHeader(bytes);
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature === '89504e470d0a1a0a') {
    const [width, height] = pngDimensions(bytes);
    return { format: 'png', extension: 'png', width, height };
  }
  if (bytes.length >= 2 && bytes.readUInt16BE(0) === 0xffd8) {
    return metadata;
  }
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    const decoded = decodeGif(bytes);
    return {
      format: 'gif',
      extension: 'gif',
      width: decoded.width,
      height: decoded.height,
      ...(decode ? { decoded } : {}),
    };
  }
  invalid('Artwork must be a PNG, JPEG, or GIF image.');
}

function pngChunk(type, bytes) {
  const chunk = Buffer.alloc(bytes.length + 12);
  chunk.writeUInt32BE(bytes.length, 0);
  chunk.write(type, 4);
  bytes.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

/** Encode composited GIF pixels with Node's bundled zlib; no image package. */
export function encodeRgbaPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) invalid('RGBA pixel dimensions do not match.');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowBytes = width * 4;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row++) {
    rgba.copy(scanlines, row * (rowBytes + 1) + 1, row * rowBytes, (row + 1) * rowBytes);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
