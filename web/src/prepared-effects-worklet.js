import { PreparedEffectsEngine } from './prepared-effects-engine.js';

class PreparedEffectsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = null;
    this.epoch = 0;
    this.finished = false;
    this.phase = 0;
    this.previous = [0, 0];
    this.next = [0, 0];
    this.left = new Float32Array(1);
    this.right = new Float32Array(1);
    this.primed = false;
    this.port.onmessage = ({ data }) => {
      if (this.finished) return;
      try {
        if (data.type === 'initialize') {
          if (this.engine) throw new Error('Shared effects are already initialized.');
          this.epoch = data.epoch;
          this.engine = new PreparedEffectsEngine(data.profile, {
            onEnded: (id) => this.port.postMessage({ type: 'ended', id, epoch: this.epoch }),
          });
          this.port.postMessage({ type: 'ready' });
        } else if (data.type === 'destroy') {
          this.finished = true;
          this.engine = null;
        } else if (data.type === 'reset' && data.epoch > this.epoch) {
          this.epoch = data.epoch;
          this.engine?.reset();
        } else if (this.engine && data.epoch === this.epoch) {
          if (data.type === 'asset') this.engine.addAsset(data.name, data.descriptor, data.channels);
          else if (data.type === 'play') this.engine.play(data.id, data.name, data.options);
          else if (data.type === 'stop') this.engine.stop(data.id);
          else if (data.type === 'replace-effect') this.engine.replaceEffect(data.profile);
        }
      } catch (error) {
        this.port.postMessage({ type: 'error', message: error.message });
        this.finished = true;
        this.engine = null;
      }
    };
  }

  readNativeSample() {
    this.engine.render(this.left, this.right);
    this.next[0] = this.left[0];
    this.next[1] = this.right[0];
  }

  process(inputs, outputs) {
    if (this.finished) return false;
    const [left, right] = outputs[0];
    if (!this.engine || !left || !right) return true;
    try {
      if (!this.primed) {
        this.readNativeSample();
        this.previous[0] = this.next[0];
        this.previous[1] = this.next[1];
        this.readNativeSample();
        this.primed = true;
      }
      // Resample only after native-rate dry/send overlap, shared filtering and
      // final clipping. No host-rate AudioBufferSource is fed back into Aux.
      for (let frame = 0; frame < left.length; frame += 1) {
        left[frame] = this.previous[0] + (this.next[0] - this.previous[0]) * this.phase;
        right[frame] = this.previous[1] + (this.next[1] - this.previous[1]) * this.phase;
        this.phase += 32000 / sampleRate;
        while (this.phase >= 1) {
          this.phase -= 1;
          this.previous[0] = this.next[0];
          this.previous[1] = this.next[1];
          this.readNativeSample();
        }
      }
    } catch (error) {
      this.port.postMessage({ type: 'error', message: error.message });
      this.finished = true;
    }
    return !this.finished;
  }
}

registerProcessor('wii-menu-prepared-effects', PreparedEffectsProcessor);
