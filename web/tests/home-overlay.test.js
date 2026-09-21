import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHomeOverlay } from '../src/home-overlay.js';
import { indexLayout } from '../src/animation.js';
import { advanceHomeBoundary, createMenuRestart } from '../src/menu-restart.js';
import { defaultRemoteState } from '../src/remote-state.js';

const resource = new URL('../public/assets/layouts/homeBtn1/th_HomeBtn_d.json', import.meta.url);
const source = existsSync(resource) ? JSON.parse(readFileSync(resource)) : null;

test(
  'HOME uses the source entrance positions and fades exactly one backdrop',
  { skip: !source },
  () => {
    const home = createHomeOverlay(source);
    const start = indexLayout(home.pose({ phase: 'enter', frame: 0 }).layout).panes;
    const end = indexLayout(home.pose().layout).panes;
    assert.equal(start.get('bar_00').translation[1], 310);
    assert.equal(end.get('bar_00').translation[1], 230);
    assert.equal(end.get('bar_10').translation[1], -236);
    assert.equal(start.get('back_00').alpha, 0);
    assert.equal(end.get('back_00').alpha, 255);
    assert.equal(end.get('back_02').flags & 1, 0);
    assert.equal(end.get('let_icn_00').flags & 1, 0);
  },
);

test(
  'HOME close flashes its header for 19 updates before retracting through update 38',
  { skip: !source },
  () => {
    const home = createHomeOverlay(source);
    const at = (frame) => home.pose({ phase: 'leave', frame });
    const panesAt = (frame) => indexLayout(at(frame).layout).panes;
    assert.equal(home.leaveFrames, 39);
    for (const frame of [0, 1, 10, 18, 19]) {
      const panes = panesAt(frame);
      assert.equal(panes.get('back_00').alpha, 255);
      assert.equal(panes.get('bar_00').translation[1], 230);
      assert.equal(at(frame).ready, false);
    }
    assert.deepEqual(panesAt(10).get('bar_00').vertexColors[0], [255, 255, 255, 255]);
    const firstRetraction = panesAt(20);
    assert.ok(Math.abs(firstRetraction.get('back_00').alpha - 253.15125) < 1e-8);
    assert.ok(Math.abs(firstRetraction.get('bar_00').translation[1] - 230.58) < 1e-8);
    const lastRetraction = panesAt(38);
    // Each HBM controller stops at GetFrameMax()-1; update 39 hides the scene.
    assert.ok(Math.abs(lastRetraction.get('back_00').alpha - 1.84875) < 1e-8);
    assert.ok(Math.abs(lastRetraction.get('bar_00').translation[1] - 309.42) < 1e-8);
    assert.deepEqual(at(39).layout, at(38).layout);
    assert.equal(at(39).ready, false);
  },
);

test(
  'remote settings respect separate lift/window groups and expose their native bounds',
  { skip: !source },
  () => {
    const home = createHomeOverlay(source);
    const lifting = indexLayout(home.pose({ optionsOpen: true, optionsFrame: 8 }).layout).panes;
    assert.equal(lifting.get('W_cntrl_00').size[0], 0);
    const opened = home.pose({ optionsOpen: true, optionsFrame: 41 });
    const panes = indexLayout(opened.layout).panes;
    assert.equal(panes.get('N_cntrl_00').translation[1], 38);
    assert.equal(panes.get('W_cntrl_00').size[0], 511.5);
    assert.ok(Math.abs(panes.get('N_opton_all').alpha - 247.86) < 1e-8);
    assert.ok(opened.controls.some((control) => control.action === 'volume-down'));
    assert.ok(opened.controls.some((control) => control.action === 'volume-up'));
    assert.ok(opened.controls.every((control) => panes.has(control.pane)));
    assert.equal(indexLayout(source).panes.get('W_cntrl_00').size[0], 0);
  },
);

