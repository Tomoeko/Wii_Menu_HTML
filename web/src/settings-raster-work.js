/** A raster worker can be slower than pointer events. Keep one current job and
 * one replaceable pending job, never an unbounded queue of obsolete hovers. */
export function createLatestRasterQueue(run, onError = () => {}) {
  let pending = null,
    running = false;
  const stats = { submitted: 0, processed: 0, coalesced: 0, pending: 0 };
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const job = pending;
        pending = null;
        stats.pending = 0;
        try {
          await run(job);
          stats.processed++;
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    submit(job) {
      stats.submitted++;
      if (pending) stats.coalesced++;
      pending = job;
      stats.pending = 1;
      void drain();
    },
    clear() {
      pending = null;
      stats.pending = 0;
    },
    snapshot: () => ({ ...stats, running }),
  };
}

const SNAPSHOT_TAGS = new RegExp([
  /<!--[\s\S]*?-->/.source,
  /<!\[CDATA\[[\s\S]*?\]\]>/.source,
  /<\?[\s\S]*?\?>/.source,
  /<[A-Za-z][\w:.-]*(?:"[^"]*"|'[^']*'|[^'">])*>/.source,
].join('|'), 'g');
const CSS_QUOTED_URL = /"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'/.source;
const CSS_UNQUOTED_URL = /((?:\\[\s\S]|[^)'"\\])*)/.source;
const CSS_RESOURCE_TOKENS = new RegExp([
  /\/\*[\s\S]*?\*\//.source,
  /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/.source,
  String.raw`\burl\(\s*(?:${CSS_QUOTED_URL}|${CSS_UNQUOTED_URL})\s*\)`,
].join('|'), 'gi');
const SNAPSHOT_ATTRIBUTES = /(\s)([\w:.-]+)(\s*=\s*)(["'])([\s\S]*?)\4/g;

// Snapshots are XMLSerializer output. Consume complete tags and quoted values
// so attribute-looking page text and strings inside other attributes stay inert.
function snapshotResourceAttributes(markup) {
  const attributes = [];
  for (const tag of markup.matchAll(SNAPSHOT_TAGS)) {
    if (!/^<[A-Za-z]/.test(tag[0])) continue;
    for (const attribute of tag[0].matchAll(SNAPSHOT_ATTRIBUTES)) {
      const name = attribute[2].toLowerCase();
      if (name !== 'src' && name !== 'style') continue;
      const quote = attribute[4];
      const value = attribute[5];
      const end = tag.index + attribute.index + attribute[0].length - 1;
      attributes.push({ name, quote, value, original: value, start: end - value.length, end });
    }
  }
  return attributes;
}

function decodeXmlAttribute(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  return value.replace(/&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()];
    const code = name[1].toLowerCase() === 'x' ?
      Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  });
}

function encodeXmlAttribute(value, quote) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll(quote, quote === '"' ? '&quot;' : '&apos;');
}

function decodeCssEscapes(value) {
  return value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|(\r\n|[\n\r\f])|(.))/gi,
    (_, hex, newline, escaped) => {
      if (newline) return '';
      if (!hex) return escaped;
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ?
        String.fromCodePoint(code) : '\ufffd';
    });
}

