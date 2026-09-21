import { indexLayout, poseLayout } from './animation.js';
import { defaultRemoteState, validateRemoteState } from './remote-state.js';
import { createReconnectFixture } from './remote-reconnect.js';

const PREFIX = 'th_HomeBtn_d_';

/** Original USA 4.3 HOME bindings: executable tables 0x8160F3D8,
 * 0x816450C8 and 0x8164525C. Labels retain the supplied picture panes.
 * The mouse represents player one; hardware synchronization is a local fixture.
 */
export function createHomeOverlay(source, options = {}) {
  const original = indexLayout(source);
  const boundAnimations = new Map();
  const optionsFrames = source.animations[PREFIX + 'optn_bar_psh'].frames;
  const optionsCloseFrames = Math.max(
    ...['hmMenu_bar_psh', 'close_bar_psh', 'cntrl_dwn'].map(
      (name) => source.animations[PREFIX + name].frames,
    ),
  );
  function clip(name, frame, group = name) {
    const key = `${name}/${group}`;
    if (!boundAnimations.has(key)) {
      const animation = source.animations[PREFIX + name];
      if (!animation) throw new Error(`Missing HOME animation: ${name}`);
      // HBM binds every listed pane with recursive=false. A parent group must
      // not inadvertently apply curves belonging to an independently animated child.
      const allowed = new Set(source.groups[group] || []);
      for (const paneName of allowed) {
        const pane = original.panes.get(paneName);
        if (pane?.material !== undefined) allowed.add(source.materials[pane.material].name);
      }
      // HBMFrameController::getLastFrame is GetFrameMax()-1 even when the
      // authoring file has a loop bit. One-frame color setters sample frame 0;
      // their frame-1 donor keys intentionally contain the opposite state.
      boundAnimations.set(key, {
        ...animation,
        loop: false,
        targets: animation.targets.filter((t) => allowed.has(t.name)),
      });
    }
    const animation = boundAnimations.get(key);
    return { animation, frame: Math.max(0, Math.min(frame, animation.frames - 1)) };
  }

  const renderer = {
    enterFrames: source.animations[PREFIX + 'hmMenu_strt'].frames,
    // State14 waits for the19-update header push before starting the19-update
    // retraction; state18 performs cleanup on the following update.
    leaveFrames: 39,
    optionsFrames,
    optionsCloseFrames,
    pose({
      frame = 21,
      phase = 'idle',
      hover = null,
      hoverFrame = 0,
      optionsOpen = false,
      optionsClosing = false,
      optionsFrame = optionsFrames,
      muted = false,
      volume = 0.7,
      rumble = true,
      effects = [],
      dialog = null,
      reconnect = null,
      controllers = defaultRemoteState().controllers,
    } = {}) {
      const entering = phase === 'enter';
      const closing = optionsClosing && !optionsOpen;
      const optionsReady = optionsOpen
        ? optionsFrame >= optionsFrames
        : !closing || optionsFrame >= optionsCloseFrames;
      const clips = [clip('hmMenu_strt', entering ? frame : 21)];
      for (let player = 0; player < 4; player++) {
        const controller = controllers[player];
        clips.push(clip(controller.connected ? 'btry_wht' : 'btry_gry', 0, `plyr_0${player}`));
        // Native connection first sets white; btry_red only clears green/blue
        // and must retain that established red component, not the gray donor.
        if (controller.connected && controller.battery < 2)
          clips.push(clip('btry_red', 0, `plyr_0${player}`));
      }
      const volumeBars = muted ? 0 : Math.round(Math.min(1, Math.max(0, volume)) * 10);
      for (let bar = 0; bar < 10; bar++) {
        clips.push(clip(bar < volumeBars ? 'sound_ylw' : 'sound_gry', 0, `vol_0${bar}`));
      }
      clips.push(clip(rumble ? 'vb_btn_wht_psh' : 'vb_btn_ylw_psh', 24, 'optnBtn_10_psh'));
      clips.push(clip(rumble ? 'vb_btn_ylw_psh' : 'vb_btn_wht_psh', 24, 'optnBtn_11_psh'));

      if (optionsOpen || closing) {
        // HBM state 10: bar push and remote lift begin together; the options
        // window starts after the 16-frame lift controller finishes.
        const openingFrame = closing ? optionsFrames : optionsFrame;
        clips.push(clip('optn_bar_psh', openingFrame));
        clips.push(clip('cntrl_up', openingFrame));
        if (openingFrame >= 16) clips.push(clip('cntrl_wndw_opn', openingFrame - 16));
        if (closing) {
          // HBMBase::startTrigEvent and update_controller both start these
          // three controllers together. State 10 waits for close_bar_psh;
          // cntrl_dwn owns the window shrink and remote movement.
          clips.push(clip('hmMenu_bar_psh', optionsFrame));
          clips.push(clip('close_bar_psh', optionsFrame));
          clips.push(clip('cntrl_dwn', optionsFrame));
        }
        if (optionsOpen && optionsReady && hover === 'home-options')
          clips.push(clip('close_bar_in', hoverFrame, 'optn_bar_in'));
        const optionGroups = {
          'home-volume-down': '00',
          'home-volume-up': '01',
          'home-rumble-on': '10',
          'home-rumble-off': '11',
          'home-reconnect': '20',
        };
        if (optionsOpen && optionsReady && optionGroups[hover])
          clips.push(clip('optn_btn_in', hoverFrame, `optnBtn_${optionGroups[hover]}_inOut`));
      }
      if (!optionsOpen && optionsReady) {
        if (hover === 'close-home') clips.push(clip('hmMenu_bar_in', hoverFrame));
        if (hover === 'return') clips.push(clip('cntBtn_in', hoverFrame, 'btnL_00_inOut'));
        if (hover === 'home-options') clips.push(clip('optn_bar_in', hoverFrame));
      }
      if (phase === 'leave') {
        clips.push(clip('hmMenu_bar_psh', Math.min(19, frame)));
        if (frame >= 19) clips.push(clip('hmMenu_fnsh', frame - 19));
      }

      if (dialog && dialog.phase !== 'press') {
        clips.push(clip('cmn_msg_in', dialog.phase === 'in' ? dialog.frame : 24));
        if (dialog.phase === 'return') clips.push(clip('cmn_msg_rtrn', dialog.frame));
        if (['yes', 'no', 'fade'].includes(dialog.phase)) {
          clips.push(
            clip('cmn_msg_btn_psh', dialog.frame, `msgBtn_0${dialog.phase === 'no' ? 1 : 0}_psh`),
          );
        }
        if (['home-yes', 'home-no'].includes(hover)) {
          clips.push(
            clip('cmn_msg_btn_in', hoverFrame, `msgBtn_0${hover === 'home-yes' ? 0 : 1}_inOut`),
          );
        }
      }
      if (reconnect) {
        const reconnectFrame = reconnect.phase === 'in' ? reconnect.frame : 119;
        clips.push(clip('link_msg_in', reconnectFrame));
        if (!['in', 'retry'].includes(reconnect.phase))
          clips.push(clip('12btn_on', (reconnect.promptFrame ?? reconnect.frame) % 50));
        if (reconnect.phase === 'out') clips.push(clip('link_msg_out', reconnect.frame));
      }

      for (const effect of effects) {
        clips.push(clip(effect.name, effect.frame, effect.group || effect.name));
      }
      const layout = poseLayout(source, clips);
      const { panes } = indexLayout(layout);
      // calc_battery (0x81373DD0) shows each bar below the reported battery level.
      for (let player = 0; player < 4; player++)
        for (let bar = 0; bar < 4; bar++) {
          const pane = panes.get(`btryPwr_0${player}_${bar}`);
          if (pane) {
            const controller = controllers[player];
            const visible = controller.connected && bar < controller.battery;
            pane.flags = visible ? pane.flags | 1 : pane.flags & ~1;
          }
        }
      // iplHomeButtonMenu sets backFlag=0. HBM::init also hides the mail icon and
      // its runtime text/dialog panes until those hardware-dependent events occur.
      for (const name of [
        'back_02',
        'let_icn_00',
        'T_msg_00',
        'T_msg_01',
        'T_Dialog',
        'N_Dialog',
      ]) {
        const pane = panes.get(name);
        if (pane) {
          const dialogVisible =
            dialog && dialog.phase !== 'press' && ['T_Dialog', 'N_Dialog'].includes(name);
          const reconnectVisible = reconnect && ['T_msg_00', 'T_msg_01'].includes(name);
          pane.flags = dialogVisible || reconnectVisible ? pane.flags | 1 : pane.flags & ~1;
        }
      }
      for (const suffix of ['00', '01', '10', '11', '20']) {
        const pane = panes.get('B_optnBtn_' + suffix);
        if (pane)
          pane.flags = optionsOpen || (closing && !optionsReady) ? pane.flags | 1 : pane.flags & ~1;
      }
      if (dialog) panes.get('T_Dialog').text = dialog.text;
      if (reconnect) {
        panes.get('T_msg_00').text = reconnect.text;
        panes.get('T_msg_01').text = reconnect.disconnecting;
      }
      let controls = [
        {
          id: 'home-options',
          label: optionsOpen ? 'Close Wii Remote Settings' : 'Wii Remote Settings',
          pane: 'B_bar_10',
          action: 'toggle-options',
        },
      ];
      if (optionsOpen) {
        controls.push(
          {
            id: 'home-volume-down',
            label: 'Volume down',
            pane: 'B_optnBtn_00',
            action: 'volume-down',
          },
          { id: 'home-volume-up', label: 'Volume up', pane: 'B_optnBtn_01', action: 'volume-up' },
          {
            id: 'home-rumble-on',
            label: 'Rumble on',
            pane: 'B_optnBtn_10',
            action: 'rumble-on',
          },
          {
            id: 'home-rumble-off',
            label: 'Rumble off',
            pane: 'B_optnBtn_11',
            action: 'rumble-off',
          },
          {
            id: 'home-reconnect',
            label: 'Reconnect',
            pane: 'B_optnBtn_20',
            action: 'reconnect',
          },
        );
      } else {
        controls.push(
          { id: 'close-home', label: 'Close HOME Menu', pane: 'B_btn_00', action: 'close' },
          { id: 'return', label: 'Wii Menu', pane: 'B_btnL_00', action: 'return' },
        );
      }
      if (dialog) {
        controls = [
          { id: 'home-yes', label: 'Yes', pane: 'B_BtnA', action: 'yes' },
          { id: 'home-no', label: 'No', pane: 'B_BtnB', action: 'no' },
        ];
      } else if (reconnect) {
        controls = [];
      }
      return { layout, controls, ready: phase === 'idle' && optionsReady };
    },
  };
  return Object.freeze({ ...renderer, ...createHomeController(renderer, options) });
}

