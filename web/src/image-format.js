/** Shared upload preflight. Full PNG/GIF pixel validation belongs to the importer. */
function invalid(message) {
  throw new Error(message);
}

const text = (bytes) => String.fromCharCode(...bytes);

function jpegDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) invalid('Invalid JPEG header.');
  let offset = 2;
  let dimensions;
  let scan = false;
  let orientation = 1;
  let progressive = false;
  const components = new Map();
  const scanned = new Set();
  const quantization = new Set();
  const huffman = new Set();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid('Invalid JPEG marker.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!scan || !dimensions || scanned.size !== components.size || offset !== bytes.length)
        invalid('Incomplete JPEG image.');
      return orientation >= 5 && orientation <= 8 ? [dimensions[1], dimensions[0]] : dimensions;
    }
    if (marker === 0xd8 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) {
      invalid('Unexpected JPEG marker.');
    }
    if (offset + 2 > bytes.length) invalid('Truncated JPEG segment.');
    const length = view.getUint16(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) invalid('Truncated JPEG segment.');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8) invalid('Expected an 8-bit JPEG image.');
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      if (!width || !height || width > 4096 || height > 4096)
        invalid('JPEG dimensions must be from 1 to 4096.');
      if (dimensions) invalid('Multiple JPEG frames are unsupported.');
      dimensions = [width, height];
      progressive = marker === 0xc2;
      const count = bytes[offset + 7];
      if (![1, 3, 4].includes(count) || length !== 8 + 3 * count)
        invalid('Invalid JPEG frame components.');
      for (let index = 0; index < count; index++) {
        const position = offset + 8 + index * 3;
        const id = bytes[position];
        const horizontal = bytes[position + 1] >> 4;
        const vertical = bytes[position + 1] & 15;
        const table = bytes[position + 2];
        if (
          components.has(id) ||
          horizontal < 1 ||
          horizontal > 4 ||
          vertical < 1 ||
          vertical > 4 ||
          table > 3
        )
          invalid('Invalid JPEG frame component.');
        components.set(id, table);
      }
    }
    if (marker === 0xdb) {
      for (let position = offset + 2; position < end;) {
        const descriptor = bytes[position++];
        const precision = descriptor >> 4;
        const id = descriptor & 15;
        const size = 64 * (precision + 1);
        if (precision > 1 || id > 3 || position + size > end)
          invalid('Invalid JPEG quantization table.');
        quantization.add(id);
        position += size;
      }
    }
    if (marker === 0xc4) {
      for (let position = offset + 2; position < end;) {
        const descriptor = bytes[position++];
        const kind = descriptor >> 4;
        const id = descriptor & 15;
        if (kind > 1 || id > 3 || position + 16 > end) invalid('Invalid JPEG Huffman table.');
        let count = 0;
        let available = 1;
        for (let bits = 0; bits < 16; bits++) {
          const entries = bytes[position++];
          count += entries;
          available = available * 2 - entries;
          if (available < 0) invalid('Oversubscribed JPEG Huffman table.');
        }
        if (!count || count > 256 || position + count > end)
          invalid('Invalid JPEG Huffman symbols.');
        huffman.add(`${kind}:${id}`);
        position += count;
      }
    }
    if (marker === 0xda) {
      const count = bytes[offset + 2];
      if (!dimensions || !count || count > components.size || length !== 6 + 2 * count)
        invalid('Invalid JPEG scan components.');
      const spectralStart = bytes[end - 3];
      const spectralEnd = bytes[end - 2];
      const approximation = bytes[end - 1];
      if (
        (!progressive && (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0)) ||
        (progressive &&
          (spectralStart > spectralEnd ||
            spectralEnd > 63 ||
            (spectralStart === 0 && spectralEnd !== 0) ||
            (spectralStart > 0 && count !== 1) ||
            approximation >> 4 > 13 ||
            (approximation & 15) > 13))
      )
        invalid('Invalid JPEG spectral selection.');
      const selected = new Set();
      for (let index = 0; index < count; index++) {
        const position = offset + 3 + index * 2;
        const id = bytes[position];
        const tables = bytes[position + 1];
        if (!components.has(id) || selected.has(id) || !quantization.has(components.get(id)))
          invalid('JPEG scan references an unavailable component or quantization table.');
        if (
          (spectralStart === 0 && approximation >> 4 === 0 && !huffman.has(`0:${tables >> 4}`)) ||
          (spectralEnd > 0 && !huffman.has(`1:${tables & 15}`))
        )
          invalid('JPEG scan references an unavailable Huffman table.');
        selected.add(id);
        scanned.add(id);
      }
    }
    if (marker === 0xe1 && text(bytes.subarray(offset + 2, offset + 8)) === 'Exif\0\0') {
      const tiff = bytes.subarray(offset + 8, end);
      const tiffView = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
      if (tiff.length >= 8 && ['II', 'MM'].includes(text(tiff.subarray(0, 2)))) {
        const little = text(tiff.subarray(0, 2)) === 'II';
        const word = (position) => tiffView.getUint16(position, little);
        const long = (position) => tiffView.getUint32(position, little);
        const directory = long(4);
        if (word(2) === 42 && directory + 2 <= tiff.length) {
          const entries = word(directory);
          for (
            let index = 0;
            index < entries && directory + 14 + index * 12 <= tiff.length;
            index++
          ) {
            const entry = directory + 2 + index * 12;
            if (word(entry) === 0x112 && word(entry + 2) === 3 && long(entry + 4) === 1) {
              orientation = word(entry + 8);
            }
          }
        }
      }
    }
    offset = end;
    if (marker === 0xda) {
      scan = true;
      let entropyBytes = 0;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          entropyBytes++;
          offset++;
          continue;
        }
        let next = offset + 1;
        while (bytes[next] === 0xff) next++;
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) {
          if (bytes[next] === 0) entropyBytes++;
          offset = next + 1;
        } else break;
      }
      if (!entropyBytes) invalid('JPEG scan contains no entropy data.');
    }
  }
  invalid('JPEG image ending is missing.');
}

export function inspectImageHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format;
  let extension;
  let width;
  let height;
  if (
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  ) {
    if (view.getUint32(8) !== 13 || text(bytes.subarray(12, 16)) !== 'IHDR')
      invalid('Invalid PNG header.');
    format = extension = 'png';
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(text(bytes.subarray(0, 6)))) {
    format = extension = 'gif';
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (bytes.length >= 2 && view.getUint16(0) === 0xffd8) {
    format = 'jpeg';
    extension = 'jpg';
    [width, height] = jpegDimensions(bytes);
  } else invalid('Artwork must be a PNG, JPEG, or GIF image.');
  if (!width || !height || width > 4096 || height > 4096) {
    invalid('Image dimensions must be from 1 to 4096.');
  }
  return { format, extension, width, height };
}
