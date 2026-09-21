import { validateReconnectFixture } from './remote-state.js';

/** Explicit callbacks stand in for WPAD. Counts are native 60 Hz updates. */
export function createReconnectFixture({ delayFrames = 180, ...value } = {}, {
  onConnect = () => {}, onComplete = () => {},
} = {}) {
  const config = validateReconnectFixture(value);
  const connected = new Set();
  let phase = 'start-retry';
  let frame = 0;
  let waitFrame = 0;
  let finalFrame = null;
  let nextConnection = delayFrames;
  let startFailures = config.startFailures;
  let stopFailures = config.stopFailures;
  let retries = 0;
  let outcome = null;

  function attemptStart() {
    if (startFailures > 0) startFailures--;
    else phase = 'wait';
    frame = 0;
  }
  function attemptStop() {
    if (stopFailures > 0) {
      stopFailures--;
      phase = 'stop-retry';
    } else {
      phase = 'complete';
      onComplete(outcome);
    }
    frame = 0;
  }
  function connect(player = config.players.find(number => !connected.has(number))) {
    if (phase !== 'wait' || !config.players.includes(player) || connected.has(player)) return false;
    connected.add(player);
    onConnect(player);
    // Ending after the configured final player is a deterministic fixture
    // callback. Native automatic completion has a separate fourth-player branch.
    if (config.mode !== 'timeout' && connected.size === config.players.length) finalFrame = 0;
    return true;
  }
  attemptStart();
  return {
    connect,
    advance(step) {
      if (phase === 'complete') return;
      frame += step;
      if (phase === 'start-retry' || phase === 'stop-retry') {
        // Native setSimpleSyncAlarm retries both rejected operations at 100 ms.
        if (frame >= 6) {
          retries++;
          if (phase === 'start-retry') attemptStart();
          else attemptStop();
        }
        return;
      }
      waitFrame += step;
      if (finalFrame !== null) finalFrame += step;
      while (config.mode === 'automatic' && waitFrame >= nextConnection
          && connected.size < config.players.length) {
        connect();
        nextConnection = waitFrame + config.intervalMs * 0.06;
      }
      if (finalFrame !== null && finalFrame >= 30) {
        outcome = 'connected';
        attemptStop();
      } else if (waitFrame > 3600) {
        // Native state 5 compares the incremented counter with 3600 using >.
        outcome = 'timeout';
        attemptStop();
      }
    },
    snapshot: () => ({ phase, frame, waitFrame, connected: [...connected], retries, outcome }),
  };
}