/** Native transitions use update counts. Reconnect completion is deliberately
 * supplied by a local fixture, because the original waits for WPAD callbacks.
 */
function createHomeController(
  renderer,
  {
    messages = {},
    onSoundInitialize = () => {},
    onSound = () => {},
    onVolume = () => {},
    onRumble = () => {},
    onClose = () => {},
    onReturn = () => {},
    onSpeaker = () => {},
    onStateChange = () => {},
    remoteState = defaultRemoteState(),
    reconnectDelay = null,
    reconnectFixture,
  } = {},
) {
  let active = false;
  let phase = 'closed';
  let frame = 0;
  const initialState = validateRemoteState(remoteState);
  let volume = initialState.volume;
  let muted = false;
  let rumble = initialState.rumble;
  let controllers = initialState.controllers;
  let optionsOpen = false;
  let optionsClosing = false;
  let optionsFrame = 0;
  let dialog = null;
  let reconnect = null;
  let reconnectSession = null;
  let speakerEvents = [];
  let hover = null;
  let hoverFrame = 0;
  let focusSoundAge = 3;
  let effects = [];
  let openControllerSound = false;
  let rumbleLock = 0;
  const heldKeys = new Set();
  const sound = (name) => onSound(`HOMESE_${name}`);
  const savedState = () => validateRemoteState({ version: 1, volume, rumble, controllers });
  const emitStateChange = () => onStateChange(savedState());
  const effect = (name, group, duration) => {
    effects = effects.filter((entry) => entry.group !== group);
    effects.push({ name, group, frame: 0, duration });
  };
  const transition = (next) => {
    phase = next;
    frame = 0;
    hover = null;
    hoverFrame = 0;
  };
  const optionsReady = () =>
    optionsOpen
      ? optionsFrame >= renderer.optionsFrames
      : !optionsClosing || optionsFrame >= renderer.optionsCloseFrames;
  const ready = () =>
    active &&
    phase === 'idle' &&
    optionsReady() &&
    !rumbleLock &&
    !reconnect &&
    (!dialog || dialog.phase === 'idle');
  const hoverBinding = (id, entering) => {
    if (id === 'close-home') return ['hmMenu_bar_' + (entering ? 'in' : 'out')];
    if (id === 'return') return ['cntBtn_' + (entering ? 'in' : 'out'), 'btnL_00_inOut'];
    if (id === 'home-options') {
      return [
        (optionsOpen ? 'close' : 'optn') + '_bar_' + (entering ? 'in' : 'out'),
        'optn_bar_' + (entering ? 'in' : 'out'),
      ];
    }
    if (id === 'home-yes' || id === 'home-no') {
      return [
        'cmn_msg_btn_' + (entering ? 'in' : 'out'),
        `msgBtn_0${id === 'home-yes' ? 0 : 1}_inOut`,
      ];
    }
    const suffix = {
      'home-volume-down': '00',
      'home-volume-up': '01',
      'home-rumble-on': '10',
      'home-rumble-off': '11',
      'home-reconnect': '20',
    }[id];
    return suffix ? ['optn_btn_' + (entering ? 'in' : 'out'), `optnBtn_${suffix}_inOut`] : null;
  };
  const closeOptions = () => {
    optionsOpen = false;
    optionsClosing = true;
    optionsFrame = 0;
    hover = null;
    sound('CLOSE_CONTROLLER');
  };
  const completeReconnect = (player) => reconnectSession?.connect(player) ?? false;
  const beginReconnect = () => {
    reconnectSession = createReconnectFixture({
      mode: reconnectDelay === null ? 'manual' : 'automatic',
      ...reconnectFixture,
      delayFrames: reconnectDelay ?? 180,
    }, {
      onConnect(player) {
        controllers[player - 1].connected = true;
        reconnect.phase = 'connected';
        reconnect.frame = 0;
        sound(`CONNECTED${player === 1 ? '' : player}`);
        effect('btry_wink', `plyr_0${player - 1}`, 80);
        speakerEvents.push({ player, frame: 0 });
        emitStateChange();
      },
      onComplete(outcome) {
        reconnect.phase = 'out';
        reconnect.frame = 0;
        reconnect.outcome = outcome;
        sound('END_CONNECT_WINDOW');
      },
    });
    reconnect.phase = reconnectSession.snapshot().phase === 'start-retry' ? 'retry' : 'wait';
    reconnect.frame = 0;
  };
  const api = {
    open(initial = {}) {
      volume = initial.volume ?? volume;
      muted = initial.muted ?? false;
      rumble = initial.rumble ?? rumble;
      active = true;
      optionsOpen = false;
      optionsClosing = false;
      optionsFrame = 0;
      openControllerSound = false;
      dialog = null;
      reconnect = null;
      reconnectSession = null;
      speakerEvents = [];
      effects = [];
      rumbleLock = 0;
      heldKeys.clear();
      transition('enter');
    },
    reset() {
      active = false;
      dialog = null;
      reconnect = null;
      reconnectSession = null;
      speakerEvents = [];
      effects = [];
      heldKeys.clear();
      transition('closed');
    },
    advance(frames) {
      if (!active) return frames;
      // Separate updates preserve events when a browser tick crosses more than
      // one native state boundary. Fractional updates remain presentation-only.
      for (let remaining = frames; remaining > 0;) {
        const step = Math.min(1 - (frame % 1), remaining);
        remaining -= step;
        frame += step;
        hoverFrame += step;
        focusSoundAge += step;
        rumbleLock = Math.max(0, rumbleLock - step);
        for (const entry of effects) entry.frame += step;
        effects = effects.filter((entry) => entry.frame < entry.duration);
        for (const event of speakerEvents) {
          event.frame += step;
          if (event.frame >= 24) onSpeaker(`connect${event.player}`, { volume });
        }
        speakerEvents = speakerEvents.filter(event => event.frame < 24);
        if (phase === 'enter' && frame >= renderer.enterFrames) {
          // Native state 1 calls init_sound before requesting the opening cue
          // (0x813731A0/AC). Only existing application voices inherit its pause.
          onSoundInitialize();
          transition('idle');
          sound('HOME_BUTTON');
        } else if (phase === 'leave' && frame >= renderer.leaveFrames) {
          active = false;
          transition('closed');
          onClose();
          return remaining;
        } else if (phase === 'return-fade' && frame >= 30) {
          active = false;
          dialog = null;
          transition('closed');
          onReturn();
          return remaining;
        }
        if (optionsOpen || optionsClosing) {
          optionsFrame += step;
          if (optionsOpen && !openControllerSound && optionsFrame >= 16) {
            openControllerSound = true;
            sound('OPEN_CONTROLLER');
          }
        }
        if (dialog) {
          dialog.frame += step;
          if (dialog.phase === 'press' && dialog.frame >= 16)
            dialog = { ...dialog, phase: 'in', frame: 0 };
          else if (dialog.phase === 'in' && dialog.frame >= 24)
            dialog = { ...dialog, phase: 'idle', frame: 24 };
          else if (dialog.phase === 'no' && dialog.frame >= 20)
            dialog = { ...dialog, phase: 'return', frame: 0 };
          else if (dialog.phase === 'return' && dialog.frame >= 19) dialog = null;
          else if (dialog.phase === 'yes' && dialog.frame >= 20) {
            dialog = { ...dialog, phase: 'fade', frame: 20 };
            transition('return-fade');
          }
        }
        if (reconnect) {
          reconnect.frame += step;
          if (['wait', 'connected', 'stop-retry', 'out'].includes(reconnect.phase))
            reconnect.promptFrame += step;
          if (reconnect.phase === 'press' && reconnect.frame >= 15) {
            controllers = controllers.map(controller => ({ ...controller, connected: false }));
            emitStateChange();
            reconnect = { ...reconnect, phase: 'in', frame: 0 };
          } else if (reconnect.phase === 'in' && reconnect.frame >= 119) beginReconnect();
          else if (['retry', 'wait', 'connected', 'stop-retry'].includes(reconnect.phase)) {
            reconnectSession.advance(step);
            const status = reconnectSession.snapshot();
            if (status.phase === 'start-retry') reconnect.phase = 'retry';
            else if (status.phase === 'stop-retry') reconnect.phase = 'stop-retry';
            else if (status.phase === 'wait' && reconnect.phase === 'retry') {
              reconnect.phase = 'wait';
              reconnect.frame = 0;
            }
          } else if (reconnect.phase === 'out' && reconnect.frame >= 19) {
            reconnect = null;
            reconnectSession = null;
          }
        }
      }
      return 0;
    },
    hover(id) {
      if (id === hover) return;
      const next =
        ready() && api.presentation().controls.some((item) => item.id === id) ? id : null;
      if (next === hover) return;
      const previous = hoverBinding(hover, false);
      if (previous) effect(previous[0], previous[1] || previous[0], 10);
      hover = next;
      hoverFrame = 0;
      const incomingExit = hoverBinding(next, false);
      if (incomingExit) {
        const group = incomingExit[1] || incomingExit[0];
        effects = effects.filter((entry) => entry.group !== group);
      }
      if (next && focusSoundAge > 2) {
        sound('FOCUS');
        focusSoundAge = 0;
      }
    },
    activate(id) {
      if (!ready()) return false;
      const control = api
        .presentation()
        .controls.find((item) => item.id === id || item.action === id);
      if (!control) return false;
      const action = control.action;
      if (dialog) {
        if (!['yes', 'no'].includes(action)) return false;
        dialog = { ...dialog, phase: action, frame: 0 };
        hover = null;
        sound(action === 'yes' ? 'GOTO_MENU' : 'CANCEL');
        return true;
      }
      if (action === 'close') {
        transition('leave');
        sound('RETURN_APP');
      } else if (action === 'return') {
        dialog = {
          phase: 'press',
          frame: 0,
          text: messages.returnToMenu || 'Return to the Wii Menu?',
        };
        effect('cntBtn_psh', 'btnL_00_psh', 17);
        hover = null;
        sound('SELECT');
      } else if (action === 'toggle-options') {
        if (optionsOpen) closeOptions();
        else {
          optionsOpen = true;
          optionsClosing = false;
          optionsFrame = 0;
          openControllerSound = false;
          hover = null;
          sound('SELECT');
        }
      } else if (action === 'volume-down' || action === 'volume-up') {
        const delta = action === 'volume-up' ? 1 : -1;
        const current = muted ? 0 : Math.round(volume * 10);
        const next = Math.max(0, Math.min(10, current + delta));
        if (next === current) sound('NOTHING_DONE');
        else {
          volume = next / 10;
          muted = false;
          const direction = delta > 0 ? 'PLUS' : 'MINUS';
          sound(`VOLUME_${direction}${next === 0 || next === 10 ? '_LIMIT' : ''}`);
          onVolume(volume);
          emitStateChange();
          onSpeaker('volume', { volume });
          effect('optn_btn_psh', `optnBtn_0${delta > 0 ? 1 : 0}_psh`, 16);
        }
      } else if (action === 'rumble-on' || action === 'rumble-off') {
        const next = action === 'rumble-on';
        const changed = rumble !== next;
        sound(changed ? (next ? 'VIBE_ON' : 'VIBE_OFF') : 'NOTHING_DONE');
        if (next) {
          effect(changed ? 'vb_btn_wht_psh' : 'vb_btn_ylw_ylw', 'optnBtn_10_cntrl', 24);
          if (changed) effect('vb_btn_ylw_psh', 'optnBtn_11_psh', 16);
          rumbleLock = 24;
        } else if (changed) {
          effect('vb_btn_wht_psh', 'optnBtn_11_psh', 24);
          effect('vb_btn_ylw_psh', 'optnBtn_10_psh', 16);
          rumbleLock = 24;
        }
        rumble = next;
        onRumble(rumble);
        emitStateChange();
      } else if (action === 'reconnect') {
        reconnect = {
          phase: 'press',
          frame: 0,
          promptFrame: 0,
          text:
            messages.reconnect ||
            'Simultaneously press ① and ②\non each Wii Remote in the\ndesired player order.',
          disconnecting: messages.disconnecting || 'Disconnecting...',
        };
        heldKeys.clear();
        effect('optn_btn_psh', 'optnBtn_20_psh', 16);
        hover = null;
        sound('SELECT');
        sound('START_CONNECT_WINDOW');
      } else return false;
      return true;
    },
    back() {
      if (!ready()) return false;
      if (dialog) return api.activate('no');
      if (optionsOpen) {
        closeOptions();
        return true;
      }
      return api.activate('close');
    },
    keyInput(key, { type = 'keydown' } = {}) {
      if (!['1', '2'].includes(key)) return false;
      if (type === 'keyup') heldKeys.delete(key);
      else {
        const wasHeld = heldKeys.has(key);
        heldKeys.add(key);
        if (!wasHeld && heldKeys.has('1') && heldKeys.has('2')) return completeReconnect();
      }
      return Boolean(reconnect);
    },
    completeReconnect,
    remoteState: savedState,
    snapshot() {
      return {
        active,
        phase,
        frame,
        volume,
        muted,
        rumble,
        optionsOpen,
        optionsClosing,
        optionsFrame,
        dialog: dialog?.phase || null,
        reconnect: reconnect?.phase || null,
        reconnectStatus: reconnectSession?.snapshot() ?? null,
        controllers: structuredClone(controllers),
        ready: ready(),
      };
    },
    presentation() {
      const result = renderer.pose({
        phase,
        frame,
        hover,
        hoverFrame,
        optionsOpen,
        optionsClosing,
        optionsFrame,
        volume,
        muted,
        rumble,
        effects,
        dialog,
        reconnect: reconnect?.phase === 'press' ? null : reconnect,
        controllers,
      });
      if (!active) {
        result.layout.root.flags &= ~1;
        result.controls = [];
      }
      if (reconnect) result.controls = [];
      return {
        ...result,
        ready: ready(),
        active,
        fadeAlpha:
          phase === 'return-fade' ? Math.min(255, Math.floor((frame * 255) / 30)) / 255 : 0,
      };
    },
  };
  return api;
}
