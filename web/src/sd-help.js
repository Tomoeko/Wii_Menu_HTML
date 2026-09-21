import { indexLayout, poseLayout, walkPanes } from './animation.js';

export const SD_HELP_LAYOUTS = ['my_DialogWindow_a2', 'wait_icon', 'help_Btn'];
const PREFIX = 'sd-help:';

/** DialogWindow::callBtn2Multi, SD Help table at USA4.3 0x8165440c.
 * Navigation keeps the dialog stationary while text fades by ceil(255/10).
 * The last page uses the original forty-frame wait icon at Y=74.
 */
export function createSDHelp(
  layouts,
  { messages = {}, onSound = () => {}, firstVisit = false } = {},
) {
  const source = layouts.my_DialogWindow_a2;
  const iconSource = layouts.wait_icon;
  const messageMap = messages.messages || messages;
  const pageIds = firstVisit ? [157, 158, 159, 202] : [201, 158, 159];
  let page = 0,
    previousPage = 0,
    destination = 0,
    phase = 'enter',
    frame = 0;
  let selected = null,
    hovered = null,
    iconAge = 0;
  const focus = new Map();
  const animation = (suffix) => source.animations[`my_DialogWindow_a2_${suffix}`];
  const end = (suffix) => animation(suffix).frames - 1;
  const clip = (suffix, group, value) => ({
    animation: animation(suffix),
    group,
    frame: Math.min(end(suffix), value),
    loop: false,
  });
  onSound('infoWindow');
  const api = {
    get active() {
      return phase !== 'done';
    },
    hover(id) {
      if (phase !== 'idle' || !['help-back', 'help-next'].includes(id)) id = null;
      if (id === hovered) return;
      if (hovered) focus.set(hovered, { entering: false, frame: 0 });
      hovered = id;
      if (id) {
        focus.set(id, { entering: true, frame: 0 });
        onSound('buttonHover');
      }
    },
    activate(id) {
      if (phase !== 'idle' || !['help-back', 'help-next'].includes(id)) return false;
      if (firstVisit && page === 0 && id === 'help-back') return false;
      previousPage = page;
      destination = page + (id === 'help-back' ? -1 : 1);
      selected = id;
      phase = 'select';
      frame = 0;
      onSound(id === 'help-back' ? 'cancel' : 'confirm');
      return true;
    },
    advance(frames) {
      for (const state of focus.values()) state.frame += frames;
      if (phase === 'idle') {
        iconAge += frames;
        return;
      }
      frame += frames;
      while (phase !== 'idle' && phase !== 'done') {
        const duration =
          phase === 'enter'
            ? animation('DialogIn').frames
            : phase === 'select'
              ? animation('SelectBtn_Ac').frames
              : phase === 'exit'
                ? animation('DialogOut').frames
                : 10;
        if (frame < duration) break;
        frame -= duration;
        if (phase === 'enter') phase = 'idle';
        else if (phase === 'select') {
          phase = destination < 0 || destination >= pageIds.length ? 'exit' : 'text-out';
          if (phase === 'text-out') {
            // stt_prepare_pagefade restarts the pointed button's hover clip
            // as soon as its click ends, while the page text is fading.
            if (hovered === selected) focus.set(selected, { entering: true, frame });
            selected = null;
          }
        } else if (phase === 'text-out') {
          page = destination;
          iconAge = 0;
          phase = 'text-in';
        } else if (phase === 'text-in') {
          phase = 'idle';
          selected = null;
        } else if (phase === 'exit') phase = 'done';
      }
    },
    presentation() {
      if (!api.active) return { layers: [], controls: [], locked: false };
      const clips = [clip('DialogIn', 'G_InOut', phase === 'enter' ? frame : end('DialogIn'))];
      for (const [id, state] of focus)
        clips.push(
          clip(
            state.entering ? 'FocusBtn_on' : 'FocusBtn_off',
            `G_FocusBtn${id === 'help-back' ? 'A' : 'B'}`,
            state.frame,
          ),
        );
      if (selected)
        clips.push(
          clip(
            'SelectBtn_Ac',
            `G_SelectBtn${selected === 'help-back' ? 'A' : 'B'}`,
            phase === 'select' ? frame : end('SelectBtn_Ac'),
          ),
        );
      if (phase === 'exit') clips.push(clip('DialogOut', 'G_InOut', frame));
      const layout = poseLayout(source, clips),
        { panes } = indexLayout(layout);
      const alpha =
        phase === 'text-out'
          ? Math.max(0, 255 - Math.floor(frame) * 26)
          : phase === 'text-in'
            ? Math.min(255, Math.floor(frame) * 26)
            : 255;
      panes.get('T_Dialog').text = messageMap[pageIds[page]] ?? '';
      panes.get('T_Dialog').alpha = alpha;
      panes.get('T_BtnA').text = messageMap[165] ?? 'Back';
      const last = pageIds.length - 1;
      panes.get('T_BtnB').text =
        messageMap[page === last ? 164 : 163] ?? (page === last ? 'Close' : 'Next');
      if (
        ['text-out', 'text-in'].includes(phase) &&
        (previousPage === last) !== (destination === last)
      )
        panes.get('T_BtnB').alpha = alpha;
      if (firstVisit) {
        const showBack = page > 0 && !(phase === 'text-in' && alpha === 0);
        const back = panes.get('N_BtnA');
        back.flags = showBack ? back.flags | 1 : back.flags & ~1;
        if (['text-in', 'text-out'].includes(phase) && (previousPage === 0) !== (destination === 0))
          for (const child of panes.get('N_BtnA_Pic').children)
            walkPanes(child, (pane) => {
              pane.alpha = alpha;
            });
      }
      const layers = [{ layout, prefix: PREFIX }];
      if (page === 2 || (firstVisit && page === 3)) {
        const icon =
          page === 3
            ? poseLayout(layouts.help_Btn)
            : poseLayout(iconSource, [
                {
                  animation: iconSource.animations.wait_icon_wait_loop,
                  frame: iconAge,
                  loop: true,
                },
              ]);
        const position = panes.get('N_Dialog').translation;
        icon.root.translation = [position[0], position[1] + (page === 3 ? 108 : 74), position[2]];
        // DialogWindow::set_alpha recursively writes the custom layout's children.
        if (phase === 'text-in' || phase === 'text-out')
          for (const child of icon.root.children)
            walkPanes(child, (pane) => {
              pane.alpha = alpha;
            });
        layers.push({ layout: icon, prefix: page === 3 ? 'sd-help-button:' : 'sd-help-wait:' });
      }
      return {
        layers,
        locked: phase !== 'idle',
        controls: [
          { id: 'help-back', pane: 'B_BtnA', prefix: PREFIX, label: messageMap[165] ?? 'Back' },
          {
            id: 'help-next',
            pane: 'B_BtnB',
            prefix: PREFIX,
            label: page === last ? (messageMap[164] ?? 'Close') : (messageMap[163] ?? 'Next'),
          },
        ].filter((control) => !(firstVisit && page === 0 && control.id === 'help-back')),
      };
    },
    getState() {
      return { phase, frame, page, destination };
    },
  };
  return api;
}
