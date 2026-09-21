/** Finite, dry WSD voices through the common 32 kHz channel math. */
import { sourceStep } from './sequence-mix.js';
import { renderVoiceBlock } from './sequence-voice.js';

export function validateWsdDefinition(definition, waves) {
  if (definition?.schemaVersion !== 1 || definition.sourceKind !== 'wsd' ||
      definition.sampleRate !== 32000 || definition.outputMode !== 'stereo' ||
      definition.pitch !== 1 || definition.pan !== 64 || definition.surroundPan !== 0 ||
      definition.mainSend !== 127 ||
      JSON.stringify(definition.auxiliarySends) !== '[0,0,0]' ||
      JSON.stringify(definition.envelope) !== '[127,127,127,127]' ||
      !Number.isInteger(definition.archiveVolume) || definition.archiveVolume < 0 ||
      definition.archiveVolume > 127 || !Array.isArray(waves) || waves.length !== 1) {
    throw new Error('Unsupported finite WSD voice definition.');
  }
  const wave = waves[0];
  if (![32000, 44100].includes(wave.rate) || ![1, 2].includes(wave.channels?.length) ||
      !wave.channels[0]?.length || wave.channels[0].length > 32000 * 60 ||
      wave.channels.some((channel) => !(channel instanceof Float32Array) ||
        channel.length !== wave.channels[0].length)) {
    throw new Error('Unsupported finite WSD source wave.');
  }
  for (const [name, length] of [['attack', 128], ['sustain', 128], ['decibels', 965], ['pan', 257]]) {
    const table = definition.tables?.[name];
    if (!Array.isArray(table) || table.length !== length ||
        table.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid WSD ${name} table.`);
    }
  }
  // This bounded path admits the four verified dry voices, not arbitrary WSD
  // synthesis. Centered stereo sources require the original hard-pan ends.
  if (definition.tables.pan[0] !== 1 || definition.tables.pan[256] !== 0) {
    throw new Error('Unsupported WSD stereo pan endpoints.');
  }
}

export class WsdEngine {
  constructor(definition, waves) {
    validateWsdDefinition(definition, waves);
    this.definition = definition;
    this.wave = waves[0];
    this.voice = {
      wave: this.wave,
      position: 0,
      speed: sourceStep(this.wave.rate, definition.pitch),
      envelope: definition.envelope,
      envelopeLevel: -904,
      envelopeState: 'attack',
    };
    // WsdTrack::Parse starts length -1; the finite wave owns completion.
    // UpdateAllPlayers parses then updates its channel in the same callback
    // (0x815114B4, 0x8151153C). There is no sequence tick or extra initial block.
    this.frames = Math.ceil(this.wave.channels[0].length / this.voice.speed);
    this.gain = Math.fround(definition.archiveVolume / 127);
    this.block = Array.from({ length: 4 }, () => new Float32Array(96));
    this.blockOffset = 96;
  }

  renderBuses(...outputs) {
    if (outputs.length !== 4 || outputs.some((channel) => !(channel instanceof Float32Array)) ||
        outputs.some((channel) => channel.length !== outputs[0].length)) {
      throw new Error('WSD buses require four equal-length Float32Array channels.');
    }
    for (let frame = 0; frame < outputs[0].length; frame += 1) {
      if (this.blockOffset === 96) {
        this.block.forEach((channel) => channel.fill(0));
        // CalcAXPBMIX adds -1/+1 for the two source channels (0x814FB398–3BC).
        // At the admitted center pan each stereo channel goes to its own side;
        // mono uses the shared center-pan table coefficient on both sides.
        const pan = this.definition.tables.pan[this.wave.channels.length === 2 ? 0 : 128];
        renderVoiceBlock(this.voice, this.definition.tables, this.gain,
          { leftPan: pan, rightPan: pan, mainSend: 1, auxSend: 0 }, this.block);
        this.blockOffset = 0;
      }
      outputs.forEach((channel, index) => { channel[frame] = this.block[index][this.blockOffset]; });
      this.blockOffset += 1;
    }
  }
}
