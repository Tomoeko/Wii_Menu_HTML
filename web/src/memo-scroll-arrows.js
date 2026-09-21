import { arrowClip, createArrowInteraction } from './arrow-interaction.js';
import { createPaneAnimationBinding } from './pane-animation-binding.js';

const DIRECTIONS = ['up', 'down'];
/** Memo has separate display-page bubbles and one-line editor scroll buttons. */
export function createMemoScrollArrows(source, {
  stem = 'my_Memo_a', controlPrefix = 'memo', layoutPrefix = 'scene-create-body:',
  allowEditing = true,
} = {}) {
  const controlDirection = (id) =>
    id === `${controlPrefix}-scroll-up` ? 'up' : id === `${controlPrefix}-scroll-down` ? 'down' : null;
  const bind = createPaneAnimationBinding(source);
  const resource = (suffix) => source.animations[`${stem}_${suffix}`];
  const editorAnimation = (suffix, direction, appearance = false) => {
    const result = bind(resource(suffix), `P_txtScrll_${direction.toUpperCase()}`, 'P_txtScrll_UP');
    if (appearance) return result;
    return {
      ...result,
      targets: result.targets.map((target) => ({
        ...target,
        // Appearance owns opacity independently of focus and press. Otherwise
        // a hovered button can remain visible after reaching the scroll bound.
        tracks: target.tracks.filter((track) =>
          !(track.kind === 'RLVC' && track.target === 16) &&
          !(track.kind === 'RLMC' && track.target === 11),
        ),
      })),
    };
  };
  const displayInteraction = createArrowInteraction(Object.fromEntries(DIRECTIONS.map((direction) => {
    const side = direction === 'up' ? 'R' : 'L';
    return [direction, {
      focusIn: arrowClip(resource('FocusOn'), `G_Arw${side}_Focus`),
      focusOut: arrowClip(resource('FocusOff'), `G_Arw${side}_Focus`),
      press: arrowClip(resource('Select'), `G_Arw${side}_Ac`),
    }];
  })));
  const editorDirections = allowEditing ? DIRECTIONS : [];
  const editorInteraction = createArrowInteraction(Object.fromEntries(editorDirections.map((direction) =>
    [direction, {
      focusIn: arrowClip(editorAnimation('Foucus_IN', direction), undefined, 1, 6),
      focusOut: arrowClip(editorAnimation('Focus-OUT', direction), undefined, 0, 8),
      press: arrowClip(editorAnimation('Pushed', direction), undefined, 0, 7),
    }],
  )));
  const appearances = Object.fromEntries(['display', 'editor'].map((mode) =>
    [mode, Object.fromEntries(DIRECTIONS.map((direction) =>
      [direction, { visible: false, frame: 11, appeared: false }],
    ))],
  ));
  let editing = false;
  const interaction = () => editing ? editorInteraction : displayInteraction;
  const mode = () => editing ? 'editor' : 'display';
  return {
    update(state, nextEditing) {
      if (nextEditing && !allowEditing) throw new Error('This reader has no editor scroll resources.');
      if (editing !== nextEditing) {
        displayInteraction.reset();
        editorInteraction.reset();
        editing = nextEditing;
      }
      for (const kind of ['display', 'editor']) {
        for (const direction of DIRECTIONS) {
          const arrow = appearances[kind][direction];
          const visible = kind === mode() && (direction === 'up' ? state.previous : state.next);
          if (visible === arrow.visible) continue;
          arrow.visible = visible;
          arrow.frame = 0;
          arrow.appeared ||= visible;
          if (!visible && interaction().hovered === direction) interaction().hover(null);
        }
      }
    },
    advance(frames) {
      displayInteraction.advance(frames);
      editorInteraction.advance(frames);
      for (const arrows of Object.values(appearances))
        for (const arrow of Object.values(arrows)) arrow.frame += frames;
    },
    hover(id) {
      const direction = controlDirection(id);
      return interaction().hover(appearances[mode()][direction]?.visible ? direction : null);
    },
    press(id) {
      return interaction().press(controlDirection(id));
    },
    controls() {
      return DIRECTIONS.filter((direction) => appearances[mode()][direction].visible).map((direction) => ({
        id: `${controlPrefix}-scroll-${direction}`,
        pane: editing ? `B_txtScrll_${direction.toUpperCase()}` : direction === 'up' ? 'B_ArwR' : 'B_ArwL',
        prefix: layoutPrefix,
        label: `Scroll ${controlPrefix} ${direction}`,
      }));
    },
    clips() {
      const clips = [];
      for (const direction of DIRECTIONS) {
        const display = appearances.display[direction];
        clips.push({
          animation: resource(display.visible ? 'Appear' : 'Lost'),
          group: `G_Arw${direction === 'up' ? 'R' : 'L'}_End`,
          frame: Math.min(10, display.frame),
          loop: false,
        });
        const editor = appearances.editor[direction];
        if (!editor.appeared) continue;
        clips.push({
          animation: editorAnimation('Fade_IN', direction, true),
          frame: editor.visible ? Math.min(11, editor.frame) : 11,
          loop: false,
        });
        if (!editor.visible) clips.push({
          animation: editorAnimation('Fade_OUT', direction, true),
          frame: Math.min(10, editor.frame),
          loop: false,
        });
      }
      return [...clips, ...displayInteraction.clips(), ...editorInteraction.clips()];
    },
  };
}
