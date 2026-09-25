import { indexLayout } from './animation.js';

/** The two input forms share keyboard motion and text state, but repeat
 * different ruled-body units: Memo one line, Letter four (0x81444A54).
 */
export function arrangeMessageBody(layout, {
  kind = 'memo', text, hint, keyboard = null, editing = false, progress = 0,
  scrollOffset = 0, measureTextLines, lineHeight = 42,
  hintVisible = !editing && !text,
}) {
  const panes = indexLayout(layout).panes;
  const body = panes.get('N_Body');
  const root = panes.get('N_MemoRoot');
  const lineCount = Math.max(4, measureTextLines(text, panes.get('T_Letter'), layout));
  const linesPerBody = kind === 'letter' ? 4 : 1;
  const bodyCount = Math.ceil(lineCount / linesPerBody);
  const bodyHeight = body.size[1];
  const strips = Array.from({ length: bodyCount - 1 }, (_, index) => {
    const strip = structuredClone(body);
    strip.name = `${kind === 'letter' ? 'Letter' : 'Memo'}BodyRow${index + 1}`;
    strip.translation[1] -= bodyHeight * (index + 1);
    return strip;
  });
  root.children.splice(root.children.indexOf(body) + 1, 0, ...strips);
  panes.get('N_Footer').translation[1] -= bodyHeight * (bodyCount - 1);
  const smooth = progress * progress * (3 - 2 * progress);
  panes.get('N_Memo').translation[1] += scrollOffset + 145 * smooth;
  // Native Memo::InputForm::calc expands the pointer pane to the full text,
  // while its two-line editing window cancels the content's scroll offset.
  // Preserve each original top edge when changing its centered pane height.
  const resizeFromTop = (pane, height) => {
    pane.translation[1] -= (height - pane.size[1]) / 2;
    pane.size[1] = height;
  };
  resizeFromTop(panes.get('B_2l_TextBox'), lineCount * lineHeight);
  if (editing) {
    const viewport = panes.get('T_2l_TextBox');
    resizeFromTop(viewport, 2 * lineHeight);
    viewport.translation[1] -= scrollOffset;
  }
  panes.get('T_TouchLetter').text = hintVisible ? hint : '';
  const letter = panes.get('T_Letter');
  letter.text = text;
  if (keyboard) {
    letter.caretIndex = keyboard.displayCaret;
    letter.showLineFeeds = true;
    letter.caretVisible = keyboard.caretVisible;
    letter.caretOpacity = keyboard.caretOpacity;
    letter.textColorRanges = keyboard.textColorRanges || [];
  }
  return layout;
}

/** Apply the shared input-form entrance to freshly posed keyboard layers. */
export function keyboardTransitionLayers(layers, progress, entering = false) {
  const smooth = progress * progress * (3 - 2 * progress);
  const y = -200 * (1 - smooth);
  for (const layer of layers) {
    if (layer.prefix === 'keyboard-toolbar:') {
      const panes = indexLayout(layer.layout).panes;
      // Original toolbar vtable +0xb4 is N_UP; +0xb8 is N_DOWN.
      panes.get('N_UP').translation[1] -= y / 3;
      panes.get('N_DOWN').translation[1] += y / 3;
      if (entering) panes.get('N_UP').alpha = 0;
    } else layer.layout.root.translation[1] += y;
    layer.alpha = Math.trunc(255 * smooth) / 255;
  }
  return layers;
}
