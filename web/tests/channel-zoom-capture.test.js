import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChannelZoomCapture,
  warmChannelZoomPrograms,
} from '../src/channel-zoom-capture.js';

test('shader warmup compiles each needed preview program once', () => {
  const programs = [];
  const renderer = { program: (material) => programs.push(material) };
  const plain = { textureMaps: [] };
  const textured = { textureMaps: [{}] };
  const texturedVariant = { textureMaps: [{}], colors: [[50, 80, 100, 255]] };
  assert.equal(warmChannelZoomPrograms(renderer, [
    { materials: [plain, textured] },
    null,
    { materials: [texturedVariant, plain] },
  ]), 2);
  assert.deepEqual(programs, [plain, textured]);
});

test('a malformed optional material does not prevent other previews from warming', () => {
  const failed = { textureMaps: [{}, {}] };
  const malformed = { tevStages: { length: 1 } };
  const good = { textureMaps: [] };
  const errors = [];
  const renderer = {
    program(material) {
      if (material === failed) throw new Error('Unsupported material');
    },
  };
  assert.equal(warmChannelZoomPrograms(renderer, [
    { name: 'broken', materials: [failed, malformed] },
    { name: 'good', materials: [good] },
  ], (error, layout) => errors.push([error.message, layout])), 1);
  assert.deepEqual(errors.map(([message, layout]) => [Boolean(message), layout]), [
    [true, 'broken'],
    [true, 'broken'],
  ]);
});

test('hover reuse is exact-keyed, while immediate entry and Back refresh the retained target', () => {
  const calls = [];
  const renderer = {
    capture(draw, { reuse } = {}) {
      const handle = reuse ?? { id: 1 };
      calls.push({ type: 'capture', handle });
      draw();
      return handle;
    },
    releaseCapture(handle) {
      calls.push({ type: 'release', handle });
    },
  };
  const zoom = createChannelZoomCapture(renderer);
  let draws = 0;
  const channel = { id: 'disc' };
  const key = {
    index: 0,
    channel,
    date: 'Fri Sep 25 2026',
    rasterWidth: 1280,
    rasterHeight: 720,
    displayWidth: 832,
    displayHeight: 456,
  };
  zoom.prewarm();
  zoom.prewarm();
  assert.equal(calls.filter((call) => call.type === 'capture').length, 1);
  assert.equal(zoom.current, null, 'a blank prewarm is never a usable preview');

  const first = zoom.update(() => draws++, { key });
  assert.equal(draws, 1);
  assert.equal(zoom.matches({ ...key }), true, 'SELECT reuses the hovered frame-zero preview');
  assert.equal(zoom.matches({}), false, 'incomplete keys never reuse stale content');
  assert.equal(zoom.update(() => draws++), first);
  assert.equal(draws, 1, 'select retains its first composited preview');

  for (const changed of [
    { index: 1 },
    { channel: { id: 'disc' } },
    { date: 'Sat Sep 26 2026' },
    { rasterWidth: 2560 },
    { rasterHeight: 1440 },
    { displayWidth: 608 },
    { displayHeight: 480 },
  ]) assert.equal(zoom.matches({ ...key, ...changed }), false);

  zoom.update(() => draws++, { key: { ...key, index: 1 } });
  assert.equal(draws, 2, 'a changed slot cannot display the prior hovered channel');
  zoom.invalidate();
  assert.equal(zoom.current, null);
  assert.equal(zoom.update(() => draws++), first);
  assert.equal(draws, 3, 'an immediate click refreshes when no hover capture is valid');

  assert.equal(zoom.update(() => draws++, { refresh: true }), first);
  assert.equal(zoom.update(() => draws++, { refresh: true }), first);
  assert.equal(draws, 5, 'Back refreshes the animated banner each frame');
  assert.equal(new Set(calls.filter((call) => call.type === 'capture')
    .map((call) => call.handle)).size, 1);
  zoom.release();
  zoom.release();
  assert.equal(calls.filter((call) => call.type === 'release').length, 1);
  assert.equal(zoom.current, null);
});
