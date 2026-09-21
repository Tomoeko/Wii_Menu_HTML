import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInspectionClock,
  createInspectionSoundTrace,
  createMenuInspection,
} from '../src/menu-inspection.js';

test('recording includes the accepted action at zero and every fixed update through completion', () => {
  const clock = createInspectionClock();
  clock.setPaused(true);
  clock.start(28);
  const samples = [];
  let elapsed = 0;
  for (let index = 0; index <= 28; index++) {
    elapsed += clock.delta(index % 2 ? 83 : 1);
    samples.push(clock.rendered());
  }
  assert.equal(samples[0].frame, 0);
  assert.equal(samples.at(-1).frame, 28);
  assert.equal(samples.at(-1).final, true);
  assert.ok(Math.abs(elapsed - 28 * 1000 / 60) < 1e-8);
  assert.equal(clock.delta(200), 0);
  assert.equal(clock.rendered(), null);
});

test('paused inspection steps once and preserves ordinary measured timing after resume', () => {
  const clock = createInspectionClock();
  assert.equal(clock.delta(17), 17);
  clock.setPaused(true);
  assert.equal(clock.delta(17), 0);
  clock.step();
  assert.equal(clock.delta(17), 1000 / 60);
  assert.equal(clock.delta(17), 0);
  clock.setPaused(false);
  assert.equal(clock.delta(23), 23);
  for (const count of [0, 601, NaN, 1.2]) assert.throws(() => clock.start(count));
});

test('sound trace keeps bounded ordered requests and copies only supported scalar metadata', () => {
  let time = 10;
  const trace = createInspectionSoundTrace({ capacity: 3, time: () => time });
  const options = { gain: 0.5, pan: -0.25, pitch: 1, speed: 2, loop: true,
    privateText: 'not exported', asset: { src: '/private.wav' }, buffer: new ArrayBuffer(4) };
  for (let index = 0; index < 5; index++) {
    time += 10;
    trace.record({ operation: 'play', symbol: 'buttonHover',
      sourceSymbol: 'WIPL_SE_BT_TARGETTING', options });
  }
  options.gain = 1;
  const snapshot = trace.snapshot();
  assert.equal(snapshot.total, 5);
  assert.equal(snapshot.dropped, 2);
  assert.equal(snapshot.startedAtMs, 10);
  assert.deepEqual(snapshot.requests.map(({ sequence, logicalTimeMs }) =>
    [sequence, logicalTimeMs]), [[3, 40], [4, 50], [5, 60]]);
  assert.deepEqual(snapshot.requests[0].options,
    { gain: 0.5, pan: -0.25, pitch: 1, speed: 2, loop: true });
  assert.doesNotMatch(JSON.stringify(snapshot), /private|buffer|asset|not exported/);
  snapshot.requests[0].options.gain = 9;
  assert.equal(trace.snapshot().requests[0].options.gain, 0.5);
  trace.reset();
  assert.deepEqual(trace.snapshot().requests, []);
  assert.equal(trace.snapshot().total, 0);
  assert.equal(trace.snapshot().dropped, 0);
  assert.equal(trace.snapshot().startedAtMs, 60);
  trace.record({ operation: 'play', symbol: '/private/file', sourceSymbol: 'private text',
    options: { gain: Infinity, pitch: NaN, loop: 'no' } });
  assert.deepEqual(trace.snapshot().requests[0], {
    sequence: 1, logicalTimeMs: 60, operation: 'play', symbol: null, sourceSymbol: null, options: {},
  });
});

function inspectionEnvironment(t) {
  const target = (value = '') => {
    const listeners = new Map();
    return {
      value, style: {}, textContent: '',
      getBoundingClientRect: () => ({ height: 190 }),
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      },
      dispatch(type, properties = {}) {
        const event = { type, preventDefault() {}, stopPropagation() {}, ...properties };
        for (const callback of listeners.get(type) ?? []) callback(event);
      },
    };
  };
  const fields = new Map(['tools', 'result', 'pause', 'step', 'record', 'trigger', 'length',
    'save', 'sounds', 'sounds-reset'].map((id) => [id, target()]));
  fields.get('length').value = '1';
  fields.get('trigger').value = 'click';
  const document = { ...target(), getElementById: (id) => fields.get(id.replace('inspection-', '')) };
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const captures = [];
  globalThis.document = document;
  globalThis.fetch = async (_url, request) => {
    captures.push(JSON.parse(request.body));
    return { ok: true, json: async () => ({ path: `capture-${captures.length}` }) };
  };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  });
  const screen = target();
  const canvas = { toDataURL: () => 'data:image/png;base64,c3ludGhldGlj' };
  return { fields, document, captures, screen, canvas };
}

test('the ordinary application creates no inspection trace or event listeners', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
    addEventListener: () => assert.fail('normal application must not install inspection listeners'),
  };
  t.after(() => { globalThis.document = previousDocument; });
  assert.equal(createMenuInspection({}), null);
});

test('keyboard capture shortcuts preserve paused time and wait for the next pointer action', async (t) => {
  const env = inspectionEnvironment(t);
  const inspection = createMenuInspection(env);
  const display = { aspectRatio: '4:3', width: 608, height: 456, outputAspect: 4 / 3 };
  const request = { operation: 'play', symbol: 'buttonHover', sourceSymbol: 'WIPL_SE_BT_TARGETTING' };
  inspection.setDisplay(display);
  assert.match(env.screen.style.height, /190px/);
  inspection.date(inspection.delta(25));
  inspection.rendered({ display });
  inspection.soundRequest(request);
  inspection.soundRequest(request);
  assert.match(env.fields.get('sounds').textContent, /Sound requests: 2/);
  env.fields.get('pause').dispatch('click');
  inspection.date(inspection.delta(200));
  inspection.soundRequest(request);
  let prevented = false;
  env.document.dispatch('keydown', { key: 'F8', preventDefault: () => { prevented = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(env.captures.length, 1);
  assert.equal(env.captures[0].comparison.soundRequests.total, 3,
    'F8 includes requests occurring after the last rendered frame');
  assert.deepEqual(env.captures[0].comparison.soundRequests.requests
    .map(({ logicalTimeMs }) => logicalTimeMs), [25, 25, 25]);

  env.fields.get('sounds-reset').dispatch('click');
  assert.match(env.fields.get('sounds').textContent, /Sound requests: 0/);
  env.document.dispatch('keydown', { key: 'F7' });
  assert.match(env.fields.get('result').textContent, /Armed/);
  assert.equal(env.captures.length, 1, 'arming does not capture or require toolbar focus');
  env.screen.dispatch('click');
  inspection.soundRequest(request);
  inspection.date(inspection.delta(99));
  inspection.rendered({ display });
  inspection.date(inspection.delta(99));
  inspection.soundRequest({ ...request, symbol: 'WIPL_SE_BT_TARGETTING' });
  inspection.rendered({ display });
  await new Promise((resolve) => setImmediate(resolve));
  const sequence = env.captures.slice(1);
  assert.equal(sequence.length, 2);
  assert.deepEqual(sequence.map(({ comparison }) => comparison.soundRequests.total), [1, 2]);
  assert.equal(sequence[0].comparison.soundRequests.logicalTimeMs, 25);
  assert.equal(sequence[1].comparison.soundRequests.logicalTimeMs, 25 + 1000 / 60);
  assert.equal(sequence[1].comparison.sequenceManifest.complete, true);
});
