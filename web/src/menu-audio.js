import { PREVIEW_CHANGE, previewPresentation } from './preview-transition.js';

/** Scene transitions determine audio lifetime; HOME pauses that lifetime. */
export function createMenuAudioSync(audio, { onPreviewStart = () => {} } = {}) {
  let backgroundMode = null,
    activePreview = null,
    pendingPreview = null,
    homeActive = false;
  return (state, { homeSoundInitialized = false } = {}) => {
    const home = Boolean(
      state.overlay || (state.transition?.kind === 'home' && state.transition.from.overlay),
    );
    const restarting = state.screen === 'restarting';
    // Preview entry suspends the existing soundtrack; HOME's full reboot is
    // the distinct boundary that discards its playback position.
    let background = 'paused';
    if (restarting) background = 'stopped';
    else if (
      ['grid', 'board', 'settings', 'sd'].includes(state.screen) &&
      state.transition?.kind !== 'back'
    )
      background = 'playing';
    if (background !== backgroundMode) {
      backgroundMode = background;
      if (background === 'playing') void audio.startBackground();
      else if (background === 'paused') audio.pauseBackground();
      else audio.stopBackground();
    }
    // Retire paused tracks before releasing HOME, so a full reboot cannot
    // briefly resume an old banner while its loading screen takes ownership.
    if (restarting && activePreview !== null) {
      audio.stopChannel(0);
      activePreview = null;
      pendingPreview = null;
    }
    // HOME's init_sound dispatches the pause callback only after its entrance
    // animation completes (0x813731A0), before HOMESE_HOME_BUTTON. Overlay
    // visibility alone must not pause voices or initialize an interrupted entry.
    if (home && homeSoundInitialized && !homeActive && !restarting) {
      homeActive = true;
      audio.pauseMenuAudio();
    } else if (!home && homeActive) {
      homeActive = false;
      audio.resumeMenuAudio();
    }
    if (state.transition?.kind === 'preview') {
      pendingPreview = state.selectedIndex;
      // calcNormalChangeWait keeps the old sound until the layout is replaced.
      if (previewPresentation(state).phase === 'out' && activePreview !== null) {
        audio.stopChannel(0);
        activePreview = null;
      }
      return;
    }
    if (state.screen !== 'preview' || state.transition?.kind === 'select') {
      if (activePreview !== null) {
        audio.stopChannel(state.transition?.kind === 'back' ? (28 * 1000) / 60 : 0);
        activePreview = null;
      }
      pendingPreview = null;
    } else if (activePreview !== state.selectedIndex) {
      const navigated = pendingPreview !== null || activePreview !== null;
      if (activePreview !== null) audio.stopChannel(0);
      const moduleLeadFrames =
        pendingPreview === state.selectedIndex ? PREVIEW_CHANGE.outFrames : 0;
      pendingPreview = null;
      activePreview = state.selectedIndex;
      onPreviewStart(state.selectedIndex, { navigated, moduleLeadFrames });
      const channel = state.channels[state.selectedIndex];
      const asset =
        channel?.audio ?? (channel?.id === 'disc' ? audio.asset?.('discPreview') : null);
      if (asset) void audio.playChannel(channel.id, asset);
    }
  };
}
