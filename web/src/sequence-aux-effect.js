import { AUXILIARY_BLOCK_FRAMES } from './sequence-aux-bus.js';
import { SequenceReverb } from './sequence-reverb.js';

/** An owned callback, distinct from the persistent AX transport slots. */
export class SequenceAuxiliaryEffect {
  constructor(profile) {
    if (!['menu-chain', 'home-direct'].includes(profile?.callback)) {
      throw new Error('An auxiliary profile requires explicit callback ownership.');
    }
    this.reverb = new SequenceReverb(profile);
    // AppendEffect writes 2 at 0x814F84E8–F0. The chain callback clears its
    // first two CPU buffers without advancing the effect (0x814F8750–8788).
    // HOME registers ReverbHi directly, bypassing that chain wrapper.
    this.remainingClearBlocks = profile.callback === 'menu-chain' ? 2 : 0;
  }

  processBlock(left, right) {
    if ([left, right].some((channel) => !(channel instanceof Float32Array) ||
        channel.length !== AUXILIARY_BLOCK_FRAMES)) {
      throw new Error('Auxiliary callbacks require two 96-sample channels.');
    }
    if (this.remainingClearBlocks > 0) {
      this.remainingClearBlocks -= 1;
      left.fill(0);
      right.fill(0);
      return;
    }
    for (let frame = 0; frame < AUXILIARY_BLOCK_FRAMES; frame += 1) {
      left[frame] = this.reverb.process(0, left[frame]);
      right[frame] = this.reverb.process(1, right[frame]);
    }
  }
}