function mapCssResourceUrls(style, transform) {
  // Strings and comments are tokens too: content:"url(a)" is literal CSS text.
  // A URL may contain escaped quotes, parentheses, whitespace or hex escapes.
  const replaceToken = (token, doubleQuoted, singleQuoted, unquoted, offset) => {
    if (!/^url\(/i.test(token) || /[\w-]/.test(style[offset - 1] || '')) return token;
    // Whitespace following an odd run of backslashes belongs to an unquoted
    // URL. Trimming it would turn an escaped filename character into syntax.
    let end = unquoted?.length ?? 0;
    while (end > 0 && /\s/.test(unquoted[end - 1])) {
      let slash = end - 2;
      while (slash >= 0 && unquoted[slash] === '\\') slash--;
      if ((end - 2 - slash) % 2) break;
      end--;
    }
    const source = doubleQuoted ?? singleQuoted ?? unquoted.slice(0, end).trimStart();
    const url = decodeCssEscapes(source);
    if (/^data:/i.test(url)) return token;
    const replacement = transform(url);
    if (replacement === undefined) return token;
    const escaped = replacement.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `url("${escaped}")`;
  };
  return style.replace(CSS_RESOURCE_TOKENS, replaceToken);
}

/** The exported font stylesheet maps many legacy family names to two files.
 * Give each physical face one internal name so a 2.6MB font is embedded once,
 * without changing its glyphs, metrics, weight or original fallback order. */
export function createSettingsResourceEmbedder(fontCss, resource) {
  const aliases = new Map(),
    faces = new Map(),
    fontBlocks = new Map();
  for (const [face] of fontCss.matchAll(/@font-face\s*\{[^}]+\}/g)) {
    const family = face.match(/font-family:\s*["']?([^"';]+)["']?/)?.[1]?.trim();
    const url = face.match(/url\(["']?([^"')]+)["']?\)/)?.[1]?.trim();
    if (!family || !url) continue;
    if (!faces.has(url)) faces.set(url, { name: `WiiRasterFont${faces.size}`, url });
    const normalized = family.toLowerCase();
    if (aliases.has(normalized) && aliases.get(normalized).url !== url) {
      throw new Error('An original Settings font family maps to conflicting files.');
    }
    aliases.set(normalized, faces.get(url));
  }
  if (!faces.size) {
    throw new Error('No original Settings font faces were found. Prepare the assets again.');
  }
  return async (markup) => {
    const used = new Set();
    const urls = new Set();
    const replaceFamily = (_, prefix, value) => {
      const families = decodeXmlAttribute(value)
        .split(',')
        .map((family) => family.trim().replace(/^["']|["']$/g, ''));
      const renamed = families.map((family) => {
        const face = aliases.get(family.toLowerCase());
        if (face) {
          used.add(face);
          return face.name;
        }
        return /\s/.test(family) ? `&quot;${family}&quot;` : family;
      });
      return `${prefix}font-family:${[...new Set(renamed)].join(',')};`;
    };
    // Work only inside serialized style attributes. A nickname or other page
    // text containing "font-family:...;" must remain literal user text.
    const attributes = snapshotResourceAttributes(markup);
    for (const attribute of attributes) {
      const { name, value } = attribute;
      if (name === 'src') {
        const url = decodeXmlAttribute(value);
        if (!/^data:/i.test(url)) urls.add(url);
      }
      if (name !== 'style') continue;
      attribute.value = value.replace(
        /(^|;)\s*font-family\s*:\s*((?:&(?:quot|amp|#39);|[^;])+);/gi,
        replaceFamily,
      );
      attribute.hasResourceUrls = /url\(/i.test(attribute.value);
      if (attribute.hasResourceUrls) {
        mapCssResourceUrls(decodeXmlAttribute(attribute.value), (url) => { urls.add(url); });
      }
    }
    const faceList = [...used].sort((a, b) => a.name.localeCompare(b.name));
    const key = faceList.map((face) => face.name).join(',');
    if (!fontBlocks.has(key)) {
      const pending = Promise.all(
        faceList.map(
          async (face) =>
            `@font-face{font-family:${face.name};src:url("${await resource(face.url)}") format("truetype");font-weight:normal;font-style:normal;}`,
        ),
      )
        .then((faces) => `<style xmlns="http://www.w3.org/1999/xhtml">${faces.join('')}</style>`)
        .catch((error) => {
          if (fontBlocks.get(key) === pending) fontBlocks.delete(key);
          throw error;
        });
      fontBlocks.set(key, pending);
    }
    const [fontBlock, resolvedEntries] = await Promise.all([
      fontBlocks.get(key),
      Promise.all(
        [...urls].map(async (url) => [url, await resource(url)]),
      ),
    ]);
    const resolved = new Map(resolvedEntries);
    const pieces = [];
    let cursor = 0;
    for (const attribute of attributes) {
      const { name, quote, value, hasResourceUrls } = attribute;
      if (name === 'src' || hasResourceUrls) {
        const decoded = decodeXmlAttribute(value);
        const replacement = name === 'style' ?
          mapCssResourceUrls(decoded, (url) => resolved.get(url)) : resolved.get(decoded);
        if (replacement !== undefined && replacement !== decoded) {
          attribute.value = encodeXmlAttribute(replacement, quote);
        }
      }
      if (attribute.value === attribute.original) continue;
      pieces.push(markup.slice(cursor, attribute.start), attribute.value);
      cursor = attribute.end;
    }
    pieces.push(markup.slice(cursor));
    return fontBlock + pieces.join('');
  };
}

/** Build a replacement overlay without needing the pixels behind the original
 * image. An unchanged pixel stays in the base raster. A changed pixel is safe
 * when its old image contribution was empty or its replacement fully covers it.
 * Other translucent changes require a complete document raster. */
export function settingsImageReplacement(original, replacement) {
  if (original.length !== replacement.length || original.length % 4 !== 0) return null;
  const patch = new Uint8ClampedArray(original.length);
  for (let i = 0; i < original.length; i += 4) {
    if (
      original[i] === replacement[i] &&
      original[i + 1] === replacement[i + 1] &&
      original[i + 2] === replacement[i + 2] &&
      original[i + 3] === replacement[i + 3]
    )
      continue;
    if (original[i + 3] !== 0 && replacement[i + 3] !== 255) return null;
    patch.set(replacement.subarray(i, i + 4), i);
  }
  return patch;
}

/**
 * Convert a Settings image's CSS geometry into the enhanced raster's pixel
 * geometry. Fractional samples cannot be patched safely because the SVG
 * foreignObject renderer may distribute them across neighbouring pixels.
 */
export function settingsFastImageGeometry(item, rasterScale = 1) {
  if (!Number.isInteger(rasterScale) || rasterScale < 1) return null;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(item?.[key]));
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values.map((value) => value * rasterScale);
  if (![x, y, width, height].every(Number.isInteger) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
