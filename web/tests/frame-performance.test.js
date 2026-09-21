import test from 'node:test';
import assert from 'node:assert/strict';
import { createFramePerformance } from '../src/frame-performance.js';

test('frame measurement excludes idle gaps and reports CPU separately from scheduling', () => {
  let time = 0;
  let reads = 0;
  const run = createFramePerformance({ time: () => { reads++; return time; } });
  run.begin(0);
  run.finish();
  assert.equal(reads, 0);
  run.start(3);
  run.begin(100);
  time += 2;
  assert.equal(run.finish(), null);
  time += 50;
  run.begin(117);
  time += 3;
  run.finish();
  time += 80;
  run.begin(151);
  time += 4;
  const result = run.finish();
  assert.equal(result.cpuMilliseconds.mean, 3);
  assert.equal(result.cpuMilliseconds.p95, 4);
  assert.equal(result.frameMilliseconds.samples, 2);
  assert.equal(result.frameMilliseconds.p50, 17);
  assert.equal(result.frameMilliseconds.p95, 34);
  assert.equal(run.active, false);
  assert.equal(reads, 6);
});

test('cancelled or restarted runs cannot retain stale samples', () => {
  let time = 0;
  const run = createFramePerformance({ time: () => time++ });
  for (const count of [1, 3601, NaN, 2.5]) assert.throws(() => run.start(count));
  run.start(3);
  run.begin(100);
  run.finish();
  run.cancel();
  assert.equal(run.finish(), null);
  assert.equal(run.result, null);
  run.start(2);
  run.begin(1000);
  run.finish();
  run.begin(1016);
  const result = run.finish();
  assert.equal(result.frames, 2);
  assert.equal(result.frameMilliseconds.mean, 16);
  assert.equal(result.cpuMilliseconds.mean, 1);
});

test('explicit pacing traces include skipped callbacks and stay bounded', () => {
  let time = 0;
  const run = createFramePerformance({ time: () => time++ });
  run.start(2);
  for (let tick = 0; tick < 30; tick++) run.candidate(100 + tick * 4, tick % 4 === 0);
  run.begin(100);
  run.finish();
  run.begin(116);
  const result = run.finish();
  assert.equal(result.callbacks.length, 16);
  assert.deepEqual(result.callbacks[0], { milliseconds: 0, rendered: true });
  assert.deepEqual(result.callbacks[1], { milliseconds: 4, rendered: false });
  run.candidate(200, true);
  assert.equal(result.callbacks.length, 16);
});