test(
  'remote settings close through the original window shrink, remote descent, and label fades',
  { skip: !source },
  () => {
    const home = createHomeOverlay(source);
    const at = (frame) => home.pose({ optionsClosing: true, optionsFrame: frame });
    const start = indexLayout(at(0).layout).panes;
    assert.equal(start.get('W_cntrl_00').size[0], 511.5);
    assert.equal(start.get('N_cntrl_00').translation[1], 38);
    assert.equal(start.get('tx_cntrl_01').alpha, 255);
    assert.equal(start.get('tx_cntrl_00').alpha, 0);
    const shrink = indexLayout(at(10).layout).panes;
    assert.ok(shrink.get('W_cntrl_00').size[0] > 0 && shrink.get('W_cntrl_00').size[0] < 511.5);
    assert.equal(shrink.get('N_opton_all').alpha, 0);
    const descent = indexLayout(at(25).layout).panes;
    assert.equal(descent.get('W_cntrl_00').size[0], 0);
    assert.ok(descent.get('N_cntrl_00').translation[1] < 38);
    assert.equal(descent.get('bar_00').translation[1], 270);
    assert.equal(descent.get('tx_cntrl_01').alpha, 127.5);
    for (const frame of [0, 10, 25, 35, 39]) assert.equal(at(frame).ready, false);
    assert.equal(home.optionsCloseFrames, 40);
    const finished = at(home.optionsCloseFrames);
    assert.equal(finished.ready, true);
    const end = indexLayout(finished.layout).panes;
    assert.equal(end.get('bar_00').translation[1], 230);
    assert.equal(end.get('W_cntrl_00').size[0], 0);
    assert.equal(end.get('B_optnBtn_00').flags & 1, 0);
    assert.equal(end.get('tx_cntrl_01').alpha, 0);
    assert.ok(Math.abs(end.get('tx_cntrl_00').alpha - 247.86) < 1e-8);
    assert.deepEqual(at(100).layout, finished.layout);
  },
);

test(
  'HOME shows a white connected player one and three empty disconnected controllers',
  { skip: !source },
  () => {
    const layout = createHomeOverlay(source).pose().layout;
    const panes = indexLayout(layout).panes;
    for (let player = 0; player < 4; player++) {
      for (const name of [`btryCase_0${player}`, `tx_plyr_0${player}`]) {
        const color = layout.materials[panes.get(name).material].colors[1];
        assert.deepEqual(color, player === 0 ? [255, 255, 255, 255] : [50, 50, 50, 255]);
      }
      for (let bar = 0; bar < 4; bar++) {
        assert.equal(panes.get(`btryPwr_0${player}_${bar}`).flags & 1, player === 0 ? 1 : 0);
      }
    }
  },
);

test(
  'remote volume uses original one-frame color setters for each of ten levels',
  { skip: !source },
  () => {
    const home = createHomeOverlay(source);
    for (const [volume, muted, filled] of [
      [0.7, false, 7],
      [0.3, false, 3],
      [1, false, 10],
      [0.7, true, 0],
    ]) {
      const layout = home.pose({ optionsOpen: true, volume, muted }).layout;
      const panes = indexLayout(layout).panes;
      for (let bar = 0; bar < 10; bar++) {
        const color = layout.materials[panes.get(`vol_0${bar}`).material].colors[1];
        assert.deepEqual(color, bar < filled ? [52, 190, 237, 255] : [100, 100, 100, 255]);
      }
    }
  },
);

test(
  'rumble on is the original left option and the selected option is blue',
  { skip: !source },
  () => {
    const home = createHomeOverlay(source);
    for (const rumble of [true, false]) {
      const { layout, controls } = home.pose({ optionsOpen: true, rumble });
      const panes = indexLayout(layout).panes;
      const left = layout.materials[panes.get('optnBtn_10_M').material].colors[1];
      const right = layout.materials[panes.get('optnBtn_11_M').material].colors[1];
      assert.deepEqual(rumble ? left : right, [115, 205, 236, 255]);
      assert.ok((rumble ? right : left).slice(0, 3).every((value) => value > 253));
      assert.equal(controls.find((control) => control.action === 'rumble-on').pane, 'B_optnBtn_10');
    }
  },
);

function homeFixture(options = {}) {
  const sounds = [];
  const speakers = [];
  const exits = [];
  const home = createHomeOverlay(source, {
    onSound: (cue) => sounds.push(cue),
    onSpeaker: (cue, state) => speakers.push({ cue, ...state }),
    onClose: () => exits.push('close'),
    onReturn: () => exits.push('return'),
    ...options,
  });
  home.open();
  return { home, sounds, speakers, exits };
}

