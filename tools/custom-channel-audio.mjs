/** Original example composition, synthesized locally without external samples.
 * Five short bell-like notes accompany the example banner's entrance. */
export function createExampleAudio() {
  const sampleRate = 32000;
  const duration = 2.4;
  const notes = [
    { start: 0.06, frequency: 523.251, gain: 0.19, pan: -0.35 },
    { start: 0.25, frequency: 783.991, gain: 0.15, pan: 0.3 },
    { start: 0.47, frequency: 659.255, gain: 0.16, pan: -0.15 },
    { start: 0.75, frequency: 1174.659, gain: 0.11, pan: 0.35 },
    { start: 1.02, frequency: 880, gain: 0.14, pan: 0 },
  ];
  const frames = Math.round(sampleRate * duration);
  const pcm = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / sampleRate;
    const channels = [0, 0];
    for (const note of notes) {
      const elapsed = time - note.start;
      if (elapsed < 0 || elapsed > 1.2) continue;
      const attack = Math.min(1, elapsed / 0.012);
      const release = Math.min(1, Math.max(0, (1.2 - elapsed) / 0.15));
      const envelope = attack * Math.exp(-elapsed * 5) * release * note.gain;
      const phase = 2 * Math.PI * note.frequency * elapsed;
      const sample = envelope * (Math.sin(phase) + 0.18 * Math.sin(phase * 2.01));
      channels[0] += sample * Math.sqrt((1 - note.pan) / 2);
      channels[1] += sample * Math.sqrt((1 + note.pan) / 2);
    }
    channels.forEach((sample, channel) => {
      pcm.writeInt16LE(
        Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
        frame * 4 + channel * 2,
      );
    });
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
