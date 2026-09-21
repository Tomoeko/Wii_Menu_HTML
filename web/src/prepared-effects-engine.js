import { SequenceAuxiliaryBus } from './sequence-aux-bus.js';
import { SequenceAuxiliaryEffect } from './sequence-aux-effect.js';
import { preparedInactiveAuxiliaryBuses,
  validatePreparedBusDescriptor } from './prepared-bus-resources.js';

/** Static prepared voices sharing one native-rate menu Aux A transport. */
export class PreparedEffectsEngine {
  constructor(profile, { onEnded = () => {} } = {}) {
    this.inactiveAuxiliaryBuses = new Set(preparedInactiveAuxiliaryBuses(profile));
    this.routingKey = JSON.stringify(profile.routing ?? null);
    this.bus = new SequenceAuxiliaryBus(new SequenceAuxiliaryEffect(profile));
    this.onEnded = onEnded;
    this.assets = new Map();
    this.voices = new Map();
    this.main = [new Float32Array(96), new Float32Array(96)];
    this.sends = [new Float32Array(96), new Float32Array(96)];
    this.returns = [new Float32Array(96), new Float32Array(96)];
    this.output = [new Float32Array(96), new Float32Array(96)];
    this.blockOffset = 96;
  }

  addAsset(name, descriptor, channels) {
    validatePreparedBusDescriptor(descriptor);
    if (descriptor.unrenderedSends.some((send) => !this.inactiveAuxiliaryBuses.has(send))) {
      throw new Error('Shared effects cannot render this cue\'s additional auxiliary routes.');
    }
    if (!Array.isArray(channels) || channels.length !== 4 ||
        channels.some((channel) => !(channel instanceof Int32Array) ||
          channel.length !== descriptor.frames)) {
      throw new Error('Invalid prepared effect bus channels.');
    }
    this.assets.set(name, { descriptor, channels });
  }

  play(id, name, options = {}) {
    if (Object.keys(options).some((key) => key !== 'loop') ||
        (options.loop !== undefined && typeof options.loop !== 'boolean')) {
      throw new Error('Shared prepared effects support static playback and verified loops only.');
    }
    const { loop = false } = options;
    if (!Number.isSafeInteger(id) || id < 1 || this.voices.has(id)) {
      throw new Error('Invalid or duplicate shared effect handle.');
    }
    const asset = this.assets.get(name);
    if (!asset) throw new Error('Shared effect asset is not loaded.');
    if (this.voices.size >= 64) throw new Error('Shared effect browser voice budget exceeded.');
    if (loop && asset.descriptor.loopEndFrame === undefined) {
      throw new Error('Shared effect has no verified prepared loop period.');
    }
    this.voices.set(id, { asset, position: 0, loop });
  }

  stop(id) {
    this.voices.delete(id);
  }

  replaceEffect(profile) {
    if (profile !== null) {
      preparedInactiveAuxiliaryBuses(profile);
      if (JSON.stringify(profile.routing ?? null) !== this.routingKey) {
        throw new Error('An active prepared player cannot change auxiliary routing context.');
      }
    }
    this.bus.replaceEffect(profile === null ? null : new SequenceAuxiliaryEffect(profile));
  }

  reset() {
    this.voices.clear();
    this.bus.replaceEffect(null);
  }

  renderBlock() {
    this.main.forEach((channel) => channel.fill(0));
    this.sends.forEach((channel) => channel.fill(0));
    const buses = [...this.main, ...this.sends];
    const ended = [];
    for (const [id, voice] of this.voices) {
      const { descriptor, channels } = voice.asset;
      for (let frame = 0; frame < 96; frame += 1) {
        if (voice.loop && voice.position === descriptor.loopEndFrame) {
          voice.position = descriptor.loopStartFrame;
        }
        if (voice.position >= descriptor.frames) break;
        for (let channel = 0; channel < 4; channel += 1) {
          buses[channel][frame] += channels[channel][voice.position] / 32768;
        }
        voice.position += 1;
      }
      if (!voice.loop && voice.position === descriptor.frames) ended.push(id);
    }
    // All voices contribute before the one shared callback is processed. The
    // transport continues on zero input after their dry lifetimes have ended.
    this.bus.processBlock(...this.sends, ...this.returns);
    for (let channel = 0; channel < 2; channel += 1) {
      for (let frame = 0; frame < 96; frame += 1) {
        const sample = Math.fround(this.main[channel][frame] + this.returns[channel][frame]);
        this.output[channel][frame] = Math.max(-32768,
          Math.min(32767, Math.round(sample * 32768))) / 32768;
      }
    }
    for (const id of ended) {
      this.voices.delete(id);
      this.onEnded(id);
    }
    this.blockOffset = 0;
  }

  render(left, right) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) ||
        left.length !== right.length) throw new Error('Invalid shared effect output channels.');
    for (let frame = 0; frame < left.length; frame += 1) {
      if (this.blockOffset === 96) this.renderBlock();
      left[frame] = this.output[0][this.blockOffset];
      right[frame] = this.output[1][this.blockOffset];
      this.blockOffset += 1;
    }
  }
}
