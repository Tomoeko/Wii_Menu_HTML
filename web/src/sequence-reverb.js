/**
 * USA 4.3 ReverbHi fused network, verified at 0x81555FC8 and 0x81556890.
 * The menu selects zero pre-delay, early gain and crosstalk. Original delay
 * lengths and parameters are extracted locally from its executable.
 */
const single = Math.fround;

class DelayLine {
  constructor(length) {
    this.samples = new Float32Array(length);
    this.position = 0;
  }

  get value() {
    return this.samples[this.position];
  }

  write(value) {
    this.samples[this.position] = value;
    this.position = (this.position + 1) % this.samples.length;
  }

  allPass(input, coefficient) {
    const delayed = this.value;
    const value = single(input + single(delayed * coefficient));
    this.write(value);
    return single(delayed - single(value * coefficient));
  }
}

export class SequenceReverb {
  constructor({ delayFrames, preset }) {
    if (
      !Array.isArray(delayFrames) || delayFrames.length !== 8 ||
      delayFrames.some((value) => !Number.isInteger(value) || value < 1 || value > 32000) ||
      !Array.isArray(preset) || preset.length !== 6 || preset.some((value) => !Number.isFinite(value)) ||
      preset[0] !== 0 || preset[4] !== 0 || preset[1] <= 0 || preset[1] > 10 ||
      preset[2] < 0 || preset[2] >= 1 || preset[3] < 0 || preset[3] > 1 ||
      preset[5] < 0 || preset[5] > 1
    ) throw new Error('Unsupported native menu reverb preset.');
    const [, time, coloration, damping, , gain] = preset;
    this.coloration = coloration;
    this.lowPass = single(Math.min(0.95, single(1 - damping)));
    this.outputGain = single(0.6 * gain);
    const denominator = single(time * 32000);
    this.combGains = delayFrames.slice(0, 3).map((length) =>
      single(10 ** single(single(length * -3) / denominator)),
    );
    this.channels = [0, 1].map((channel) => ({
      comb: delayFrames.slice(0, 3).map((length) => new DelayLine(length)),
      allPass: delayFrames.slice(3, 5).map((length) => new DelayLine(length)),
      final: new DelayLine(delayFrames[5 + channel]),
      last: 0,
    }));
  }

  process(channel, input) {
    const state = this.channels[channel];
    let value = 0;
    for (let index = 0; index < state.comb.length; index += 1) {
      const line = state.comb[index];
      const delayed = line.value;
      value = single(value + delayed);
      line.write(single(input + single(delayed * this.combGains[index])));
    }
    for (const line of state.allPass) value = line.allPass(value, this.coloration);
    value = single(single(single(1 - this.lowPass) * value) + single(this.lowPass * state.last));
    state.last = value;
    value = state.final.allPass(value, this.coloration);
    // Native callbacks consume and return integer auxiliary samples. The
    // normalized representation preserves the integer sends from SequenceEngine.
    // SequenceEngine owns the AX auxiliary buffer latency outside this filter.
    return Math.trunc(single(value * this.outputGain) * 32768) / 32768;
  }
}
