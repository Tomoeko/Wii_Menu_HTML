/** GIF87a/89a decoding for local channel artwork; no executable image content. */
const maximumFrames = 128;
const maximumDecodedBytes = 128 * 1024 * 1024;

function invalid(message) {
  throw new Error(`Invalid GIF: ${message}`);
}

function decodeIndices(bytes, minimumCodeSize, expected) {
  if (minimumCodeSize < 2 || minimumCodeSize > 8) invalid('unsupported LZW code size.');
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  const output = new Uint8Array(expected);
  for (let index = 0; index < clear; index++) suffix[index] = index;
  let bit = 0;
  let codeSize = minimumCodeSize + 1;
  let nextCode = end + 1;
  let previous = -1;
  let first = 0;
  let count = 0;
  let finished = false;
  while (bit + codeSize <= bytes.length * 8) {
    let code = 0;
    for (let index = 0; index < codeSize; index++, bit++) {
      code |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << index;
    }
    if (code === clear) {
      codeSize = minimumCodeSize + 1;
      nextCode = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) {
      finished = true;
      break;
    }
    const input = code;
    let length = 0;
    if (code === nextCode && previous >= 0) {
      stack[length++] = first;
      code = previous;
    } else if (code >= nextCode) invalid('LZW code refers to an unavailable dictionary entry.');
    while (code >= clear) {
      if (length >= stack.length || code >= nextCode) invalid('LZW dictionary cycle.');
      stack[length++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[length++] = first;
    if (count + length > expected) invalid('too many decoded pixels.');
    while (length) output[count++] = stack[--length];
    if (previous >= 0 && nextCode < 4096) {
      prefix[nextCode] = previous;
      suffix[nextCode] = first;
      nextCode++;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
    }
    previous = input;
  }
  if (!finished || count !== expected) invalid('truncated LZW pixels.');
  return output;
}

export function decodeGif(bytes) {
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    invalid('header is missing.');
  }
  let offset = 6;
  function requireBytes(count) {
    if (offset + count > bytes.length) invalid('truncated data.');
  }
  function byte() {
    requireBytes(1);
    return bytes[offset++];
  }
  function word() {
    requireBytes(2);
    const value = bytes.readUInt16LE(offset);
    offset += 2;
    return value;
  }
  function table(size) {
    requireBytes(size * 3);
    const colors = bytes.subarray(offset, offset + size * 3);
    offset += size * 3;
    return colors;
  }
  function blocks() {
    const chunks = [];
    for (let size = byte(); size; size = byte()) {
      requireBytes(size);
      chunks.push(bytes.subarray(offset, offset + size));
      offset += size;
    }
    return Buffer.concat(chunks);
  }
  const width = word();
  const height = word();
  if (!width || width > 4096 || !height || height > 4096) {
    invalid('dimensions must be from 1 to 4096.');
  }
  const packed = byte();
  const backgroundIndex = byte();
  byte(); // Pixel aspect ratio is advisory; uploaded artwork retains its pixel proportions.
  const globalColors = packed & 0x80 ? table(1 << ((packed & 7) + 1)) : null;
  const canvas = Buffer.alloc(width * height * 4);
  const frames = [];
  let repetitions = 1;
  let control = { disposal: 0, delay: 0, transparent: -1 };
  let ended = false;
  while (offset < bytes.length) {
    const marker = byte();
    if (marker === 0x3b) {
      ended = true;
      break;
    }
    if (marker === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        if (byte() !== 4) invalid('graphics control must contain four bytes.');
        const flags = byte();
        const delay = word();
        const transparent = byte();
        if (byte() !== 0) invalid('graphics control terminator is missing.');
        control = { disposal: (flags >> 2) & 7, delay, transparent: flags & 1 ? transparent : -1 };
        if (control.disposal > 3) invalid('unsupported disposal method.');
      } else if (label === 0xff) {
        const length = byte();
        requireBytes(length);
        const application = bytes.toString('ascii', offset, offset + length);
        offset += length;
        const data = blocks();
        if (['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(application)) {
          if (data.length !== 3 || data[0] !== 1) invalid('loop extension is damaged.');
          const repeats = data.readUInt16LE(1);
          repetitions = repeats === 0 ? 0 : repeats + 1;
        }
      } else if (label === 0xfe) blocks();
      else invalid('unsupported extension; convert this image to a standard GIF.');
      continue;
    }
    if (marker !== 0x2c) invalid('image descriptor is missing.');
    const left = word();
    const top = word();
    const frameWidth = word();
    const frameHeight = word();
    const flags = byte();
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) {
      invalid('frame extends outside the image.');
    }
    if (
      frames.length >= maximumFrames ||
      (frames.length + 1) * canvas.length > maximumDecodedBytes
    ) {
      invalid('animation exceeds 128 frames or 128 MiB of decoded pixels.');
    }
    const colors = flags & 0x80 ? table(1 << ((flags & 7) + 1)) : globalColors;
    if (!colors) invalid('color table is missing.');
    const codeSize = byte();
    const indices = decodeIndices(blocks(), codeSize, frameWidth * frameHeight);
    if (!frames.length && control.transparent < 0 && globalColors) {
      if (backgroundIndex * 3 + 2 >= globalColors.length)
        invalid('background is outside the color table.');
      for (let pixel = 0; pixel < canvas.length; pixel += 4) {
        canvas[pixel] = globalColors[backgroundIndex * 3];
        canvas[pixel + 1] = globalColors[backgroundIndex * 3 + 1];
        canvas[pixel + 2] = globalColors[backgroundIndex * 3 + 2];
        canvas[pixel + 3] = 255;
      }
    }
    const previous = control.disposal === 3 ? Buffer.from(canvas) : null;
    const rows = [];
    const passes =
      flags & 0x40
        ? [
            [0, 8],
            [4, 8],
            [2, 4],
            [1, 2],
          ]
        : [[0, 1]];
    for (const [start, step] of passes) {
      for (let row = start; row < frameHeight; row += step) rows.push(row);
    }
    let index = 0;
    for (const row of rows) {
      for (let column = 0; column < frameWidth; column++) {
        const color = indices[index++];
        if (color === control.transparent) continue;
        if (color * 3 + 2 >= colors.length) invalid('pixel is outside the color table.');
        const pixel = ((top + row) * width + left + column) * 4;
        canvas[pixel] = colors[color * 3];
        canvas[pixel + 1] = colors[color * 3 + 1];
        canvas[pixel + 2] = colors[color * 3 + 2];
        canvas[pixel + 3] = 255;
      }
    }
    // Zero-delay GIFs have no meaningful presentation time. Use one menu update,
    // while preserving every positive delay from the source (in centiseconds).
    frames.push({
      rgba: Buffer.from(canvas),
      durationMs: control.delay ? control.delay * 10 : 1000 / 60,
    });
    if (control.disposal === 2) {
      const opaqueBackground =
        control.transparent < 0 && globalColors && backgroundIndex * 3 + 2 < globalColors.length;
      for (let row = top; row < top + frameHeight; row++) {
        for (let column = left; column < left + frameWidth; column++) {
          const pixel = (row * width + column) * 4;
          for (let component = 0; component < 3; component++) {
            canvas[pixel + component] = opaqueBackground
              ? globalColors[backgroundIndex * 3 + component]
              : 0;
          }
          canvas[pixel + 3] = opaqueBackground ? 255 : 0;
        }
      }
    } else if (previous) previous.copy(canvas);
    control = { disposal: 0, delay: 0, transparent: -1 };
  }
  if (!ended || !frames.length || offset !== bytes.length) invalid('incomplete or trailing data.');
  return { width, height, frames, repetitions };
}
