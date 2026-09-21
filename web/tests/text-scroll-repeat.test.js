import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextScrollRepeat } from '../src/text-scroll-repeat.js';

test('text scroll repeat starts on press, waits sixty updates, then repeats every twenty', () => {
  let elapsed = 0;
  const events = [];
  const repeat = createTextScrollRepeat({
    advance: (frames) => { elapsed += frames; },
    activate: (id) => events.push([elapsed, id]),
  });
  repeat.hold('up');
  repeat.advance(59.5);
  assert.deepEqual(events, [[0, 'up']]);
  repeat.advance(40.5);
  assert.deepEqual(events, [[0, 'up'], [60, 'up'], [80, 'up'], [100, 'up']]);
  repeat.hover('up');
  repeat.advance(20);
  assert.deepEqual(events.at(-1), [120, 'up']);
  repeat.hover(null);
  repeat.advance(100);
  assert.equal(events.length, 5);
  repeat.hold('down');
  repeat.advance(30);
  repeat.release();
  repeat.advance(100);
  assert.deepEqual(events.at(-1), [220, 'down']);
});

test('a transition during a large update cancels subsequent repetitions', () => {
  let elapsed = 0;
  const events = [];
  const repeat = createTextScrollRepeat({
    advance: (frames) => {
      elapsed += frames;
      if (elapsed >= 60) repeat.release();
    },
    activate: () => events.push(elapsed),
  });
  repeat.hold('up');
  repeat.advance(200);
  assert.equal(elapsed, 200);
  assert.deepEqual(events, [0]);
});
