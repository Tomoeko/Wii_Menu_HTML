/** Original AX parameter quantization and integer volume stages. */
const single = Math.fround;
const PCM_SCALE = 32768;

export function bankNoteGain(velocity, instrumentVolume) {
  // Bank::NoteOn (0x814FC054–0x814FC068) rounds each division and
  // multiplication to float32 before storing the channel's initial gain.
  const velocityRatio = single(velocity / 127);
  const instrumentRatio = single(instrumentVolume / 127);
  return single(single(velocityRatio * velocityRatio) * instrumentRatio);
}

export function sourceStep(sampleRate, pitch) {
  // UpdateAxSrc (0x814FA684–0x814FA688) rounds multiply then divide to
  // float32. Its 65536 scale and unsigned conversion at 0x814FA6B8–C8
  // produce the DSP's 16.16 step; this does not choose a filter table.
  const ratio = single(single(single(pitch) * sampleRate) / 32000);
  const fixed = Math.min(0xffffffff, Math.max(0, Math.trunc(single(ratio * 65536))));
  return fixed / 65536;
}

export function envelopeCoefficient(gain) {
  // UpdateAxVe (0x814FAA24–0x814FAA40) uses 32767 and fctiwz.
  // Its volume inputs are clamped to 0..1 before reaching this stage.
  return Math.trunc(single(single(gain) * 32767));
}

export function sendCoefficient(gain) {
  // CalcAXPBMIX (0x814FB798 onward) uses 32768, unsigned conversion,
  // and a 0xffff ceiling for each independently calculated output send.
  return Math.min(0xffff, Math.trunc(single(single(gain) * PCM_SCALE)));
}

export function envelopeDelta(initial, target) {
  // UpdateAxVe (0x814FAA94–0x814FAAB0) divides the signed difference by
  // 96 with truncation toward zero. DSP sample zero still uses initial.
  return Math.trunc((target - initial) / 96) + 0;
}

export function multiplyPcmVolume(sample, coefficient) {
  // Original axDspSlave word offsets 0x036C–0x0374 and 0x0BD1–0x0BE9
  // discard the low product bits. Negative samples round toward -infinity.
  // Number arithmetic avoids JavaScript's overflowing signed-32-bit product.
  return Math.floor(sample * coefficient / PCM_SCALE);
}
