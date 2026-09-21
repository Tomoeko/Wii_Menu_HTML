import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankNoteGain, envelopeCoefficient, envelopeDelta, multiplyPcmVolume, sendCoefficient, sourceStep,
} from '../src/sequence-mix.js';

test('bank note gain preserves original float32 boundaries before envelope quantization', () => {
  // Golden coefficients from executing Bank::NoteOn's original PPC operations.
  // Every pair differs by one from the previous double-precision expression.
  const checkpoints = [
    [39, 127, 3090],
    [50, 115, 4598],
    [78, 127, 12360],
    [100, 115, 18395],
    [103, 99, 16800],
    [123, 88, 21297],
    [125, 92, 22995],
  ];
  for (const [velocity, volume, coefficient] of checkpoints) {
    assert.equal(envelopeCoefficient(bankNoteGain(velocity, volume)), coefficient);
  }
  assert.equal(bankNoteGain(0, 127), 0);
  assert.equal(bankNoteGain(127, 0), 0);
  assert.equal(bankNoteGain(127, 127), 1);
});

test('AX envelope and send coefficients retain distinct full-scale divisors', () => {
  assert.equal(envelopeCoefficient(0), 0);
  assert.equal(envelopeCoefficient(0.5), 16383);
  assert.equal(envelopeCoefficient(1), 32767);
  assert.equal(sendCoefficient(0), 0);
  assert.equal(sendCoefficient(0.5), 16384);
  assert.equal(sendCoefficient(1), 32768);
  assert.equal(sendCoefficient(2), 65535);
});

test('signed DSP products discard low bits toward negative infinity', () => {
  const samples = [1, -1, 3, -3, 1001, -1001];
  assert.deepEqual(samples.map((sample) => multiplyPcmVolume(sample, 16383)),
    [0, -1, 1, -2, 500, -501]);
  assert.equal(multiplyPcmVolume(-32768, 65535), -65535);
  assert.equal(multiplyPcmVolume(32767, 65535), 65533);
});

test('coefficient conversion rounds to float32 before truncating the integer', () => {
  // Values immediately below unity round to the original CPU's float32 one.
  assert.equal(envelopeCoefficient(1 - 2 ** -26), 32767);
  assert.equal(sendCoefficient(1 - 2 ** -26), 32768);
});

test('AX envelope deltas truncate signed changes over 96 samples', () => {
  assert.equal(envelopeDelta(0, 32767), 341);
  assert.equal(envelopeDelta(32767, 0), -341);
  assert.equal(envelopeDelta(0, 95), 0);
  assert.equal(envelopeDelta(95, 0), 0);
  assert.equal(envelopeDelta(32767, 32767), 0);
});

test('source stepping uses unsigned 16.16 after the original float32 operations', () => {
  assert.equal(sourceStep(32000, 1), 1);
  assert.equal(sourceStep(16000, 1), 0.5);
  assert.equal(sourceStep(44100, 1), 90316 / 65536);
  assert.equal(sourceStep(32000, 1 - 2 ** -26), 1);
  assert.equal(sourceStep(32000, 1 / 131072), 0);
  assert.equal(sourceStep(192000, 20000), 0xffffffff / 65536);
});
