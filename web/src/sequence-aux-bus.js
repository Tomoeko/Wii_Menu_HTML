/**
 * Stereo projection of the original AX auxiliary transport. This owns the
 * three 96-sample slots, independently of a scene's replaceable effect state.
 * The normal application has not selected the optional shared-effects path.
 */
export const AUXILIARY_BLOCK_FRAMES = 96;

function validateEffect(effect) {
  if (effect !== null && typeof effect?.process !== 'function' &&
      typeof effect?.processBlock !== 'function') {
    throw new TypeError('An auxiliary effect must provide process or processBlock.');
  }
}

export class SequenceAuxiliaryBus {
  constructor(effect = null) {
    validateEffect(effect);
    this.effect = effect;
    this.slots = Array.from({ length: 3 }, () => [
      new Float32Array(AUXILIARY_BLOCK_FRAMES),
      new Float32Array(AUXILIARY_BLOCK_FRAMES),
    ]);
    // __AXAuxInit (0x8155257C) assigns distinct DSP write/read and CPU slots.
    this.writeIndex = 0;
    this.readIndex = 1;
    this.cpuIndex = 2;
    this.clearPending = [false, false, false];
  }

  replaceEffect(effect) {
    validateEffect(effect);
    this.effect = effect;
    // AXRegisterAuxACallback (0x81552C4C–6C) marks buffers on unregister.
    // Registering a replacement does not flush audio or reset pending flags.
    if (effect === null) this.clearPending.fill(true);
  }

  processBlock(sendLeft, sendRight, returnLeft, returnRight) {
    const channels = [sendLeft, sendRight, returnLeft, returnRight];
    if (channels.some((channel) => !(channel instanceof Float32Array) ||
        channel.length !== AUXILIARY_BLOCK_FRAMES)) {
      throw new Error('Auxiliary transport requires four 96-sample Float32Array channels.');
    }
    const input = this.slots[this.writeIndex];
    const output = this.slots[this.readIndex];
    const cpu = this.slots[this.cpuIndex];
    // This call constructs a new staged block from ownership at entry. It
    // cannot change output already constructed and cached by its caller. The
    // native CPU rotation, sound callback and command build are separate;
    // their timing relative to scene requests is not modeled by this API.
    const effect = this.effect;
    const admitted = effect !== null;
    // The stereo command builder skips the entire Aux A command when its
    // input pointer is null (0x815532AC–B8), including the return pointer at
    // 0x81553318. Retaining a slot does not admit it into this block's mix.
    if (admitted) {
      input[0].set(sendLeft);
      input[1].set(sendRight);
      returnLeft.set(output[0]);
      returnRight.set(output[1]);
    } else {
      returnLeft.fill(0);
      returnRight.fill(0);
    }
    if (typeof effect?.processBlock === 'function') {
      effect.processBlock(cpu[0], cpu[1]);
    } else if (effect) {
      for (let frame = 0; frame < AUXILIARY_BLOCK_FRAMES; frame += 1) {
        cpu[0][frame] = effect.process(0, cpu[0][frame]);
        cpu[1][frame] = effect.process(1, cpu[1][frame]);
      }
    } else if (this.clearPending[this.cpuIndex]) {
      // __AXProcessAux (0x815529AC–EC) clears only this CPU slot, only while
      // no callback is registered. Replacement takes the processing branch.
      cpu[0].fill(0);
      cpu[1].fill(0);
      this.clearPending[this.cpuIndex] = false;
    }
    this.writeIndex = (this.writeIndex + 1) % 3;
    this.readIndex = (this.readIndex + 1) % 3;
    this.cpuIndex = (this.cpuIndex + 1) % 3;
  }
}
