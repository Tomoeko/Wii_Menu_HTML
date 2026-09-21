import { loadSequenceResources } from './sequence-resources.js';

const loadedModules = new WeakMap();

/** Own one live sequence, retaining its voices and clock while a scene pauses it. */
export async function createRealtimeBackground({ context, destination, asset, baseUrl, onError }) {
  if (!context.audioWorklet || !globalThis.AudioWorkletNode) {
    throw new Error('Real-time menu music requires browser AudioWorklet support.');
  }
  if (!loadedModules.has(context)) {
    const loading = context.audioWorklet.addModule(new URL('./sequence-worklet.js', import.meta.url));
    loadedModules.set(context, loading);
    void loading.catch(() => loadedModules.delete(context));
  }
  const [{ definition, waves }] = await Promise.all([
    loadSequenceResources(asset, baseUrl),
    loadedModules.get(context),
  ]);
  const node = new AudioWorkletNode(context, 'wii-menu-sequence', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const gain = context.createGain();
  gain.gain.value = 0;
  node.connect(gain).connect(destination);
  let disposed = false;
  let disposalTimer;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(disposalTimer);
    node.port.postMessage({ type: 'destroy' });
    node.port.close();
    node.disconnect();
    gain.disconnect();
  };
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Background sequencer initialization timed out.')), 15000);
      node.port.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        } else if (data.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(data.message));
        }
      };
      node.onprocessorerror = () => {
        clearTimeout(timeout);
        reject(new Error('Background audio processor stopped.'));
      };
      node.port.postMessage({ type: 'initialize', definition, waves },
        waves.flatMap((wave) => wave.channels.map((channel) => channel.buffer)));
    });
  } catch (error) {
    dispose();
    throw error;
  }
  const fail = (error) => {
    dispose();
    onError?.(error);
  };
  node.port.onmessage = ({ data }) => {
    if (data.type === 'error') fail(new Error(data.message));
  };
  node.onprocessorerror = () => fail(new Error('Background audio processor stopped.'));

  function setGain(value, duration = 0) {
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    if (duration) gain.gain.linearRampToValueAtTime(value, now + duration);
    else gain.gain.setValueAtTime(value, now);
  }

  return {
    play() {
      if (disposed) return false;
      node.port.postMessage({ type: 'play' });
      setGain(1);
      return true;
    },
    pause(fadeMs = 0) {
      if (disposed) return;
      const duration = Math.max(0, fadeMs) / 1000;
      setGain(0, duration);
      node.port.postMessage({
        type: 'pause',
        atFrame: Math.ceil((context.currentTime + duration) * context.sampleRate),
      });
    },
    destroy(fadeMs = 0) {
      if (disposed) return;
      if (fadeMs <= 0) dispose();
      else {
        setGain(0, fadeMs / 1000);
        disposalTimer = setTimeout(dispose, fadeMs);
      }
    },
  };
}
