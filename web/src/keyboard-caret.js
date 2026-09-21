/** USA 4.3 Base::drawCursor (0x81420500) and calcCursorTimer (0x8141F3B0).
 * The original debug line helper emits a centered quad, using sixths of a
 * logical unit. Keep fractional glyph positions; the native code does not snap.
 */
export function keyboardCaretWidth(projectionWidth = 608) {
  return Math.trunc(14592 / projectionWidth) / 6;
}

export function keyboardCaretOpacity(updates = 0) {
  const radians = updates * 8 * Math.PI / 180;
  return Math.trunc(127 * (1 + Math.sin(radians))) / 255;
}
