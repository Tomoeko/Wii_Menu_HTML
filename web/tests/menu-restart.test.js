import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuRestart } from '../src/menu-restart.js';
import { createMenuAudioSync } from '../src/menu-audio.js';
import { createMenuState } from '../src/menu-state.js';

const source = {
  root: { name: 'Root', alpha: 255, flags: 1, children: [] },
  materials: [],
  animations: { my_BackToWiiMenu: { frames: 1000, loop: true, targets: [] } },
};

test('HOME return retains the original loading stage through fade and black service handoff', async () => {
  const events = [];
  const restart = createMenuRestart(source, {
    onGrid: () => events.push('grid'),
    onComplete: () => events.push('complete'),
  });
  assert.equal(restart.start(), true);
  assert.equal(restart.start(), false);
  await Promise.resolve();
  restart.advance(93);
  assert.equal(restart.sample().phase, 'loading');
  assert.equal(restart.sample().alpha, 0);
  assert.ok(restart.pose());
  restart.advance(1);
  assert.equal(restart.sample().phase, 'out');
  restart.advance(22);
  assert.equal(restart.sample().alpha, 255);
  assert.ok(restart.pose(), 'the loading layout remains owned until fade completion');
  restart.advance(1);
  assert.equal(restart.sample().phase, 'black');
  assert.equal(restart.pose(), null);
  restart.advance(42);
  assert.deepEqual(events, []);
  restart.advance(1);
  assert.deepEqual(events, ['grid']);
  assert.equal(restart.sample().alpha, 255);
  restart.advance(21);
  assert.equal(restart.active, true);
  restart.advance(1);
  assert.deepEqual(events, ['grid', 'complete']);
  assert.equal(restart.active, false);
});

test('real browser readiness extends the loading stage and failure never reveals a partial menu', async () => {
  let ready;
  const restart = createMenuRestart(source);
  restart.start({ ready: new Promise((resolve) => (ready = resolve)) });
  restart.advance(1200);
  assert.equal(restart.sample().phase, 'loading');
  assert.ok(restart.pose());
  ready();
  await Promise.resolve();
  restart.advance(1);
  assert.equal(restart.sample().phase, 'out');

  const errors = [];
  const failed = createMenuRestart(source, { onError: (error) => errors.push(error.message) });
  failed.start({ ready: Promise.reject(new Error('Resource unavailable')) });
  await Promise.resolve();
  failed.advance(1000);
  assert.equal(failed.sample().phase, 'loading');
  assert.deepEqual(errors, ['Resource unavailable']);
});

test('fractional display ticks preserve the same native phase boundaries', async () => {
  const regular = createMenuRestart(source);
  const fractional = createMenuRestart(source);
  regular.start();
  fractional.start();
  await Promise.resolve();
  regular.advance(173);
  for (let index = 0; index < 346; index++) fractional.advance(0.5);
  assert.deepEqual(fractional.sample(), regular.sample());
  assert.equal(fractional.sample().phase, 'grid');
});

test('grid handoff reports the remainder needed to align icon and footer clocks', async () => {
  const calls = [];
  const restart = createMenuRestart(source, { onGrid: (value) => calls.push(value) });
  restart.start();
  await Promise.resolve();
  restart.advance(158.5);
  restart.advance(4);
  assert.deepEqual(calls, [{ remainingFrames: 2.5 }]);
  assert.equal(restart.sample().frame, 2.5);
});

test('a zero black-service fixture adds no extra hidden update', async () => {
  const restart = createMenuRestart(source, { readyFrames: 0, blackFrames: 0 });
  restart.start();
  await Promise.resolve();
  restart.advance(22 + 23);
  assert.equal(restart.sample().phase, 'grid');
  assert.equal(restart.sample().frame, 0);
});

test('restart stops the paused old soundtrack and starts the new menu only at grid handoff', async () => {
  const calls = [];
  const audio = Object.fromEntries(
    [
      'pauseMenuAudio',
      'resumeMenuAudio',
      'startBackground',
      'stopBackground',
      'pauseBackground',
      'stopChannel',
    ].map((name) => [name, () => calls.push(name)]),
  );
  const menu = createMenuState({ channels: [{ id: 'disc', title: 'Disc Channel' }] });
  const sync = createMenuAudioSync(audio);
  sync(menu.getState());
  menu.openHome();
  menu.advance(1000);
  sync(menu.getState(), { homeSoundInitialized: true });
  const restart = createMenuRestart(source, {
    onGrid() {
      menu.finishHome({ returnToMenu: true });
      sync(menu.getState());
    },
  });
  restart.start();
  sync({ ...menu.getState(), screen: 'restarting', overlay: null, transition: null });
  await Promise.resolve();
  restart.advance(159);
  assert.equal(calls.filter((name) => name === 'startBackground').length, 1);
  restart.advance(1);
  assert.equal(calls.filter((name) => name === 'startBackground').length, 2);
  assert.equal(calls.filter((name) => name === 'stopBackground').length, 1);
  assert.equal(menu.getState().screen, 'grid');
  assert.equal(menu.getState().overlay, null);
});
