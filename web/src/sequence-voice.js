/** Common native-rate channel envelope, linear source sampling and integer mix. */
import { envelopeCoefficient, envelopeDelta, multiplyPcmVolume, sendCoefficient } from './sequence-mix.js';

function releaseRate(value) {
  if (value === 127) return 65535;
  if (value === 126) return 24;
  // SetDecay/SetRelease round both operations separately (0x814FF2CC–304,
  // 0x814FF374–3AC). Rounding only the final envelope crosses table indices.
  if (value < 50) return Math.fround(Math.fround((value * 2 + 1) / 128) / 5);
  return Math.fround(Math.fround(60 / (126 - value)) / 5);
}

function updateEnvelope(voice, tables) {
  const [attack, decay, sustain, release] = voice.envelope;
  if (voice.envelopeState === 'attack') {
    for (let millisecond = 0; millisecond < 3; millisecond += 1) {
      voice.envelopeLevel = Math.fround(voice.envelopeLevel * tables.attack[attack]);
      if (voice.envelopeLevel > -1 / 32) {
        voice.envelopeLevel = 0;
        voice.envelopeState = 'decay';
      }
    }
  } else if (voice.envelopeState === 'decay') {
    // Native fmuls then fsubs retain the rounded 3 ms decrement (0x814FF1F8,
    // 0x814FF200); release uses the same two stages at 0x814FF248/24C.
    const decrement = Math.fround(releaseRate(decay) * 3);
    voice.envelopeLevel = Math.fround(voice.envelopeLevel - decrement);
    if (voice.envelopeLevel <= tables.sustain[sustain]) {
      voice.envelopeLevel = tables.sustain[sustain];
      voice.envelopeState = 'sustain';
    }
  } else if (voice.envelopeState === 'release') {
    const decrement = Math.fround(releaseRate(release) * 3);
    voice.envelopeLevel = Math.fround(voice.envelopeLevel - decrement);
  }
}

function envelopeGain(voice, tables) {
  const instant = voice.envelopeState === 'attack' && tables.attack[voice.envelope[0]] === 0;
  // GetValue divides by ten (0x814FF130); CalcVolumeRatio multiplies by ten
  // again (0x8150F350). Both round to float32 before integer table indexing.
  const decibels = instant ? 0 : Math.fround(voice.envelopeLevel / 10);
  const level = Math.fround(Math.max(Math.fround(-90.4), Math.min(6, decibels)) * 10);
  return tables.decibels[904 + Math.trunc(level)];
}

export function renderVoiceBlock(voice, tables, gain,
  { leftPan, rightPan, mainSend, auxSend }, [left, right, auxOutputLeft, auxOutputRight]) {
  // Channel::Update reads the envelope before and after its 3 ms update
  // (0x814FDADC, 0x814FDD7C, 0x814FDD94). UpdateAxVe uses the previous
  // voice volume at the start and the current volume at the target.
  const initialVolume = envelopeCoefficient(
    (voice.previousGain ?? gain) * envelopeGain(voice, tables),
  );
  updateEnvelope(voice, tables);
  const targetVolume = envelopeCoefficient(gain * envelopeGain(voice, tables));
  const volumeDelta = envelopeDelta(initialVolume, targetVolume);
  voice.previousGain = gain;
  // CalcAXPBMIX writes zero to all send deltas (0x814FB9A4–0x814FB9D8).
  // The driver ramps the voice envelope, not the main/Aux send changes.
  const mainLeft = sendCoefficient(Math.fround(leftPan * mainSend));
  const mainRight = sendCoefficient(Math.fround(rightPan * mainSend));
  const auxLeft = sendCoefficient(Math.fround(leftPan * auxSend));
  const auxRight = sendCoefficient(Math.fround(rightPan * auxSend));
  const channels = voice.wave.channels;
  const sourceLeft = channels[0];
  const sourceRight = channels[1] ?? sourceLeft;
  for (let frame = 0; frame < 96; frame += 1) {
    if (voice.position >= sourceLeft.length) break;
    const low = Math.floor(voice.position);
    const next = Math.min(low + 1, sourceLeft.length - 1);
    const fraction = voice.position - low;
    // DSP words 0x035C–0x0362 write initial first, then 95 increments.
    // The next CPU update starts at its target-derived value, so integer
    // division's leftover fraction does not accumulate across blocks.
    const volume = initialVolume + frame * volumeDelta;
    const sampleLeft = (sourceLeft[low] + (sourceLeft[next] - sourceLeft[low]) * fraction) * 32768;
    const sampleRight = (sourceRight[low] + (sourceRight[next] - sourceRight[low]) * fraction) * 32768;
    const envelopeLeft = multiplyPcmVolume(sampleLeft, volume);
    const envelopeRight = multiplyPcmVolume(sampleRight, volume);
    left[frame] += multiplyPcmVolume(envelopeLeft, mainLeft) / 32768;
    right[frame] += multiplyPcmVolume(envelopeRight, mainRight) / 32768;
    auxOutputLeft[frame] += multiplyPcmVolume(envelopeLeft, auxLeft) / 32768;
    auxOutputRight[frame] += multiplyPcmVolume(envelopeRight, auxRight) / 32768;
    voice.position += voice.speed;
  }
}
