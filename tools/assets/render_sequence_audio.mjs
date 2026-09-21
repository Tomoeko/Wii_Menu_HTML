/** Render the browser's shared sequence kernel with only Node built-in modules. */
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SequenceEngine } from '../../web/src/sequence-engine.js';
import { readLocalSequenceResources } from './sequence_resources.mjs';

const [definitionPath, outputPath] = process.argv.slice(2);
if (!definitionPath || !outputPath) throw new Error('Expected sequence definition and output WAV paths.');
const assets = resolve(dirname(definitionPath), '..');
const { definition, waves } = await readLocalSequenceResources(definitionPath, assets);
const engine = new SequenceEngine(definition, waves);
const frames = definition.offline.frames;
if (!Number.isInteger(frames) || frames < 1 || frames > 32000 * 600) {
  throw new Error('Invalid offline background duration.');
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + frames * 4, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(32000, 24);
header.writeUInt32LE(128000, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(frames * 4, 40);
const output = await open(outputPath, 'w');
let peak = 0;
let lastAudibleFrame = -1;
let outputFrames = frames;
try {
  await output.write(header);
  for (let position = 0; position < frames; position += 8192) {
    const count = Math.min(8192, frames - position);
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    engine.render(left, right);
    const bytes = Buffer.alloc(count * 4);
    for (let frame = 0; frame < count; frame += 1) {
      const leftSample = left[frame] * 32768;
      const rightSample = right[frame] * 32768;
      peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
      const pcmLeft = Math.max(-32768, Math.min(32767, Math.round(leftSample)));
      const pcmRight = Math.max(-32768, Math.min(32767, Math.round(rightSample)));
      if (pcmLeft || pcmRight) lastAudibleFrame = position + frame;
      bytes.writeInt16LE(pcmLeft, frame * 4);
      bytes.writeInt16LE(pcmRight, frame * 4 + 2);
    }
    await output.write(bytes);
  }
  if (definition.offline.trimSilence) {
    // Remove only quantized zero samples after the final audible reverb tail.
    // This keeps preloaded effects small without inventing a fade or cutoff.
    outputFrames = Math.max(1, lastAudibleFrame + 1);
    header.writeUInt32LE(36 + outputFrames * 4, 4);
    header.writeUInt32LE(outputFrames * 4, 40);
    await output.write(header, 0, header.length, 0);
    await output.truncate(44 + outputFrames * 4);
  }
} finally {
  await output.close();
}
process.stdout.write(JSON.stringify({ peakBeforePcmClipping: peak, frames: outputFrames }) + '\n');