test(
  'Yes hands the same render update to restart without exposing the completed HOME layout',
  { skip: !source },
  () => {
    for (const delta of [1, 3.5, 6]) {
      const restartSource = {
        root: { name: 'Root', alpha: 255, flags: 1, children: [] },
        materials: [],
        animations: { my_BackToWiiMenu: { frames: 1000, loop: true, targets: [] } },
      };
      const restart = createMenuRestart(restartSource);
      let returns = 0;
      const { home } = homeFixture({
        onReturn() {
          returns++;
          restart.start();
        },
      });
      home.advance(21);
      home.activate('return');
      home.advance(40);
      home.activate('home-yes');
      home.advance(49);
      assert.equal(home.presentation().fadeAlpha, 246 / 255);
      assert.equal(restart.active, false);

      const remainder = advanceHomeBoundary(home, restart, delta);
      assert.equal(remainder, delta - 1);
      assert.equal(restart.active, true, 'restart owns this completed-HOME render update');
      assert.equal(home.presentation().layout.root.flags & 1, 0);
      assert.deepEqual(home.presentation().controls, []);
      assert.equal(home.snapshot().dialog, null);
      restart.advance(remainder);
      assert.equal(restart.sample().phase, 'loading');
      assert.equal(restart.sample().frame, delta - 1);
      assert.equal(returns, 1);
      advanceHomeBoundary(home, restart, 1);
      assert.equal(returns, 1);
    }
  },
);

test(
  'fractional HOME fade completion gives its exact unused time to the new scene',
  { skip: !source },
  () => {
    const { home } = homeFixture();
    home.advance(21);
    home.activate('return');
    home.advance(40);
    home.activate('home-yes');
    home.advance(49.5);
    assert.equal(home.snapshot().active, true);
    assert.equal(home.advance(1.25), 0.75);
    assert.equal(home.snapshot().active, false);
  },
);

test(
  'HOME owns delayed opening and complete close cues without a generic click',
  { skip: !source },
  () => {
    const { home, sounds, exits } = homeFixture();
    assert.equal(home.snapshot().ready, false);
    home.advance(20);
    assert.deepEqual(sounds, []);
    home.advance(1);
    assert.deepEqual(sounds, ['HOMESE_HOME_BUTTON']);
    home.hover('close-home');
    home.hover('close-home');
    assert.deepEqual(sounds.slice(1), ['HOMESE_FOCUS']);
    assert.equal(home.back(), true);
    assert.equal(sounds.at(-1), 'HOMESE_RETURN_APP');
    home.advance(38);
    assert.deepEqual(exits, []);
    home.advance(1);
    assert.deepEqual(exits, ['close']);
    assert.equal(home.snapshot().active, false);
  },
);

test(
  'Wii Menu confirmation can cancel and only returns after Yes and the native black fade',
  { skip: !source },
  () => {
    const { home, sounds, exits } = homeFixture({
      messages: { returnToMenu: 'Original return prompt' },
    });
    home.advance(21);
    home.activate('return');
    assert.equal(home.snapshot().dialog, 'press');
    assert.equal(home.activate('home-yes'), false);
    home.advance(16);
    const start = indexLayout(home.presentation().layout).panes;
    assert.equal(start.get('N_Dialog').translation[1], 500);
    assert.equal(start.get('T_Dialog').text, 'Original return prompt');
    assert.equal(start.get('N_Dialog').flags & 1, 1);
    home.advance(24);
    assert.deepEqual(
      home.presentation().controls.map((control) => control.id),
      ['home-yes', 'home-no'],
    );
    home.activate('home-no');
    assert.equal(sounds.at(-1), 'HOMESE_CANCEL');
    home.advance(20);
    assert.equal(home.snapshot().dialog, 'return');
    home.advance(19);
    assert.equal(home.snapshot().dialog, null);
    assert.deepEqual(exits, []);
    home.activate('return');
    home.advance(40);
    home.activate('home-yes');
    assert.equal(sounds.at(-1), 'HOMESE_GOTO_MENU');
    home.advance(20);
    assert.equal(home.snapshot().phase, 'return-fade');
    home.advance(15);
    assert.equal(home.presentation().fadeAlpha, 127 / 255);
    assert.deepEqual(exits, []);
    home.advance(15);
    assert.deepEqual(exits, ['return']);
  },
);

