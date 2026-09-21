import test from 'node:test';
import assert from 'node:assert/strict';
import { createFramePacer } from '../src/frame-pacing.js';

test('high-refresh displays submit only 60 frames per second without long-term drift', () => {
  for (const refreshRate of [60, 75, 120, 144, 165, 240]) {
    const shouldRender = createFramePacer();
    let rendered = 0;
    for (let tick = 0; tick < refreshRate * 60; tick++) {
      if (shouldRender(tick * 1000 / refreshRate)) rendered++;
    }
    assert.equal(rendered, 3600, `${refreshRate} Hz`);
  }
});

test('slow displays and stalls render current time once, without catch-up bursts', () => {
  const shouldRender = createFramePacer();
  assert.equal(shouldRender(0), true);
  assert.equal(shouldRender(8.333), false);
  assert.equal(shouldRender(16.666), true);
  assert.equal(shouldRender(50), true);
  assert.equal(shouldRender(10000), true);
  assert.equal(shouldRender(10000), false);
  assert.equal(shouldRender(10008.333), false);
  assert.equal(shouldRender(10016.666), true);
  const slowDisplay = createFramePacer();
  for (let tick = 0; tick < 30; tick++) assert.equal(slowDisplay(tick * 1000 / 30), true);
});

test('small refresh timestamp jitter does not halve 60 Hz output or alternate 120 Hz gaps', () => {
  for (const refreshRate of [60, 120, 240]) {
    const shouldRender = createFramePacer();
    const rendered = [];
    for (let tick = 0; tick < refreshRate * 60; tick++) {
      const jitter = 0.22 * Math.sin(1.713 * tick) + 0.12 * Math.cos(0.61 * tick);
      const timestamp = tick * 1000 / refreshRate + jitter;
      if (shouldRender(timestamp)) rendered.push(timestamp);
    }
    assert.equal(rendered.length, 3600, `${refreshRate} Hz`);
    for (let index = 1; index < rendered.length; index++) {
      assert.ok(rendered[index] - rendered[index - 1] < 18, `${refreshRate} Hz gap`);
    }
  }
});

test('nearest refresh selection avoids phase-dependent 8/25 ms gaps under ordinary RAF jitter', () => {
  for (const initialPhase of [-1.5, -0.75, 0, 0.75, 1.5]) {
    const shouldRender = createFramePacer();
    const selected = [];
    for (let tick = 0; tick < 120 * 60; tick++) {
      const timestamp = tick === 0 ? initialPhase : tick * 1000 / 120 +
        0.7 * Math.sin(tick * 1.31) + 0.4 * Math.cos(tick * 0.51);
      if (shouldRender(timestamp)) selected.push(timestamp);
    }
    assert.equal(selected.length, 3600, `initial phase ${initialPhase}`);
    for (let index = 1; index < selected.length; index++) {
      const gap = selected[index] - selected[index - 1];
      assert.ok(gap > 14 && gap < 20, `initial phase ${initialPhase}: ${gap} ms gap`);
    }
  }
});

test('moving between refresh rates retains the 60 Hz budget and adapts without drift', () => {
  const shouldRender = createFramePacer();
  let selected = 0;
  let timestamp = 0;
  for (const rate of [120, 60, 144, 75, 240, 165, 60]) {
    const before = selected;
    for (let tick = 0; tick < rate * 10; tick++) {
      if (shouldRender(timestamp)) selected++;
      timestamp += 1000 / rate;
    }
    assert.ok(Math.abs(selected - before - 600) <= 1, `${rate} Hz transition`);
    assert.ok(Math.abs(selected - timestamp * 0.06) <= 1, `${rate} Hz total frame budget`);
  }
});

test('isolated missed callbacks and long suspension do not cause duplicate catch-up draws', () => {
  const shouldRender = createFramePacer();
  let renders = 0;
  for (let tick = 0; tick < 1200; tick++) {
    if (tick % 67 === 66) continue;
    const timestamp = tick * 1000 / 120;
    if (shouldRender(timestamp)) renders++;
    assert.equal(shouldRender(timestamp), false, 'same callback cannot consume another deadline');
  }
  assert.ok(renders <= 600 && renders >= 599);
  assert.equal(shouldRender(30000), true);
  assert.equal(shouldRender(30000), false);
  assert.equal(shouldRender(30008.333), false);
  assert.equal(shouldRender(30016.667), true);
});

test('invalid timestamps do not corrupt phase and a restarted clock resets its refresh samples', () => {
  const shouldRender = createFramePacer();
  assert.equal(shouldRender(NaN), false);
  assert.equal(shouldRender(Infinity), false);
  assert.equal(shouldRender(500), true);
  assert.equal(shouldRender(508.333), false);
  assert.equal(shouldRender(516.667), true);
  assert.equal(shouldRender(0), true);
  assert.equal(shouldRender(8.333), false);
  assert.equal(shouldRender(16.667), true);
});
