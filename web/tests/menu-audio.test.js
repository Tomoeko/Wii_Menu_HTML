import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuState, DEFAULT_TIMING } from '../src/menu-state.js';
import { createMenuAudioSync } from '../src/menu-audio.js';

test('Message Board, SD Menu and settings keep the same background track playing', () => {
  const calls = [];
  const audio = Object.fromEntries(
    [
      'startBackground',
      'stopBackground',
      'pauseBackground',
      'playChannel',
      'stopChannel',
      'pauseMenuAudio',
      'resumeMenuAudio',
    ].map((name) => [name, () => calls.push(name)]),
  );
  const menu = createMenuState({ timing: { settings: 0 } });
  menu.subscribe(createMenuAudioSync(audio));
  menu.openBoard();
  menu.back();
  menu.openSettings();
  menu.back();
  menu.openSD();
  menu.back();
  assert.deepEqual(calls, ['startBackground']);
});

test('HOME preserves preview identity and never replays its banner or resets its timeline', () => {
  const calls = [],
    starts = [];
  const audio = Object.fromEntries(
    [
      'startBackground',
      'stopBackground',
      'pauseBackground',
      'playChannel',
      'stopChannel',
      'pauseMenuAudio',
      'resumeMenuAudio',
    ].map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  const menu = createMenuState({ channels: [{ id: 'mii', audio: { src: '/mii.wav' } }] });
  const sync = createMenuAudioSync(audio, { onPreviewStart: (index) => starts.push(index) });
  menu.subscribe(sync);
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter / 2);
  assert.equal(calls.some(([name]) => name === 'pauseMenuAudio'), false);
  menu.advance(DEFAULT_TIMING.homeEnter / 2);
  sync(menu.getState(), { homeSoundInitialized: true });
  menu.closeHome();
  menu.advance(DEFAULT_TIMING.homeExit);
  assert.deepEqual(starts, [0]);
  assert.equal(calls.filter((call) => call[0] === 'playChannel').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'stopChannel').length, 0);
  assert.deepEqual(
    calls.filter((call) => /MenuAudio$/.test(call[0])),
    [['pauseMenuAudio'], ['resumeMenuAudio']],
  );
  menu.back();
  assert.deepEqual(calls.at(-1), ['stopChannel', (28 * 1000) / 60]);
  assert.equal(calls.filter((call) => call[0] === 'startBackground').length, 1);
  menu.advance(DEFAULT_TIMING.back);
  assert.deepEqual(calls.at(-1), ['startBackground']);
});

test('changing previews cancels the previous channel once and starts the next only after its transition', () => {
  const calls = [],
    audio = Object.fromEntries(
      [
        'startBackground',
        'stopBackground',
        'pauseBackground',
        'playChannel',
        'stopChannel',
        'pauseMenuAudio',
        'resumeMenuAudio',
      ].map((name) => [name, (...args) => calls.push([name, ...args])]),
    );
  const menu = createMenuState({
    channels: [
      { id: 'mii', audio: { src: '/mii.wav' } },
      { id: 'photo', audio: { src: '/photo.wav' } },
    ],
  });
  menu.subscribe(createMenuAudioSync(audio));
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  menu.changePreview(1);
  menu.advance(DEFAULT_TIMING.preview / 2 - 1);
  assert.equal(calls.filter((call) => call[0] === 'stopChannel').length, 0);
  menu.advance(1);
  assert.equal(calls.filter((call) => call[0] === 'playChannel').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'stopChannel').length, 1);
  menu.advance(DEFAULT_TIMING.preview / 2);
  assert.deepEqual(calls.at(-1), ['playChannel', 'photo', { src: '/photo.wav' }]);
});

test('base intro starts once after ChangeOut while module time preserves the ten-frame lead', () => {
  const starts = [],
    audio = Object.fromEntries(
      [
        'startBackground',
        'stopBackground',
        'pauseBackground',
        'playChannel',
        'stopChannel',
        'pauseMenuAudio',
        'resumeMenuAudio',
      ].map((name) => [name, () => {}]),
    );
  const menu = createMenuState({ channels: [{ id: 'mii' }, { id: 'photo' }] });
  const sync = createMenuAudioSync(audio, { onPreviewStart: (...args) => starts.push(args) });
  menu.subscribe(sync);
  menu.selectChannel(0);
  menu.advance(DEFAULT_TIMING.select);
  menu.changePreview(1);
  menu.advance(DEFAULT_TIMING.preview / 2);
  assert.deepEqual(starts, [[0, { navigated: false, moduleLeadFrames: 0 }]]);
  menu.advance(DEFAULT_TIMING.preview / 2);
  assert.deepEqual(starts[1], [1, { navigated: true, moduleLeadFrames: 10 }]);
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter);
  sync(menu.getState(), { homeSoundInitialized: true });
  menu.closeHome();
  menu.advance(DEFAULT_TIMING.homeExit);
  assert.equal(starts.length, 2);
});

test('Disc starts its original no-disc cue under the same preview lifetime as other channels', () => {
  const calls = [];
  const asset = { src: '/disc.wav', sourceSymbol: 'WIPL_ME_NO_DISC_BANNER' };
  const audio = Object.fromEntries(
    [
      'startBackground',
      'stopBackground',
      'pauseBackground',
      'stopChannel',
      'pauseMenuAudio',
      'resumeMenuAudio',
      'playChannel',
    ].map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  audio.asset = (name) => (name === 'discPreview' ? asset : null);
  const menu = createMenuState({ channels: [{ id: 'disc' }] });
  const sync = createMenuAudioSync(audio);
  menu.subscribe(sync);
  menu.selectChannel(0);
  assert.equal(
    calls.some(([name]) => name === 'playChannel'),
    false,
  );
  menu.advance(DEFAULT_TIMING.select);
  assert.deepEqual(calls.at(-1), ['playChannel', 'disc', asset]);
  menu.openHome();
  menu.advance(DEFAULT_TIMING.homeEnter);
  sync(menu.getState(), { homeSoundInitialized: true });
  menu.closeHome();
  menu.advance(DEFAULT_TIMING.homeExit);
  assert.equal(calls.filter(([name]) => name === 'playChannel').length, 1);
  menu.back();
  assert.deepEqual(calls.at(-1), ['stopChannel', (28 * 1000) / 60]);
});
