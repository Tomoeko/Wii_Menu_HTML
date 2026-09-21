import { SequenceEngine, SEQUENCE_SAMPLE_RATE } from './sequence-engine.js';

class MenuSequenceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = null;
    this.playing = false;
    this.pauseFrame = Infinity;
    this.finished = false;
    this.phase = 0;
    this.previous = [0, 0];
    this.next = [0, 0];
    this.left = new Float32Array(1);
    this.right = new Float32Array(1);
    this.primed = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'initialize') {
        try {
          this.engine = new SequenceEngine(data.definition, data.waves);
          this.port.postMessage({ type: 'ready' });
        } catch (error) {
          this.port.postMessage({ type: 'error', message: error.message });
          this.finished = true;
        }
      } else if (data.type === 'play') {
        this.playing = true;
        this.pauseFrame = Infinity;
      } else if (data.type === 'pause') {
        this.pauseFrame = data.atFrame;
      } else if (data.type === 'destroy') {
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
    if (!this.engine || !this.playing || !left || !right) return true;
    try {
      if (!this.primed) {
        this.readNativeSample();
        this.previous[0] = this.next[0];
        this.previous[1] = this.next[1];
        this.readNativeSample();
        this.primed = true;
      }
      for (let frame = 0; frame < left.length; frame += 1) {
        if (currentFrame + frame >= this.pauseFrame) {
          this.playing = false;
          break;
        }
        left[frame] = this.previous[0] + (this.next[0] - this.previous[0]) * this.phase;
        right[frame] = this.previous[1] + (this.next[1] - this.previous[1]) * this.phase;
        this.phase += SEQUENCE_SAMPLE_RATE / sampleRate;
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

registerProcessor('wii-menu-sequence', MenuSequenceProcessor);