test(
  'remote settings emit SELECT then OPEN, volume limit cues and the original remote glow',
  { skip: !source },
  () => {
    const changed = [];
    const { home, sounds, speakers } = homeFixture({ onVolume: (value) => changed.push(value) });
    home.open({ volume: 0.9 });
    home.advance(21);
    assert.equal(home.activate('home-volume-up'), false);
    home.activate('home-options');
    assert.equal(sounds.at(-1), 'HOMESE_SELECT');
    home.advance(15);
    assert.equal(sounds.at(-1), 'HOMESE_SELECT');
    home.advance(1);
    assert.equal(sounds.at(-1), 'HOMESE_OPEN_CONTROLLER');
    home.advance(25);
    home.activate('home-volume-up');
    assert.equal(sounds.at(-1), 'HOMESE_VOLUME_PLUS_LIMIT');
    assert.deepEqual(changed, [1]);
    assert.deepEqual(speakers, [{ cue: 'volume', volume: 1 }]);
    home.advance(3);
    assert.equal(indexLayout(home.presentation().layout).panes.get('sound_on_00').alpha, 255);
    home.advance(13);
    assert.equal(indexLayout(home.presentation().layout).panes.get('sound_on_00').alpha, 0);
    home.activate('home-volume-up');
    assert.equal(sounds.at(-1), 'HOMESE_NOTHING_DONE');
    home.activate('home-volume-down');
    assert.equal(sounds.at(-1), 'HOMESE_VOLUME_MINUS');
    home.back();
    assert.equal(sounds.at(-1), 'HOMESE_CLOSE_CONTROLLER');
    home.advance(40);
    assert.equal(home.snapshot().optionsOpen, false);
    assert.equal(home.snapshot().ready, true);
  },
);

test(
  'Rumble On plays its own cue and moves only the original remote shake pane',
  { skip: !source },
  () => {
    const { home, sounds } = homeFixture();
    home.open({ rumble: false });
    home.advance(21);
    home.activate('home-options');
    home.advance(41);
    home.activate('home-rumble-on');
    assert.equal(sounds.at(-1), 'HOMESE_VIBE_ON');
    home.advance(2);
    const panes = indexLayout(home.presentation().layout).panes;
    assert.notEqual(panes.get('cntrl_00').translation[0], 0);
    assert.equal(panes.get('N_cntrl_00').translation[0], -236);
    assert.equal(home.snapshot().ready, false);
    home.advance(22);
    assert.equal(home.snapshot().ready, true);
    home.activate('home-rumble-on');
    assert.equal(sounds.at(-1), 'HOMESE_NOTHING_DONE');
    home.advance(24);
    home.activate('home-rumble-off');
    assert.equal(sounds.at(-1), 'HOMESE_VIBE_OFF');
  },
);

test(
  'reconnect uses an explicit completion boundary, original prompt and independent battery blink',
  { skip: !source },
  () => {
    const { home, sounds, speakers } = homeFixture();
    home.advance(21);
    home.activate('home-options');
    home.advance(41);
    home.activate('home-reconnect');
    assert.deepEqual(sounds.slice(-2), ['HOMESE_SELECT', 'HOMESE_START_CONNECT_WINDOW']);
    home.advance(15);
    let panes = indexLayout(home.presentation().layout).panes;
    assert.equal(panes.get('T_msg_00').flags & 1, 1);
    assert.equal(panes.get('btryPwr_00_0').flags & 1, 0);
    assert.equal(home.completeReconnect(), false);
    home.advance(119);
    home.advance(500);
    assert.equal(home.snapshot().reconnect, 'wait');
    assert.equal(home.completeReconnect(), true);
    assert.equal(sounds.at(-1), 'HOMESE_CONNECTED');
    home.advance(24);
    assert.deepEqual(speakers, [{ cue: 'connect1', volume: 0.7 }]);
    home.advance(6);
    assert.equal(sounds.at(-1), 'HOMESE_END_CONNECT_WINDOW');
    home.advance(19);
    assert.equal(home.snapshot().reconnect, null);
    panes = indexLayout(home.presentation().layout).panes;
    assert.equal(panes.get('T_msg_00').flags & 1, 0);
    assert.equal(panes.get('btryPwr_00_0').flags & 1, 1);
    assert.notEqual(panes.get('N_plyr_00').alpha, 255);
    home.advance(31);
    assert.equal(indexLayout(home.presentation().layout).panes.get('N_plyr_00').alpha, 255);
  },
);

