/** Arrow focus and press run independently. A page action must not synthesize
 * pointer departure: the focus endpoint stays posed until hover(null).
 * Every interval below comes from its caller's original resource/controller.
 */
export const ARROW_IDS = Object.freeze(['prev', 'next']);
export const isArrowId = (id) => ARROW_IDS.includes(id);
const persistentControlIds = new Set([
  'prev',
  'next',
  'scene-prev',
  'scene-next',
  'scene-address-prev',
  'scene-address-next',
  'scene-storage-prev',
  'scene-storage-next',
  'sd-menu-prev',
  'sd-menu-next',
  'scene-memo-scroll-up',
  'scene-memo-scroll-down',
  'scene-memo-up',
  'scene-memo-down',
  'scene-incoming-scroll-up',
  'scene-incoming-scroll-down',
  'scene-letter-scroll-up',
  'scene-letter-scroll-down',
  'scene-key-text-up',
  'scene-key-text-down',
  'settings-keyboard-key-text-up',
  'settings-keyboard-key-text-down',
  'scene-key-candidates-prev',
  'scene-key-candidates-next',
  'settings-keyboard-key-candidates-prev',
  'settings-keyboard-key-candidates-next',
  'scene-key-symbols-prev',
  'scene-key-symbols-next',
  'settings-keyboard-key-symbols-prev',
  'settings-keyboard-key-symbols-next',
]);
// Animated arrow hit panes can move by almost three logical pixels while the
// pointer stays still. One extra pixel covers CSS rounding in scaled views.
// Apply the tolerance to every shared arrow so its held focus does not cycle
// through leave and re-entry as the pane moves underneath the pointer.
const heldArrowExitMargin = 4;

/** The application's hit regions use these explicit controller prefixes.
 * Text-scroll buttons also retain focus through pointer-capture release and
 * control-list changes while the pointer remains inside their current bounds.
 */
export function isPersistentArrowControl(id) {
  return persistentControlIds.has(id);
}

/**
 * Transparent native buttons are the browser's hit-test surface for the
 * rendered arrows. Activate a primary pointer press immediately so the first
 * click cannot be consumed by native focus before the page action runs. The
 * following native click is suppressed by the host after this returns true.
 */
export function shouldActivateArrowPointerDown({ id, button = 0, disabled = false, suppressed = null }) {
  return button === 0 && !disabled && isPersistentArrowControl(id) && suppressed !== id;
}

/**
 * A click can temporarily disable an arrow while its page transition runs.
 * Keep the existing focus endpoint in that interval when the pointer is still
 * inside the same source hit region. This is distinct from resolving a stale
 * DOM event: a DOM event may not reacquire a disabled arrow, while the current
 * pointer may retain an already-held bubble until it actually leaves.
 */
export function pointerRemainsInPersistentControl(controls, point, id) {
  if (!point || point.visible === false || !isPersistentArrowControl(id)) return false;
  return controls.some((control) => {
    const rect = control.id === id && control.rect;
    return rect && point.x >= rect.x - heldArrowExitMargin &&
      point.x <= rect.x + rect.w + heldArrowExitMargin &&
      point.y >= rect.y - heldArrowExitMargin &&
      point.y <= rect.y + rect.h + heldArrowExitMargin;
  });
}

/**
 * Resolve a channel-drag edge arrow from the current pointer position.
 *
 * ChannelSelect disables its transparent arrow buttons while a channel is
 * being dragged so a release cannot activate a page action. The rendered
 * arrow still owns the pointer area, however, and its held focus bubble must
 * continue to follow the pointer. Keep this resolver separate from normal
 * pointer hover resolution, which intentionally ignores disabled controls.
 */
export function resolveDragArrowHover(controls, point) {
  if (!point || point.visible === false) return null;
  return controls.findLast((control) => {
    const rect = control.rect;
    return isArrowId(control.id) && rect &&
      point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h;
  })?.id ?? null;
}

/** DOM enter/leave notifications can lag animated button bounds by a render.
 * Resolve them with the same source geometry as per-frame arrow reconciliation,
 * so an overlapping sibling cannot repeatedly restart the arrow's focus cue.
 */
export function resolvePointerHover(controls, point, requested = null, held = null) {
  if (!point || point.visible === false) return requested;
  if (pointerRemainsInPersistentControl(controls, point, held)) return held;
  const resolved = controls.findLast((control) => {
    const rect = control.rect;
    return isPersistentArrowControl(control.id) && rect &&
      !control.disabled &&
      point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h;
  })?.id;
  if (resolved) return resolved;
  if (requested && isPersistentArrowControl(requested) &&
      controls.some((control) => control.id === requested && control.disabled)) return null;
  return requested;
}

export function arrowClip(animation, group, from = 0, to = animation.frames - 1) {
  return { animation, group, from, to };
}

/** Original common footer Button::scBtnFadeFrame intervals. */
export function commonArrowDefinitions(source) {
  const animation = source.animations.my_IplTop_e;
  return Object.fromEntries(
    ARROW_IDS.map((id) => {
      const side = id === 'prev' ? 'L' : 'R';
      return [
        id,
        {
          focusIn: arrowClip(animation, `G_Arw${side}_Focus`, 10600, 10615),
          focusOut: arrowClip(animation, `G_Arw${side}_Focus`, 10800, 10815),
          press: arrowClip(animation, `G_Arw${side}_Ac`, 10700, 10730),
        },
      ];
    }),
  );
}

export function createArrowInteraction(definitions) {
  const focus = new Map();
  const presses = new Map();
  let hovered = null;
  const sample = (clip, age) => ({
    animation: clip.animation,
    group: clip.group,
    frame: clip.from + Math.min(age, clip.to - clip.from),
    loop: false,
  });
  return {
    hover(id) {
      if (!Object.hasOwn(definitions, id)) id = null;
      if (id === hovered) return false;
      if (hovered) focus.set(hovered, { entering: false, age: 0 });
      hovered = id;
      if (id) focus.set(id, { entering: true, age: 0 });
      return true;
    },
    press(id) {
      if (!Object.hasOwn(definitions, id)) return false;
      presses.set(id, 0);
      return true;
    },
    advance(frames) {
      for (const state of focus.values()) state.age += frames;
      for (const [id, age] of presses) {
        const clip = definitions[id].press;
        if (age + frames > clip.to - clip.from) presses.delete(id);
        else presses.set(id, age + frames);
      }
    },
    clips() {
      const result = [];
      for (const [id, definition] of Object.entries(definitions)) {
        const state = focus.get(id);
        const clip = state?.entering === false ? definition.focusOut : definition.focusIn;
        result.push(sample(clip, state?.age ?? 0));
      }
      for (const [id, age] of presses) result.push(sample(definitions[id].press, age));
      return result;
    },
    reset() {
      hovered = null;
      focus.clear();
      presses.clear();
    },
    get hovered() {
      return hovered;
    },
  };
}
