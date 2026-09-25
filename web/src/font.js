import { keyboardCaretWidth } from './keyboard-caret.js';

const WHITE = [255, 255, 255, 255];
// BRFNT stores the same keycap shape in its private-use range; expose it
// through the standard Unicode marker used by the phone editor state.
const SPACE_MARKER = 0x2423;
const NATIVE_SPACE_MARKER = 0xe057;
/** Uses the original BRFNT glyph atlas and per-character advance widths. */
export class BitmapFont {
  constructor(font, renderer) {
    this.font = font;
    this.renderer = renderer;
    this.layout = {
      textures: font.sheets,
      materials: font.sheets.map((sheet, i) => ({
        name: 'font',
        colors: [[0, 0, 0, 0], WHITE, WHITE],
        textureMaps: [{ texture: i, wrapS: 0, wrapT: 0 }],
        textureSRTs: [],
        // CharWriter::SetupGX (4.3U, 0x81517070): I4/I8 glyphs keep
        // vertex RGB and multiply only alpha by the texture's coverage.
        glyphAlphaOnly: sheet.format === 0 || sheet.format === 1,
      })),
    };
  }
  async load() {
    await this.renderer.load(this.layout);
  }
  scale(size) {
    return Array.isArray(size)
      ? [size[0] / this.font.width, size[1] / this.font.height]
      : [size / this.font.height, size / this.font.height];
  }
  width(text, size, spacing = 0) {
    const sx = this.scale(size)[0];
    return [...text].reduce(
      (sum, c, i) => sum + (this.glyph(c)?.advance || 0) * sx + (i ? spacing : 0),
      0,
    );
  }
  glyph(c) {
    const codePoint = c.codePointAt(0);
    const index = this.font.characters[codePoint] ??
      (codePoint === SPACE_MARKER ? this.font.characters[NATIVE_SPACE_MARKER] : undefined);
    return this.font.glyphs[index ?? this.font.defaultGlyph];
  }
  draw(
    text,
    x,
    y,
    size = 22,
    {
      color = [100, 100, 100, 255],
      bottomColor = color,
      align = 'center',
      matrix = [1, 0, 0, 1, 0, 0],
      spacing = 0,
      alpha = 1,
      colorMapping,
      colorRanges = [],
      textOffset = 0,
    } = {},
  ) {
    const [sx, sy] = this.scale(size),
      w = this.width(text, size, spacing);
    const layout = colorMapping
      ? {
          ...this.layout,
          materials: this.layout.materials.map((material) => ({
            ...material,
            colors: [...colorMapping, WHITE],
            glyphAlphaOnly:
              material.glyphAlphaOnly &&
              colorMapping[0].every((value) => value === 0) &&
              colorMapping[1].every((value) => value === 255),
          })),
        }
      : this.layout;
    let cursor = x - (align === 'center' ? w / 2 : align === 'right' ? w : 0);
    let textIndex = textOffset;
    for (const c of text) {
      const range = colorRanges.find((range) => textIndex >= range.start && textIndex < range.end);
      textIndex += c.length;
      const glyph = this.glyph(c);
      if (!glyph) continue;
      const sheet = this.font.sheets[glyph.sheet];
      if (glyph.width) {
        const pane = {
          origin: 0,
          size: [glyph.width * sx, glyph.height * sy],
          material: glyph.sheet,
          vertexColors: range
            ? [range.color, range.color, range.color, range.color]
            : [color, color, bottomColor, bottomColor],
          texCoords: [
            [
              [glyph.x / sheet.width, glyph.y / sheet.height],
              [(glyph.x + glyph.width) / sheet.width, glyph.y / sheet.height],
              [glyph.x / sheet.width, (glyph.y + glyph.height) / sheet.height],
              [(glyph.x + glyph.width) / sheet.width, (glyph.y + glyph.height) / sheet.height],
            ],
          ],
        };
        const m = multiply(matrix, [1, 0, 0, 1, cursor + glyph.left * sx, y]);
        this.renderer.quad(layout, pane, m, alpha);
      }
      cursor += glyph.advance * sx + spacing;
    }
  }
  /** Shared NW4R line layout keeps text and the insertion caret on one grid. */
  layoutPaneText(text, pane) {
    const size = pane.fontSize,
      spacing = pane.charSpace || 0,
      sy = this.scale(size)[1];
    const lines = [];
    let offset = 0;
    for (const paragraph of text.split('\n')) {
      let line = '',
        start = offset;
      for (const character of paragraph) {
        if (!pane.noWrap && line && this.width(line + character, size, spacing) > pane.size[0]) {
          lines.push({ text: line, start, end: offset });
          line = '';
          start = offset;
        }
        line += character;
        offset += character.length;
      }
      lines.push({ text: line, start, end: offset });
      offset++;
    }
    const lineHeight = (this.font.lineFeed ?? this.font.height) * sy + (pane.lineSpace || 0);
    const textHeight = lines.length * lineHeight;
    const alignH = (pane.textPosition % 3) / 2,
      alignV = Math.floor(pane.textPosition / 3) / 2;
    const left = (-(pane.origin % 3) * pane.size[0]) / 2;
    const top =
      (Math.floor(pane.origin / 3) * pane.size[1]) / 2 - (pane.size[1] - textHeight) * alignV;
    const glyphOffset = ((this.font.ascent ?? this.font.baseline) - this.font.baseline) * sy;
    return {
      lines: lines.map((line, index) => {
        const x = left + (pane.size[0] - this.width(line.text, size, spacing)) * alignH;
        const carets = [{ index: line.start, x }];
        let position = x;
        let characterIndex = line.start;
        for (const character of line.text) {
          position += this.width(character, size) + spacing;
          characterIndex += character.length;
          carets.push({ index: characterIndex, x: position });
        }
        return { ...line, x, y: top - index * lineHeight - glyphOffset, carets };
      }),
      spacing,
      lineHeight,
    };
  }
  /** TextBox::DrawSelf/GetTextDrawRect, with plain-text wrapping and pane alignment. */
  drawPane(text, pane, matrix, alpha = 1, { material } = {}) {
    const { lines, spacing } = this.layoutPaneText(text, pane);
    const [color = WHITE, bottomColor = color] = pane.textColors || [];
    const colorMapping = material?.colors
      ?.slice(0, 2)
      .map((color) => color.map((value) => Math.max(0, Math.min(255, value))));
    for (const line of lines) {
      this.draw(line.text, line.x, line.y, pane.fontSize, {
        matrix,
        color,
        bottomColor,
        align: 'left',
        spacing,
        alpha,
        colorMapping,
        colorRanges: pane.textColorRanges,
        textOffset: line.start,
      });
      if (pane.showLineFeeds && text[line.end] === '\n') {
        // TextDrawer::draw (USA 4.3, 0x81435560) prints the original E056
        // glyph in RGB200, retaining alpha, before advancing to the next line.
        // This is a display marker; it must not add a stored character or caret.
        this.draw('\uE056', line.carets.at(-1).x, line.y, pane.fontSize, {
          matrix,
          color: [200, 200, 200, color[3]],
          align: 'left',
          alpha,
          colorMapping,
        });
      }
    }
  }
  /** Memo's insertion marker uses glyph advances rather than a guessed width. */
  drawCaret(text, pane, matrix, alpha = 1) {
    if (!Number.isInteger(pane.caretIndex) || pane.caretVisible === false) return;
    const index = Math.max(0, Math.min(text.length, pane.caretIndex));
    const { lines, spacing } = this.layoutPaneText(text, pane);
    // At an automatic wrap boundary, the insertion point belongs to the next
    // line. Explicit newline boundaries remain at the preceding line's end.
    const line = lines.findLast((line) => index >= line.start) || lines[0];
    const prefix = line.text.slice(0, Math.max(0, index - line.start));
    const x = line.x + this.width(prefix, pane.fontSize, spacing) + (prefix ? spacing : 0);
    const color = pane.caretColor || [255, 50, 50, 255];
    const width = keyboardCaretWidth(this.renderer.display?.width);
    const layout = {
      textures: [],
      materials: [
        { name: 'caret', colors: [[0, 0, 0, 0], WHITE, WHITE], textureMaps: [], textureSRTs: [] },
      ],
    };
    const marker = {
      origin: 0,
      size: [width, Math.max(0, pane.fontSize[1] - 4)],
      material: 0,
      vertexColors: [color, color, color, color],
    };
    this.renderer.quad(
      layout,
      marker,
      multiply(matrix, [1, 0, 0, 1, x - width / 2, line.y - 2]),
      alpha * (pane.caretOpacity ?? 1),
    );
  }
}
import { multiply } from './animation.js';