test(
  'reconnect auto completion is opt-in and controller reset cancels pending actions',
  { skip: !source },
  () => {
    const { home, sounds, exits } = homeFixture({ reconnectDelay: 60 });
    home.advance(21);
    home.activate('home-options');
    home.advance(41);
    home.activate('home-reconnect');
    home.advance(15 + 119 + 59);
    assert.equal(home.snapshot().reconnect, 'wait');
    home.advance(1);
    assert.equal(home.snapshot().reconnect, 'connected');
    home.reset();
    const count = sounds.length;
    home.advance(200);
    assert.equal(sounds.length, count);
    assert.deepEqual(exits, []);
  },
);

test('HOME preserves ordered multi-player connections, per-player speakers and battery levels',
  { skip: !source }, () => {
    const remoteState = defaultRemoteState();
    remoteState.controllers.forEach((controller, index) => { controller.battery = 4 - index; });
    const saved = [];
    const { home, sounds, speakers } = homeFixture({
      remoteState,
      reconnectDelay: 1,
      reconnectFixture: { players: [3, 1, 4, 2], intervalMs: 0 },
      onStateChange: state => saved.push(state),
    });
    home.advance(21);
    home.activate('home-options');
    home.advance(41);
    home.activate('home-reconnect');
    home.advance(15 + 119 + 1);
    assert.deepEqual(sounds.slice(-4), [
      'HOMESE_CONNECTED3', 'HOMESE_CONNECTED', 'HOMESE_CONNECTED4', 'HOMESE_CONNECTED2',
    ]);
    home.advance(24);
    assert.deepEqual(speakers.map(event => event.cue), ['connect3', 'connect1', 'connect4', 'connect2']);
    home.advance(6 + 19 + 31);
    const presentation = home.presentation().layout;
    const panes = indexLayout(presentation).panes;
    for (let player = 0; player < 4; player++) {
      for (let bar = 0; bar < 4; bar++) {
        assert.equal(panes.get(`btryPwr_0${player}_${bar}`).flags & 1, bar < 4 - player ? 1 : 0);
      }
    }
    assert.equal(saved.at(-1).controllers.every(controller => controller.connected), true);
    assert.deepEqual(presentation.materials[panes.get('btryCase_03').material].colors[1],
      [255, 0, 0, 255], 'low-battery red retains the connection white setter red component');
    assert.equal(remoteState.controllers[1].connected, false, 'supplied state remains untouched');
    home.reset();
    home.open();
    assert.deepEqual(home.remoteState(), saved.at(-1));
  });

test('held key repeats cannot connect a second fixture controller', { skip: !source }, () => {
  const { home } = homeFixture({ reconnectFixture: { mode: 'manual', players: [1, 2] } });
  home.advance(21);
  home.activate('home-options');
  home.advance(41);
  home.activate('home-reconnect');
  home.advance(15 + 119);
  home.keyInput('1');
  home.keyInput('2');
  home.keyInput('2');
  assert.deepEqual(home.snapshot().reconnectStatus.connected, [1]);
  home.keyInput('2', { type: 'keyup' });
  home.keyInput('2');
  assert.deepEqual(home.snapshot().reconnectStatus.connected, [1, 2]);
});

test('HOME timeout exits without a phantom player and retry callbacks cancel on reset',
  { skip: !source }, () => {
    const { home, sounds, speakers } = homeFixture({
      reconnectFixture: { mode: 'timeout', startFailures: 1, stopFailures: 1 },
    });
    home.advance(21);
    home.activate('home-options');
    home.advance(41);
    home.activate('home-reconnect');
    home.advance(15 + 119);
    assert.equal(home.snapshot().reconnect, 'retry');
    home.advance(6 + 3601);
    assert.equal(home.snapshot().reconnect, 'stop-retry');
    assert.equal(home.snapshot().controllers.some(controller => controller.connected), false);
    home.advance(6 + 19);
    assert.equal(home.snapshot().reconnect, null);
    assert.equal(home.snapshot().ready, true);
    assert.deepEqual(speakers, []);
    assert.equal(sounds.at(-1), 'HOMESE_END_CONNECT_WINDOW');
    home.activate('home-reconnect');
    home.advance(15 + 119);
    home.reset();
    const count = sounds.length;
    home.advance(4000);
    assert.equal(sounds.length, count);
  });
