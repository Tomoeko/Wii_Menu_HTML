import { PREVIEW_CHANGE_DURATION } from './preview-transition.js';

export const CHANNELS_PER_PAGE = 12;
export const PAGE_COUNT = 4;

// ChannelSelect::startPageScroll uses 20 frames; initChanZoomParam uses 28.
// Controller durations are provisional until matched to the supplied native binary.
export const DEFAULT_TIMING = Object.freeze({
  page: (20 * 1000) / 60,
  select: (28 * 1000) / 60,
  back: (28 * 1000) / 60,
  preview: PREVIEW_CHANGE_DURATION,
  // Dummy settings have no native transition implementation yet.
  settings: 300,
  // th_HomeBtn_d_hmMenu_strt/fnsh.brlan and HBM's forward controller.
  homeEnter: (21 * 1000) / 60,
  homeExit: (39 * 1000) / 60,
});

/** Deterministic interaction state. Indices are absolute slots, numbered 0–47. */
export function createMenuState({ channels = [], timing = {} } = {}) {
  let slots = Object.freeze(
    Array.from({ length: PAGE_COUNT * CHANNELS_PER_PAGE }, (_, i) =>
      channels[i] ? Object.freeze({ ...channels[i] }) : null,
    ),
  );
  const durations = { ...DEFAULT_TIMING, ...timing };
  for (const value of Object.values(durations)) {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError('Transition durations must be finite and nonnegative.');
  }
  const listeners = new Set();
  let current = { screen: 'grid', page: 0, selectedIndex: null, overlay: null };
  let transition = null;
  let snapshot;

  function publish() {
    snapshot = Object.freeze({
      ...current,
      channels: slots,
      locked: transition !== null,
      transition: transition ? Object.freeze({ ...transition }) : null,
    });
    for (const listener of listeners) listener(snapshot);
  }

  function move(kind, changes, direction) {
    if (transition) return false;
    const from = Object.freeze({ ...current });
    current = { ...current, ...changes };
    const to = Object.freeze({ ...current });
    const duration =
      kind === 'home' ? durations[changes.overlay ? 'homeEnter' : 'homeExit'] : durations[kind];
    if (duration > 0) {
      transition = {
        kind,
        from,
        to,
        elapsed: 0,
        duration,
        progress: 0,
        ...(direction === undefined ? {} : { direction }),
      };
    }
    publish();
    return true;
  }

  function isAvailable(index) {
    return (
      Number.isInteger(index) &&
      index >= 0 &&
      index < slots.length &&
      slots[index] !== null &&
      slots[index].disabled !== true
    );
  }

  function previewNeighbor(direction) {
    if (![-1, 1].includes(direction) || current.screen !== 'preview') return null;
    // ChannelTitle::searchChannel wraps the complete four-page slot array.
    for (let offset = 1; offset < slots.length; offset++) {
      const i = (current.selectedIndex + direction * offset + slots.length) % slots.length;
      if (isAvailable(i)) return i;
    }
    return null;
  }

  publish();
  return Object.freeze({
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    selectChannel(index) {
      if (
        current.screen !== 'grid' ||
        current.overlay ||
        !isAvailable(index) ||
        Math.floor(index / CHANNELS_PER_PAGE) !== current.page
      )
        return false;
      return move('select', { screen: 'preview', selectedIndex: index });
    },
    changePage(direction) {
      if (current.screen !== 'grid' || current.overlay || ![-1, 1].includes(direction))
        return false;
      const page = current.page + direction;
      if (page < 0 || page >= PAGE_COUNT) return false;
      return move('page', { page });
    },
    previewNeighbor,
    changePreview(direction) {
      if (current.overlay) return false;
      const index = previewNeighbor(direction);
      if (index === null) return false;
      return move(
        'preview',
        { selectedIndex: index, page: Math.floor(index / CHANNELS_PER_PAGE) },
        direction,
      );
    },
    back() {
      if (current.overlay) return move('home', { overlay: null });
      if (current.screen === 'grid') return false;
      return move(current.screen === 'preview' ? 'back' : 'settings', {
        screen: 'grid',
        selectedIndex: null,
      });
    },
    openSettings() {
      if (current.screen !== 'grid' || current.overlay) return false;
      return move('settings', { screen: 'settings' });
    },
    openBoard() {
      if (current.screen !== 'grid' || current.overlay) return false;
      return move('settings', { screen: 'board' });
    },
    openSD() {
      if (current.screen !== 'grid' || current.overlay) return false;
      return move('settings', { screen: 'sd' });
    },
    moveChannel(from, to) {
      if (
        transition ||
        current.overlay ||
        current.screen !== 'grid' ||
        !isAvailable(from) ||
        slots[from].id === 'disc' ||
        !Number.isInteger(to) ||
        to <= 0 ||
        to >= slots.length ||
        slots[to]
      )
        return false;
      const next = [...slots];
      next[to] = next[from];
      next[from] = null;
      slots = Object.freeze(next);
      publish();
      return true;
    },
    openHome() {
      if (current.overlay) return false;
      return move('home', { overlay: 'home' });
    },
    closeHome() {
      if (!current.overlay) return false;
      return move('home', { overlay: null });
    },
    returnToMenu() {
      if (!current.overlay) return false;
      // Native HomeButtonMenu requests an IPL reset for its Wii Menu button.
      // The browser boundary returns to the initial page without a reload.
      return move('home', { screen: 'grid', page: 0, selectedIndex: null, overlay: null });
    },
    finishHome({ returnToMenu = false } = {}) {
      if (!current.overlay || (transition && transition.kind !== 'home')) return false;
      // The HOME controller has already completed its native retraction/fade.
      // Commit its result without scheduling a second HOME exit animation.
      transition = null;
      current = returnToMenu
        ? { screen: 'grid', page: 0, selectedIndex: null, overlay: null }
        : { ...current, overlay: null };
      publish();
      return true;
    },
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0)
        throw new RangeError('Elapsed time must be finite and nonnegative.');
      if (!transition || ms === 0) return false;
      transition.elapsed = Math.min(transition.duration, transition.elapsed + ms);
      transition.progress = transition.elapsed / transition.duration;
      if (transition.elapsed >= transition.duration) transition = null;
      publish();
      return true;
    },
  });
}
