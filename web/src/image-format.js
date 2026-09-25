/** Shared upload preflight. Full PNG/GIF pixel validation belongs to the importer. */
function invalid(message) {
  throw new Error(message);
}

const text = (bytes) => String.fromCharCode(...bytes);

function svgLength(value) {
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value.trim());
  if (!match) return null;
  const length = Number(match[1]);
  return Number.isFinite(length) && length > 0 ? length : null;
}

const SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc',
]);
const SVG_ATTRIBUTES = new Set([
  'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'viewBox', 'preserveAspectRatio', 'd', 'points', 'dx', 'dy',
  'transform', 'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
  'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'paint-order',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
  'xmlns',
]);
const XML_ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g;

function validXmlEntities(value) {
  return !value.replace(XML_ENTITY, '').includes('&');
}

/** Parse the small static drawing vocabulary used by local channel artwork.
 * A closed vocabulary is safer than trying to blacklist every SVG feature that
 * can run code, navigate, or fetch a resource when the file is opened directly. */
function staticSvgRoot(source) {
  let position = 0;
  if (source.charCodeAt(0) === 0xfeff) position++;
  const declaration = /^<\?xml\s+version=(['"])1\.0\1(?:\s+encoding=(['"])UTF-8\2)?\s*\?>/i
    .exec(source.slice(position));
  if (declaration) position += declaration[0].length;
  const stack = [];
  let root = null;
  while (position < source.length) {
    const nextTag = source.indexOf('<', position);
    const textEnd = nextTag < 0 ? source.length : nextTag;
    const content = source.slice(position, textEnd);
    if (!validXmlEntities(content) || (!stack.length && content.trim())) {
      invalid('SVG images must contain only local, static artwork.');
    }
    position = textEnd;
    if (nextTag < 0) break;
    const closing = /^<\/([A-Za-z][A-Za-z0-9]*)\s*>/.exec(source.slice(position));
    if (closing) {
      if (stack.pop() !== closing[1]) invalid('Invalid SVG image.');
      position += closing[0].length;
      continue;
    }
    const opening = /^<([A-Za-z][A-Za-z0-9]*)([^<>]*?)>/.exec(source.slice(position));
    if (!opening || !SVG_ELEMENTS.has(opening[1]) || (!stack.length && root)) {
      invalid('SVG images must contain only local, static artwork.');
    }
    if (!root && opening[1] !== 'svg') invalid('Invalid SVG image.');
    const name = opening[1];
    const selfClosing = /\/\s*$/.test(opening[2]);
    const attributeSource = selfClosing ? opening[2].replace(/\/\s*$/, '') : opening[2];
    const attributeLength = attributeSource.trimEnd().length;
    const attributes = new Map();
    const attribute = /\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
    let offset = 0;
    while (offset < attributeLength) {
      attribute.lastIndex = offset;
      const match = attribute.exec(attributeSource);
      if (!match || !SVG_ATTRIBUTES.has(match[1]) || attributes.has(match[1])) {
        invalid('SVG images must contain only local, static artwork.');
      }
      const value = match[2] ?? match[3];
      // No entity references in attributes: encoded CSS URL functions must
      // not evade the resource check after XML decoding in a browser.
      if (value.includes('&') || /[\\\x00-\x1f]|url\s*\(/i.test(value) ||
          (match[1] === 'xmlns' && (name !== 'svg' || value !== 'http://www.w3.org/2000/svg'))) {
        invalid('SVG images must contain only local, static artwork.');
      }
      attributes.set(match[1], value);
      offset = attribute.lastIndex;
    }
    if (!root) root = attributes;
    if (!selfClosing) stack.push(name);
    position += opening[0].length;
  }
  if (!root || stack.length || !/<\/svg>\s*$/.test(source)) invalid('Invalid SVG image.');
  return root;
}

/** Read dimensions from a static, same-file SVG without executing its markup. */
function svgDimensions(bytes) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid('Invalid SVG image encoding.');
  }
  const root = staticSvgRoot(source);
  const viewBox = root.get('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = svgLength(root.get('width') ?? '') ?? viewBox?.[2];
  const height = svgLength(root.get('height') ?? '') ?? viewBox?.[3];
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    (viewBox &&
      (viewBox.length !== 4 ||
        !viewBox.every(Number.isFinite) ||
        viewBox[2] <= 0 ||
        viewBox[3] <= 0))
  ) {
    invalid('SVG images must have valid dimensions from 1 to 4096.');
  }
  return [Math.round(width), Math.round(height)];
}

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
  } else if (/^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text(bytes.subarray(0, 1024)))) {
    format = extension = 'svg';
    [width, height] = svgDimensions(bytes);
  } else invalid('Artwork must be a PNG, JPEG, GIF, or SVG image.');
  if (!width || !height || width > 4096 || height > 4096) {
    invalid('Image dimensions must be from 1 to 4096.');
  }
  return { format, extension, width, height };
}
