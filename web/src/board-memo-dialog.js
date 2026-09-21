import { indexLayout, poseLayout } from './animation.js';

export const MEMO_DIALOG_LAYOUT = 'my_DialogWindow_b';
const PREFIX = 'memo-erase-dialog:';

/** focus_object::stt_wait_btn calls DialogWindow::callSBtn2(64,46,37,false).
 * Its left Quit button cancels; the right OK button accepts after DialogOut. */
export function createMemoEraseDialog(
  source,
  { messages = {}, onSound = () => {}, onDone = () => {} } = {},
) {
  const strings = messages.messages || messages;
  let phase = 'enter',
    frame = 0,
    selected = null,
    hovered = null;
  const focus = new Map();
  const animation = (suffix) => source.animations[`${MEMO_DIALOG_LAYOUT}_${suffix}`];
  const clip = (suffix, group, value) => ({
    animation: animation(suffix),
    group,
    frame: Math.min(value, animation(suffix).frames - 1),
    loop: false,
  });
  onSound('WIPL_SE_INFO_WINDOW');
  const api = {
    get locked() {
      return phase !== 'idle' && phase !== 'done';
    },
    hover(id) {
      if (phase !== 'idle' || !['memo-erase-no', 'memo-erase-yes'].includes(id)) id = null;
      if (id === hovered) return false;
      if (hovered) focus.set(hovered, { entering: false, frame: 0 });
      hovered = id;
      if (id) {
        focus.set(id, { entering: true, frame: 0 });
        onSound('WIPL_SE_BT_TARGETTING');
      }
      return true;
    },
    activate(id) {
      if (phase !== 'idle' || !['memo-erase-no', 'memo-erase-yes'].includes(id)) return false;
      selected = id;
      phase = 'select';
      frame = 0;
      onSound(id === 'memo-erase-yes' ? 'WIPL_SE_DECIDE' : 'WIPL_SE_CANCEL');
      return true;
    },
    back() {
      return api.activate('memo-erase-no');
    },
    advance(frames) {
      for (const state of focus.values()) state.frame += frames;
      if (phase === 'idle' || phase === 'done') return;
      frame += frames;
      while (phase !== 'idle' && phase !== 'done') {
        const end = animation(
          phase === 'enter' ? 'DialogIn' : phase === 'select' ? 'SelectBtn_Ac' : 'DialogOut',
        ).frames;
        if (frame < end) break;
        frame -= end;
        if (phase === 'enter') phase = 'idle';
        else if (phase === 'select') phase = 'exit';
        else {
          phase = 'done';
          onDone(selected === 'memo-erase-yes');
        }
      }
    },
    presentation() {
      if (phase === 'done') return { layers: [], controls: [], locked: api.locked };
      const clips = [clip('DialogIn', 'G_InOut', phase === 'enter' ? frame : Infinity)];
      for (const [id, state] of focus)
        clips.push(
          clip(
            state.entering ? 'FocusBtn_on' : 'FocusBtn_off',
            `G_FocusBtn${id.endsWith('yes') ? 'B' : 'A'}`,
            state.frame,
          ),
        );
      if (selected)
        clips.push(
          clip(
            'SelectBtn_Ac',
            `G_SelectBtn${selected.endsWith('yes') ? 'B' : 'A'}`,
            phase === 'select' ? frame : Infinity,
          ),
        );
      if (phase === 'exit') clips.push(clip('DialogOut', 'G_InOut', frame));
      const layout = poseLayout(source, clips),
        panes = indexLayout(layout).panes;
      panes.get('T_Dialog').text = strings[64] ?? 'Erase this message?';
      panes.get('T_BtnA').text = strings[37] ?? 'Quit';
      panes.get('T_BtnB').text = strings[46] ?? 'OK';
      return {
        layers: [{ layout, prefix: PREFIX }],
        locked: api.locked,
        controls: ['no', 'yes'].map((id, index) => ({
          id: `memo-erase-${id}`,
          pane: `B_Btn${index ? 'B' : 'A'}`,
          prefix: PREFIX,
          label: strings[index ? 46 : 37] ?? (index ? 'OK' : 'Quit'),
          disabled: api.locked,
        })),
      };
    },
    snapshot: () => ({ phase, frame }),
  };
  return api;
}
