import { loadPreparedBusAsset, loadPreparedBusCatalog,
  preparedInactiveAuxiliaryBuses } from './prepared-bus-resources.js';

const loadedModules = new WeakMap();

/**
 * Explicit experimental controller for static menu-effect overlap. It shares
 * its caller's AudioContext, but is not selected by createAudio or config.
 * HOME pause/fade/profile transitions require a separate integration contract.
 */
export function createSharedEffects({
  context,
  destination = context.destination,
  asset,
  baseUrl,
  fetchResource = globalThis.fetch,
  onError = () => {},
  nodeFactory = (owner, name, options) => new AudioWorkletNode(owner, name, options),
} = {}) {
  let node = null;
  let catalog = null;
  let destroyed = false;
  let initialized = false;
  let epoch = 0;
  let nextId = 1;
  let selectedEffect = 'menu';
  let cancelInitialization = () => {};
  const requests = new Map();
  const assets = new Map();
  const uploaded = new Set();

  function report(error) {
    try {
      onError(error);
    } catch {
      // A diagnostic callback must not prevent resource cleanup.
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    epoch += 1;
    requests.clear();
    assets.clear();
    uploaded.clear();
    cancelInitialization();
    if (node) {
      node.port.postMessage({ type: 'destroy' });
      node.port.close();
      node.disconnect();
      node.onprocessorerror = null;
      node = null;
    }
    // The caller owns the context and any BGM/master nodes attached to it.
  }

  async function initialize() {
    try {
      if (!context?.audioWorklet) throw new Error('Shared effects require AudioWorklet support.');
      if (!loadedModules.has(context)) {
        const pending = context.audioWorklet.addModule(
          new URL('./prepared-effects-worklet.js', import.meta.url),
        );
        loadedModules.set(context, pending);
        void pending.catch(() => loadedModules.delete(context));
      }
      const [loaded] = await Promise.all([
        loadPreparedBusCatalog(asset, baseUrl, fetchResource),
        loadedModules.get(context),
      ]);
      if (destroyed) return false;
      catalog = loaded;
      node = nodeFactory(context, 'wii-menu-prepared-effects', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      node.connect(destination);
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Shared effects initialization timed out.')), 15000);
        cancelInitialization = () => {
          clearTimeout(timeout);
          resolve(false);
        };
        node.port.onmessage = ({ data }) => {
          if (destroyed) return;
          if (data.type === 'ready') {
            clearTimeout(timeout);
            initialized = true;
            resolve(true);
          } else if (data.type === 'ended' && data.epoch === epoch) {
            requests.delete(data.id);
          } else if (data.type === 'error') {
            clearTimeout(timeout);
            const error = new Error(data.message);
            if (!initialized) reject(error);
            else {
              report(error);
              destroy();
            }
          }
        };
        node.onprocessorerror = () => {
          clearTimeout(timeout);
          const error = new Error('Shared effect processor stopped.');
          if (!initialized) reject(error);
          else {
            report(error);
            destroy();
          }
        };
        node.port.postMessage({ type: 'initialize', profile: catalog.effectProfiles.menu, epoch });
        if (selectedEffect === null) {
          node.port.postMessage({ type: 'replace-effect', profile: null, epoch });
        }
      });
    } catch (error) {
      if (!destroyed) report(error);
      destroy();
      return false;
    }
  }

  const ready = initialize();

  function stop(id) {
    if (!requests.delete(id)) return false;
    node?.port.postMessage({ type: 'stop', id, epoch });
    return true;
  }

  return Object.freeze({
    ready,
    async play(name, options = {}) {
      if (destroyed) return null;
      if (Object.keys(options).some((key) => key !== 'loop') ||
          (options.loop !== undefined && typeof options.loop !== 'boolean')) {
        report(new Error('Shared effects do not implement dynamic gain, pan, pitch or pause.'));
        return null;
      }
      const id = nextId;
      nextId += 1;
      const request = { epoch, state: 'loading' };
      requests.set(id, request);
      const current = () => !destroyed && request.epoch === epoch && requests.get(id) === request;
      try {
        if (!await ready || !current()) return null;
        const descriptor = catalog.sounds[name];
        if (!descriptor) throw new Error('Shared effect is absent from the staged catalog.');
        const inactiveBuses = preparedInactiveAuxiliaryBuses(catalog.effectProfiles.menu);
        if (descriptor.unrenderedSends.some((send) => !inactiveBuses.includes(send))) {
          throw new Error('Shared effect has unimplemented auxiliary routes.');
        }
        if (options.loop && descriptor.loopEndFrame === undefined) {
          throw new Error('Shared effect has no verified prepared loop period.');
        }
        if (!uploaded.has(name)) {
          if (!assets.has(name)) {
            const pending = loadPreparedBusAsset(descriptor, baseUrl, fetchResource);
            assets.set(name, pending);
            void pending.catch(() => assets.delete(name));
          }
          const channels = await assets.get(name);
          if (!current()) return null;
          if (!uploaded.has(name)) {
            node.port.postMessage({ type: 'asset', name, descriptor, channels, epoch },
              channels.map((channel) => channel.buffer));
            uploaded.add(name);
          }
        }
        if (!current()) return null;
        request.state = 'playing';
        node.port.postMessage({ type: 'play', id, name, options, epoch });
        return id;
      } catch (error) {
        if (current()) report(error);
        return null;
      } finally {
        if (request.state !== 'playing') requests.delete(id);
      }
    },
    stop,
    reset() {
      if (destroyed) return;
      epoch += 1;
      requests.clear();
      selectedEffect = null;
      node?.port.postMessage({ type: 'reset', epoch });
    },
    replaceEffect(name) {
      if (destroyed) return false;
      if (name !== null && name !== 'menu') {
        throw new Error('Only the verified menu profile is available; HOME ownership is not integrated.');
      }
      selectedEffect = name;
      if (catalog && node) node.port.postMessage({ type: 'replace-effect',
        profile: name === null ? null : catalog.effectProfiles.menu, epoch });
      return true;
    },
    destroy,
    getStatus: () => ({ mode: 'shared-aux-static', ready: initialized && !destroyed,
      destroyed, effect: selectedEffect, effectCount: requests.size,
      pendingCount: [...requests.values()].filter((request) => request.state === 'loading').length }),
  });
}
