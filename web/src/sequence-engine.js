/** Shared offline/worklet sequence mixer; native DSP equivalence remains under comparison. */
import { SequenceReverb } from './sequence-reverb.js';
import { bankNoteGain, sourceStep } from './sequence-mix.js';
import { renderVoiceBlock } from './sequence-voice.js';
export const SEQUENCE_SAMPLE_RATE = 32000;
export const SEQUENCE_BLOCK_FRAMES = 96;
export const SEQUENCE_AUX_LATENCY_FRAMES = 2 * SEQUENCE_BLOCK_FRAMES;

export function validateSequenceDefinition(definition, waves) {
  if (
    definition?.schemaVersion !== 1 ||
    definition.sampleRate !== SEQUENCE_SAMPLE_RATE ||
    (definition.loopEndTick !== null && (
      !Number.isInteger(definition.loopStartTick) ||
      !Number.isInteger(definition.loopEndTick) ||
      definition.loopStartTick < 0 ||
      definition.loopEndTick <= definition.loopStartTick ||
      definition.loopEndTick > 1000000
    )) ||
    !Array.isArray(definition.events) ||
    definition.events.length > 100000 ||
    !Array.isArray(definition.regions) ||
    definition.regions.length > 1024 ||
    !Number.isFinite(definition.gain) ||
    definition.gain < 0 ||
    definition.gain > 1
  ) {
    throw new Error('Unsupported background sequence definition.');
  }
  for (const [name, length] of [['attack', 128], ['sustain', 128], ['decibels', 965], ['pan', 257]]) {
    const table = definition.tables?.[name];
    if (!Array.isArray(table) || table.length !== length || table.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid background ${name} table.`);
    }
  }
  if (!Array.isArray(waves) || waves.length > 256) throw new Error('Invalid sequence waves.');
  for (const wave of waves) {
    if (
      !Number.isInteger(wave.rate) || wave.rate < 1000 || wave.rate > 192000 ||
      !Array.isArray(wave.channels) || ![1, 2].includes(wave.channels.length) ||
      !wave.channels[0]?.length || wave.channels[0].length > 20000000 ||
      wave.channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== wave.channels[0].length)
    ) throw new Error('Invalid decoded sequence wave.');
  }
  for (const region of definition.regions) {
    if (
      !Number.isInteger(region.wave) || !waves[region.wave] ||
      !Number.isFinite(region.tune) || region.tune <= 0 || region.tune > 16 ||
      !Array.isArray(region.envelope) || region.envelope.length !== 4 ||
      [...region.envelope, region.root, region.volume, region.pan].some(
        (value) => !Number.isInteger(value) || value < 0 || value > 127,
      )
    ) throw new Error('Invalid sequence instrument region.');
  }
  let lastTick = -1;
  for (const event of definition.events) {
    if (
      !Number.isInteger(event.tick) || event.tick < 0 || event.tick < lastTick ||
      event.tick > (definition.loopEndTick ?? 1000000) ||
      !Number.isInteger(event.track) || event.track < 0 || event.track > 15
    ) throw new Error('Invalid sequence event ordering.');
    lastTick = event.tick;
    if (event.kind === 'note') {
      if (
        !Number.isInteger(event.region) || !definition.regions[event.region] ||
        !Number.isInteger(event.length) || event.length < 0 || event.length > 1000000 ||
        (event.waitForEnd !== undefined && typeof event.waitForEnd !== 'boolean') ||
        (event.waitForEnd && (event.length !== 0 || definition.loopEndTick !== null)) ||
        [event.key, event.velocity].some((value) => !Number.isInteger(value) || value < 0 || value > 127)
      ) throw new Error('Invalid sequence note.');
    } else if (event.kind === 'tempo') {
      if (!Number.isInteger(event.value) || event.value < 1 || event.value > 1000) {
        throw new Error('Invalid sequence tempo.');
      }
    } else if (['volume', 'volume2', 'mainVolume', 'pan', 'auxA', 'auxB', 'auxC', 'mainSend',
      'attack', 'decay', 'sustain', 'release'].includes(event.kind)) {
      if (!Number.isInteger(event.value) || event.value < 0 || event.value > 127) {
        throw new Error('Invalid sequence controller.');
      }
    } else throw new Error(`Unsupported sequence event: ${event.kind}`);
  }
}

export class SequenceEngine {
  constructor(definition, waves, { auxiliary = 'local' } = {}) {
    if (!['local', 'external'].includes(auxiliary)) {
      throw new Error('Sequence auxiliary processing must be local or external.');
    }
    validateSequenceDefinition(definition, waves);
    this.definition = definition;
    this.waves = waves;
    this.tracks = Array.from({ length: 16 }, () => ({
      volume: 127, volume2: 127, pan: 64, mainSend: 127, auxA: 0, auxB: 0, auxC: 0,
      attack: null, decay: null, sustain: null, release: null,
    }));
    this.auxiliary = auxiliary;
    // Validate the original preset in either mode. External rendering exposes
    // dry/send buses; their owner supplies a persistent filter and transport.
    const reverb = definition.reverb ? new SequenceReverb(definition.reverb) : null;
    this.reverb = auxiliary === 'local' ? reverb : null;
    this.auxReturn = this.reverb
      ? [new Float32Array(SEQUENCE_AUX_LATENCY_FRAMES), new Float32Array(SEQUENCE_AUX_LATENCY_FRAMES)]
      : null;
    this.auxReturnPosition = 0;
    this.auxLeft = new Float32Array(SEQUENCE_BLOCK_FRAMES);
    this.auxRight = new Float32Array(SEQUENCE_BLOCK_FRAMES);
    this.mainVolume = 127;
    this.voices = [];
    this.samplePosition = 0;
    this.songTick = 0;
    this.elapsedTicks = 0;
    this.tempo = 120;
    this.tempoCounter = 416;
    this.eventIndex = 0;
    this.trackParsers = definition.events.some((event) => event.waitForEnd)
      ? Array.from({ length: 16 }, (_, track) => ({
        events: definition.events.filter((event) => event.track === track),
        index: 0,
        tick: 0,
        waitingForEnd: false,
      }))
      : null;
    this.pendingCompletions = [];
    this.blockPosition = 0;
    this.loopEventIndex = definition.events.findIndex((event) => event.tick >= definition.loopStartTick);
    this.loopCount = 0;
    this.blockOffset = 0;
    this.blockLeft = new Float32Array(SEQUENCE_BLOCK_FRAMES);
    this.blockRight = new Float32Array(SEQUENCE_BLOCK_FRAMES);
    this.blockReady = false;
  }

  dispatch(event) {
    if (event.kind === 'tempo') this.tempo = event.value;
    else if (event.kind === 'mainVolume') this.mainVolume = event.value;
    else if (event.kind !== 'note') {
      this.tracks[event.track][event.kind] = event.value;
    } else if (event.kind === 'note') {
      const region = this.definition.regions[event.region];
      const wave = this.waves[region.wave];
      if (this.voices.length >= 128) throw new Error('Sequence voice budget exceeded.');
      const track = this.tracks[event.track];
      this.voices.push({
        region,
        envelope: ['attack', 'decay', 'sustain', 'release'].map((name, index) =>
          track[name] ?? region.envelope[index],
        ),
        wave,
        track: event.track,
        position: 0,
        speed: sourceStep(wave.rate, region.tune * 2 ** ((event.key - region.root) / 12)),
        initialGain: bankNoteGain(event.velocity, region.volume),
        releaseTick: event.length ? this.elapsedTicks + event.length : Infinity,
        envelopeLevel: -904,
        envelopeState: 'attack',
      });
    }
  }

  dispatchTick() {
    if (this.trackParsers) {
      this.dispatchTrackTicks();
      this.songTick += 1;
      this.elapsedTicks += 1;
      return;
    }
    const events = this.definition.events;
    while (this.eventIndex < events.length && events[this.eventIndex].tick === this.songTick) {
      this.dispatch(events[this.eventIndex]);
      this.eventIndex += 1;
    }
    if (this.definition.loopEndTick !== null && this.songTick === this.definition.loopEndTick) {
      this.songTick = this.definition.loopStartTick;
      this.eventIndex = Math.max(0, this.loopEventIndex);
      this.loopCount += 1;
      while (this.eventIndex < events.length && events[this.eventIndex].tick === this.songTick) {
        this.dispatch(events[this.eventIndex]);
        this.eventIndex += 1;
      }
    }
    this.songTick += 1;
    this.elapsedTicks += 1;
  }

  dispatchTrackTicks() {
    for (const [track, parser] of this.trackParsers.entries()) {
      if (parser.waitingForEnd) {
        // SeqTrack::ParseNextTick (0x81505458) checks its entire channel list
        // before decrementing WAIT or parsing any subsequent command.
        if (this.voices.some((voice) => voice.track === track) ||
            this.pendingCompletions.some((voice) => voice.track === track)) continue;
        parser.waitingForEnd = false;
      }
      while (parser.index < parser.events.length && parser.events[parser.index].tick === parser.tick) {
        const event = parser.events[parser.index];
        this.dispatch(event);
        parser.index += 1;
        if (event.waitForEnd) {
          parser.waitingForEnd = true;
          break;
        }
      }
      if (!parser.waitingForEnd) parser.tick += 1;
    }
  }

  renderBlock() {
    const due = Math.floor(this.tempoCounter / 416);
    this.tempoCounter = this.tempoCounter % 416 + this.tempo;
    for (let tick = 0; tick < due; tick += 1) this.dispatchTick();
    // Native __AXOutNewFrame (0x815537E0) synchronizes DSP parameter blocks
    // before the sound-thread callback. New voice state reaches the next DSP
    // block, whose completed address returns on the following synchronization.
    // SoundThreadProc (0x8150C170) parses sequences before AxVoice::Update
    // removes completed channels. Keep that notification after this tick.
    if (this.pendingCompletions.length) {
      this.pendingCompletions = this.pendingCompletions.filter(
        (voice) => voice.readyAt > this.blockPosition,
      );
    }
    const left = this.blockLeft;
    const right = this.blockRight;
    left.fill(0);
    right.fill(0);
    this.auxLeft.fill(0);
    this.auxRight.fill(0);
    const tables = this.definition.tables;
    for (const voice of this.voices) {
      // The tick already consumed above owns this update's note-off boundary.
      if (this.elapsedTicks - 1 >= voice.releaseTick) voice.envelopeState = 'release';
      const track = this.tracks[voice.track];
      const gain = voice.initialGain * (track.volume / 127) ** 2 * (track.volume2 / 127) ** 2 *
        (this.mainVolume / 127) ** 2 * this.definition.gain;
      const pan = Math.max(-1, Math.min(1, (voice.region.pan - 64 + track.pan - 64) / 63));
      const panIndex = Math.floor((pan + 1) * 128 + 0.5);
      renderVoiceBlock(voice, tables, gain, {
        leftPan: tables.pan[panIndex],
        rightPan: tables.pan[256 - panIndex],
        mainSend: Math.fround(track.mainSend / 127),
        auxSend: Math.fround(track.auxA / 127),
      }, [left, right, this.auxLeft, this.auxRight]);
    }
    let retained = 0;
    for (const voice of this.voices) {
      if (voice.position < voice.wave.channels[0].length && voice.envelopeLevel > -904) {
        this.voices[retained] = voice;
        retained += 1;
      } else if (this.trackParsers && voice.envelopeLevel > -904) {
        this.pendingCompletions.push({
          track: voice.track,
          readyAt: this.blockPosition + 2 * SEQUENCE_BLOCK_FRAMES,
        });
      }
    }
    this.voices.length = retained;
    for (let frame = 0; frame < SEQUENCE_BLOCK_FRAMES; frame += 1) {
      if (this.reverb) {
        // __AXAuxInit/GetAuxAInput/GetAuxAOutput/ProcessAux (0x8155257C,
        // 0x81552690, 0x815526C4, 0x81552880) rotate three buffers. A DSP send
        // reaches the output two 96-sample blocks later. Keep that bus delay
        // separate from ReverbHi's own filters and optional pre-delay.
        const position = this.auxReturnPosition;
        left[frame] += this.auxReturn[0][position];
        right[frame] += this.auxReturn[1][position];
        this.auxReturn[0][position] =
          this.reverb.process(0, this.auxLeft[frame]);
        this.auxReturn[1][position] =
          this.reverb.process(1, this.auxRight[frame]);
        this.auxReturnPosition = (position + 1) % SEQUENCE_AUX_LATENCY_FRAMES;
      }
    }
    this.blockOffset = 0;
    this.blockReady = true;
    this.blockPosition += SEQUENCE_BLOCK_FRAMES;
  }

  render(left, right) {
    if (left.length !== right.length) throw new Error('Sequence output channels differ in length.');
    for (let frame = 0; frame < left.length; frame += 1) {
      if (!this.blockReady || this.blockOffset === SEQUENCE_BLOCK_FRAMES) this.renderBlock();
      left[frame] = this.blockLeft[this.blockOffset];
      right[frame] = this.blockRight[this.blockOffset];
      this.blockOffset += 1;
    }
    this.samplePosition += left.length;
  }

  renderBuses(mainLeft, mainRight, auxLeft, auxRight) {
    if (this.auxiliary !== 'external') {
      throw new Error('Separate sequence buses require external auxiliary processing.');
    }
    const outputs = [mainLeft, mainRight, auxLeft, auxRight];
    if (outputs.some((channel) => !(channel instanceof Float32Array)) ||
        outputs.some((channel) => channel.length !== mainLeft.length)) {
      throw new Error('Sequence buses require four equal-length Float32Array channels.');
    }
    // Use the same partial-block cursor as render(). Reading the current Aux
    // arrays after render() would lose sends whenever a request spans blocks.
    for (let frame = 0; frame < mainLeft.length; frame += 1) {
      if (!this.blockReady || this.blockOffset === SEQUENCE_BLOCK_FRAMES) this.renderBlock();
      mainLeft[frame] = this.blockLeft[this.blockOffset];
      mainRight[frame] = this.blockRight[this.blockOffset];
      auxLeft[frame] = this.auxLeft[this.blockOffset];
      auxRight[frame] = this.auxRight[this.blockOffset];
      this.blockOffset += 1;
    }
    this.samplePosition += mainLeft.length;
  }
}
