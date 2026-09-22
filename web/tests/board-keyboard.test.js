import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { KEYBOARD_LAYOUTS, createBoardKeyboard } from '../src/board-keyboard.js';
import { indexLayout } from '../src/animation.js';
import { normalizeKeyboardPreferences } from '../src/keyboard-preferences.js';
import { Renderer } from '../src/renderer.js';
import { createDisplay } from '../src/display.js';
import { BitmapFont } from '../src/font.js';
import { deferredDictionary, flushDictionary } from './helpers/deferred-dictionary.js';
const url = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(url) ? JSON.parse(readFileSync(url)) : null;
const available = manifest && KEYBOARD_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      KEYBOARD_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, url))),
      ]),
    )
  : {};

test('silent keyboard disposal closes once and rejects late telephone prediction mutations',
  { skip: !available }, async () => {
    const { provider, sessions } = deferredDictionary();
    const changes = [];
    const sounds = [];
    const closes = [];
    const keyboard = createBoardKeyboard(layouts, {
      predict: provider, initialPredictionEnabled: true,
      onChange: (value) => changes.push(value), onSound: (sound) => sounds.push(sound),
      onClose: (value) => closes.push(value),
    });
    keyboard.activate('key-phone');
    keyboard.activate('key-phone-5');
    assert.equal(keyboard.snapshot().dictionary.state, 'loading');
    const before = { text: keyboard.snapshot().text, changes: [...changes], sounds: [...sounds] };
    assert.equal(keyboard.dispose(), true);
    assert.equal(keyboard.dispose(), false);
    assert.equal(sessions[0].closeCalls, 1);
    sessions[0].requests.at(-1).resolve({ engine: 'original-zi8', candidates: ['native'] });
    await flushDictionary();
    keyboard.advance(100);
    assert.equal(keyboard.snapshot().text, before.text);
    assert.equal(keyboard.snapshot().caretVisible, false);
    assert.equal(keyboard.keyInput('x'), false);
    assert.equal(keyboard.back(), false);
    assert.deepEqual(changes, before.changes);
    assert.deepEqual(sounds, before.sounds);
    assert.deepEqual(closes, []);
    const next = createBoardKeyboard(layouts, { predict: provider });
    next.back();
    next.dispose();
    assert.equal(sessions[1].closeCalls, 1, 'normal dismissal and owner disposal share one release');
  });

test(
  'Console Nickname restricts native type 6 controls and preserves cancel semantics',
  {
    skip: !available,
  },
  () => {
    const closes = [];
    const keyboard = createBoardKeyboard(layouts, {
      profile: 'console-nickname',
      value: 'Wii',
      onClose: (value, result) => closes.push({ value, ...result }),
    });
    for (const id of ['key-language', 'key-prediction', 'key-more', 'key-return']) {
      assert.equal(keyboard.activate(id), false, id);
      assert.equal(
        keyboard.controls().some((item) => item.id === id),
        false,
        id,
      );
    }
    for (const character of '123456789') keyboard.keyInput(character);
    assert.equal(keyboard.snapshot().text, 'Wii1234567');
    const presentation = keyboard.presentation();
    assert.deepEqual(
      presentation.layers.map((layer) => layer.prefix),
      ['keyboard-background:', 'keyboard-text:', 'keyboard-toolbar:', 'keyboard-ascii:'],
    );
    const keytop = indexLayout(presentation.layers.at(-1).layout).panes;
    for (const name of ['W_USEU_prdc_lang', 'W_USEU_Chng_sign', 'P_key_LF']) {
      assert.equal(keytop.get(name).flags & 1, 0, name);
    }
    const toolbar = indexLayout(presentation.layers[2].layout).panes;
    assert.equal(toolbar.get('P_keyChange').flags & 1, 1);
    assert.equal(presentation.layers[1].layout.name, 'fs_VK_textBox_b');
    assert.equal(keyboard.activate('key-phone'), true);
    assert.equal(keyboard.snapshot().layoutMode, 'phone');
    assert.equal(keyboard.activate('key-qwerty'), true);
    keyboard.back();
    assert.deepEqual(closes, [{ value: 'Wii1234567', reason: 'cancel' }]);
  },
);

test(
  'Settings numeric, IP and symbol profiles use their original layouts and input filters',
  { skip: !available },
  () => {
    const numeric = createBoardKeyboard(layouts, { nativeType: 3, maxLength: 4 });
    for (const character of '1a2.34') numeric.keyInput(character);
    assert.equal(numeric.snapshot().text, '1234');
    assert.equal(numeric.snapshot().layoutMode, 'phone');
    assert.equal(numeric.activate('key-phone-9'), false);
    assert.equal(numeric.activate('key-phone-11'), false);
    assert.equal(numeric.activate('key-phone-mode-0'), false);
    assert.equal(numeric.activate('key-qwerty'), false);
    const ip = createBoardKeyboard(layouts, { nativeType: 10, maxLength: 15 });
    for (const character of '192.168.') ip.keyInput(character);
    ip.activate('key-phone-0');
    ip.activate('key-phone-11');
    ip.activate('key-phone-10');
    assert.equal(ip.snapshot().text, '192.168.1.0');
    const symbol = createBoardKeyboard(layouts, { nativeType: 5 });
    assert.equal(symbol.activate('key-more'), true);
    const plain = createBoardKeyboard(layouts, { nativeType: 7 });
    assert.equal(plain.activate('key-more'), false);
    assert.equal(plain.activate('key-phone'), false);
  },
);

test(
  'original ASCII keys edit Unicode, shift once, retain caps and navigate native symbol pages',
  { skip: !available },
  () => {
    const pristine = JSON.stringify(layouts),
      edits = [],
      closes = [];
    const keyboard = createBoardKeyboard(layouts, {
      onChange: (value) => edits.push(value),
      onClose: (value) => closes.push(value),
    });
    keyboard.activate('key-shift');
    keyboard.activate('key-11');
    keyboard.activate('key-11');
    keyboard.activate('key-caps');
    keyboard.activate('key-12');
    assert.equal(keyboard.snapshot().text, 'QqW');
    keyboard.keyInput('ArrowLeft');
    keyboard.keyInput('é');
    keyboard.keyInput('Delete');
    assert.equal(keyboard.snapshot().text, 'Qqé');
    keyboard.activate('key-more');
    keyboard.advance(18);
    keyboard.activate('key-symbols-next');
    keyboard.advance(20);
    keyboard.activate('key-symbol-0');
    assert.equal(keyboard.snapshot().text, 'Qqé[');
    keyboard.activate('key-symbols-close');
    keyboard.advance(13);
    keyboard.activate('key-ok');
    // tiToolBar::EventHandler calls onOK on ON_TRIG, without a flash delay.
    assert.deepEqual(closes, ['Qqé[']);
    assert.equal(edits.at(-1), 'Qqé[');
    assert.equal(JSON.stringify(layouts), pristine);
  },
);

test(
  'physical keys animate their original keytops and held Shift releases cleanly',
  { skip: !available },
  () => {
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, { onSound: (id) => sounds.push(id) });
    keyboard.keyInput('Shift', { code: 'ShiftLeft', shiftKey: true });
    assert.equal(keyboard.snapshot().shift, true);
    keyboard.keyInput('Q', { code: 'KeyQ', shiftKey: true });
    keyboard.advance(5);
    let panes = indexLayout(
      keyboard.presentation().layers.find((layer) => layer.prefix === 'keyboard-ascii:').layout,
    ).panes;
    assert.ok(panes.get('P_key_11').scale[0] > 1);
    assert.equal(panes.get('P_key_12').scale[0], 1);
    keyboard.keyInput('Shift', { type: 'keyup', shiftKey: false });
    assert.equal(keyboard.snapshot().shift, false);
    keyboard.advance(20);
    panes = indexLayout(
      keyboard.presentation().layers.find((layer) => layer.prefix === 'keyboard-ascii:').layout,
    ).panes;
    assert.equal(panes.get('P_key_11').scale[0], 1);
    assert.equal(keyboard.snapshot().text, 'Q');
    assert.deepEqual(sounds, ['WIPL_SE_SK_SWITCHING_02', 'WIPL_SE_CHAR_INPUT']);
    keyboard.keyInput('Backspace');
    keyboard.keyInput('Backspace');
    assert.deepEqual(sounds.slice(-2), ['WIPL_SE_CHAR_DELETE', 'WIPL_SE_CHAR_DELETE_ERROR']);
  },
);

test(
  'releasing one physical Shift retains the other held key without another cue',
  { skip: !available },
  () => {
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, { onSound: (id) => sounds.push(id) });
    keyboard.keyInput('Shift', { code: 'ShiftLeft', shiftKey: true });
    keyboard.keyInput('Shift', { code: 'ShiftRight', shiftKey: true });
    keyboard.keyInput('Shift', { type: 'keyup', code: 'ShiftLeft', shiftKey: true });
    assert.equal(keyboard.snapshot().shift, true);
    keyboard.keyInput('Q', { code: 'KeyQ', shiftKey: true });
    assert.equal(keyboard.snapshot().shift, true);
    keyboard.keyInput('Shift', { type: 'keyup', code: 'ShiftRight', shiftKey: false });
    assert.equal(keyboard.snapshot().shift, false);
    assert.deepEqual(sounds, ['WIPL_SE_SK_SWITCHING_02', 'WIPL_SE_CHAR_INPUT']);
    // A host without the aggregate modifier bit retains the release fallback.
    keyboard.keyInput('Shift');
    assert.equal(keyboard.snapshot().shift, true);
    keyboard.keyInput('Shift', { type: 'keyup' });
    assert.equal(keyboard.snapshot().shift, false);
  },
);

test(
  'physical Caps Lock synchronizes state on either event edge and recovers after focus loss',
  { skip: !available },
  () => {
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, { onSound: (id) => sounds.push(id) });
    const capsEvent = (type, capsLock, repeat = false) =>
      keyboard.keyInput('CapsLock', { type, capsLock, repeat });
    capsEvent('keydown', true);
    assert.equal(keyboard.snapshot().caps, true);
    capsEvent('keydown', true, true);
    capsEvent('keyup', true);
    assert.equal(keyboard.snapshot().caps, true);
    assert.equal(sounds.length, 1);
    // macOS can send only the release edge for the next physical toggle.
    capsEvent('keyup', false);
    assert.equal(keyboard.snapshot().caps, false);
    assert.equal(sounds.length, 2);
    capsEvent('keydown', true);
    keyboard.keyInput('Shift', { shiftKey: true, capsLock: true });
    keyboard.keyInput('', { type: 'blur' });
    assert.equal(keyboard.snapshot().shift, false);
    assert.equal(keyboard.snapshot().caps, true);
    // Caps was turned off outside the window; a later ordinary event repairs it.
    keyboard.keyInput('a', { capsLock: false });
    assert.equal(keyboard.snapshot().caps, false);
    assert.equal(keyboard.snapshot().text, 'a');
    keyboard.activate('key-caps');
    keyboard.keyInput('b', { capsLock: false });
    assert.equal(keyboard.snapshot().caps, true);
    assert.equal(keyboard.snapshot().text, 'ab');
    assert.deepEqual(
      sounds.filter((id) => id === 'WIPL_SE_SK_SWITCHING_02'),
      Array(6).fill('WIPL_SE_SK_SWITCHING_02'),
    );
  },
);

test(
  'Caps Lock fallback ignores repeat and does not require a missing keyup',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.keyInput('CapsLock');
    assert.equal(keyboard.snapshot().caps, true);
    keyboard.keyInput('CapsLock', { repeat: true });
    assert.equal(keyboard.snapshot().caps, true);
    keyboard.keyInput('CapsLock');
    assert.equal(keyboard.snapshot().caps, false);
    keyboard.keyInput('CapsLock', { type: 'keyup' });
    assert.equal(keyboard.snapshot().caps, false);
    keyboard.keyInput('', { type: 'blur' });
    keyboard.keyInput('CapsLock');
    assert.equal(keyboard.snapshot().caps, true);
  },
);

test(
  'dictionary toggle and US language selector use independent native transitions',
  { skip: !available },
  () => {
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, { onSound: (id) => sounds.push(id) });
    const pane = (prefix, name) =>
      indexLayout(
        keyboard.presentation().layers.find((layer) => layer.prefix === prefix).layout,
      ).panes.get(name);
    assert.equal(pane('keyboard-prediction:', 'W_predictWindow').alpha, 0);
    assert.equal(keyboard.activate('key-prediction'), true);
    keyboard.advance(6);
    assert.equal(pane('keyboard-ascii:', 'P_prdc_OFF').flags & 1, 1);
    assert.equal(keyboard.activate('key-prediction'), false);
    keyboard.advance(6);
    assert.equal(pane('keyboard-prediction:', 'W_predictWindow').alpha, 255);
    assert.equal(pane('keyboard-ascii:', 'P_prdc_ON').flags & 1, 1);
    assert.equal(keyboard.activate('key-language'), true);
    assert.equal(keyboard.activate('key-language-fr'), false);
    keyboard.advance(18);
    assert.deepEqual(
      keyboard.controls().map((item) => item.label),
      ['English', 'Français', 'Español'],
    );
    assert.equal(pane('keyboard-language:', 'N_PRDCkeytop_all').alpha, 255);
    keyboard.activate('key-language-fr');
    keyboard.advance(12);
    assert.equal(keyboard.snapshot().languageOpen, true);
    keyboard.advance(1);
    assert.equal(keyboard.snapshot().languageOpen, false);
    assert.equal(pane('keyboard-ascii:', 'T_USEU_prdc_lang').text, 'Fra');
    assert.equal(keyboard.snapshot().predictionEnabled, true);
    assert.deepEqual(sounds, [
      'WIPL_SE_SK_PREDICT_ON',
      'WIPL_SE_SYMBOL_PAGE_OPEN',
      'WIPL_SE_SK_SWITCHING_02',
    ]);
  },
);

test(
  'telephone layout retains text, cycles original letters, changes modes and returns to QWERTY',
  { skip: !available },
  () => {
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, { onSound: (id) => sounds.push(id) });
    keyboard.activate('key-phone');
    assert.equal(keyboard.snapshot().layoutMode, 'phone');
    let view = keyboard.presentation();
    for (const item of view.controls)
      assert.ok(
        indexLayout(view.layers.find((layer) => layer.prefix === item.prefix).layout).panes.has(
          item.pane,
        ),
      );
    keyboard.activate('key-phone-1');
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'B');
    keyboard.activate('key-phone-2');
    assert.equal(keyboard.snapshot().text, 'Bd');
    keyboard.activate('key-phone-mode-3');
    keyboard.activate('key-phone-0');
    keyboard.activate('key-phone-0');
    assert.equal(keyboard.snapshot().text, 'Bd11');
    keyboard.activate('key-qwerty');
    keyboard.advance(20);
    assert.equal(keyboard.snapshot().layoutMode, 'qwerty');
    assert.ok(sounds.includes('WIPL_SE_SK_SWITCH_TO_KETAI'));
    assert.equal(sounds.at(-1), 'WIPL_SE_SK_SWITCHING_01');
  },
);

test(
  'telephone multi-tap commits after 90 hovered updates and each press restarts that counter',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.activate('key-phone');
    keyboard.hover('key-phone-1');
    keyboard.advance(120);
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'A');
    keyboard.advance(89);
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'B', 'a late repeated press still cycles');
    keyboard.advance(1);
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'C', 'the previous press reset the counter');
    keyboard.advance(89);
    assert.equal(keyboard.snapshot().text, 'C');
    keyboard.advance(1);
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'Ca', 'the committed character is no longer replaced');
    keyboard.advance(120);
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'Caa', 'batched updates cross the same commit boundary');
  },
);

test(
  'telephone multi-tap departure commits without ending telephone dictionary composition',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.activate('key-phone');
    keyboard.hover('key-phone-1');
    keyboard.activate('key-phone-1');
    keyboard.hover(null);
    keyboard.hover('key-phone-1');
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'Aa');
    keyboard.hover('key-phone-2');
    keyboard.hover('key-phone-1');
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'Aaa', 'entering another key also commits');
    keyboard.keyInput('', { type: 'blur' });
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'Aaaa', 'host focus loss ends the pending key');

    const predicted = createBoardKeyboard(layouts, { value: 'g' });
    predicted.activate('key-phone');
    predicted.activate('key-prediction');
    predicted.advance(12);
    predicted.hover('key-phone-5');
    predicted.activate('key-phone-5');
    predicted.advance(90);
    predicted.hover(null);
    predicted.hover('key-phone-5');
    predicted.activate('key-phone-5');
    predicted.activate('key-phone-5');
    assert.equal(predicted.snapshot().text, 'gmom');
    assert.deepEqual(predicted.snapshot().composition, { start: 1, end: 4 });
  },
);

test(
  'explicit secondary phone trigger reverses the original cycle and primary retains priority',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts, {
      initialPreferences: { layoutMode: 'phone', phoneMode: 1 },
    });
    keyboard.hover('key-phone-1');
    for (const expected of ['2', 'c', 'b', 'a', '2']) {
      assert.equal(keyboard.activate('key-phone-1', { secondary: true }), true);
      assert.equal(keyboard.snapshot().text, expected);
    }
    keyboard.activate('key-phone-1', { primary: true, secondary: true });
    assert.equal(keyboard.snapshot().text, 'a', 'A has priority over B on the same update');
    keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, 'b', 'existing calls remain primary triggers');
    keyboard.hover(null);
    keyboard.hover('key-phone-1');
    keyboard.activate('key-phone-1', { primary: true, secondary: true });
    assert.equal(keyboard.snapshot().text, 'ba', 'A also wins with no pending character');
    keyboard.advance(89);
    keyboard.activate('key-phone-1', { secondary: true });
    assert.equal(keyboard.snapshot().text, 'b2');
    keyboard.advance(1);
    keyboard.activate('key-phone-1', { secondary: true });
    assert.equal(keyboard.snapshot().text, 'bc', 'B restarted the pending key counter');
    keyboard.advance(90);
    keyboard.activate('key-phone-1', { secondary: true });
    assert.equal(keyboard.snapshot().text, 'bc2', 'B after commitment starts a fresh reverse cycle');
  },
);

test(
  'secondary phone activation cannot invoke cancel, editing commands, tabs or hidden keytops',
  { skip: !available },
  () => {
    const sounds = [];
    const closes = [];
    const keyboard = createBoardKeyboard(layouts, {
      value: 'draft', onSound: (id) => sounds.push(id), onClose: (...args) => closes.push(args),
    });
    assert.equal(keyboard.activate('key-phone-1', { secondary: true }), false);
    assert.equal(keyboard.activate('key-phone', { secondary: true }), false);
    keyboard.activate('key-phone');
    sounds.length = 0;
    const before = keyboard.snapshot();
    for (const id of ['key-back', 'key-ok', 'key-delete', 'key-return', 'key-phone-mode-2',
      'key-qwerty', 'key-prediction', 'key-more', 'key-phone-9', 'key-phone-11']) {
      assert.equal(keyboard.activate(id, { secondary: true }), false, id);
    }
    assert.equal(keyboard.activate('key-phone-1', { primary: false, secondary: false }), false);
    assert.deepEqual(keyboard.snapshot(), before);
    assert.deepEqual(closes, []);
    assert.deepEqual(sounds, []);
    keyboard.keyInput('Escape');
    assert.equal(closes.length, 1, 'the independent host cancellation path is unchanged');
    assert.equal(closes[0][1].reason, 'cancel');
  },
);

test(
  'secondary phone triggers retain numeric records and all three Latin prediction requests',
  { skip: !available },
  () => {
    for (const nativeType of [undefined, 3, 10, 12]) {
      const make = () => createBoardKeyboard(layouts, {
        nativeType, initialPreferences: { layoutMode: 'phone', phoneMode: 3 },
      });
      const primary = make();
      const secondary = make();
      for (const item of primary.controls().filter((item) => /^key-phone-\d+$/.test(item.id))) {
        primary.activate(item.id);
        secondary.activate(item.id, { secondary: true });
      }
      assert.equal(secondary.snapshot().text, primary.snapshot().text);
      assert.equal(secondary.snapshot().caret, primary.snapshot().caret);
      assert.equal(secondary.snapshot().composition, null);
    }
    for (const language of ['en', 'fr', 'es']) {
      const make = () => {
        const calls = [];
        const predict = (text, options) => {
          calls.push({ text, ...options });
          return { engine: 'synthetic-test', candidates: [] };
        };
        predict.reset = () => calls.push({ action: 'reset' });
        predict.accept = () => calls.push({ action: 'accept' });
        return {
          calls,
          keyboard: createBoardKeyboard(layouts, {
            predict,
            initialPreferences: {
              layoutMode: 'phone', phoneMode: 1, predictionEnabled: true,
              dictionaryLanguage: language,
            },
          }),
        };
      };
      const primary = make();
      const secondary = make();
      for (const id of ['key-phone-5', 'key-phone-5', 'key-phone-1']) {
        primary.keyboard.activate(id);
        secondary.keyboard.activate(id, { secondary: true });
        const first = primary.keyboard.snapshot();
        const second = secondary.keyboard.snapshot();
        assert.equal(second.text, first.text);
        assert.deepEqual(second.composition, first.composition);
        assert.deepEqual(secondary.calls, primary.calls);
      }
      assert.equal(secondary.calls.at(-1).digits, '662');
      assert.equal(secondary.calls.at(-1).language, language);
      assert.equal(secondary.calls.some((call) => call.action), false);
    }
  },
);

test(
  'telephone prediction composes one letter per key and supports correction and acceptance',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts, { value: 'g' });
    keyboard.activate('key-phone');
    keyboard.activate('key-prediction');
    keyboard.advance(12);
    keyboard.activate('key-phone-5');
    keyboard.activate('key-phone-5');
    keyboard.activate('key-phone-5');
    assert.equal(keyboard.snapshot().text, 'gmom');
    assert.deepEqual(keyboard.snapshot().composition, { start: 1, end: 4 });
    assert.ok(keyboard.controls().some((control) => control.label === 'money'));
    keyboard.activate('key-delete');
    assert.equal(keyboard.snapshot().text, 'gno');
    keyboard.activate('key-phone-5');
    const selected = keyboard.controls().find((control) => control.label === 'money');
    keyboard.activate(selected.id);
    assert.equal(keyboard.snapshot().text, 'gmoney');
    assert.equal(keyboard.snapshot().composition, null);
  },
);

test(
  'candidate insertion plays only rejection when too long and only decide when accepted',
  { skip: !available },
  () => {
    const sounds = [];
    const changes = [];
    const keyboard = createBoardKeyboard(layouts, {
      maxLength: 4,
      predict: () => ['hello', 'help'],
      onSound: (id) => sounds.push(id),
      onChange: (value) => changes.push(value),
    });
    keyboard.activate('key-prediction');
    keyboard.advance(12);
    keyboard.keyInput('h');
    keyboard.keyInput('e');
    changes.length = 0;
    sounds.length = 0;
    const tooLong = keyboard.controls().find((control) => control.label === 'hello');
    assert.equal(keyboard.activate(tooLong.id), false);
    assert.equal(keyboard.snapshot().text, 'he');
    assert.equal(keyboard.snapshot().caret, 2);
    assert.deepEqual(changes, []);
    assert.deepEqual(sounds, ['WIPL_SE_CHAR_DELETE_ERROR']);
    sounds.length = 0;
    const fitting = keyboard.controls().find((control) => control.label === 'help');
    assert.equal(keyboard.activate(fitting.id), true);
    assert.equal(keyboard.snapshot().text, 'help');
    assert.equal(keyboard.snapshot().caret, 4);
    assert.deepEqual(changes, ['help']);
    assert.deepEqual(sounds, ['WIPL_SE_CHAR_DECIDE']);
  },
);

test(
  'candidate strip reaches frame 15 while busy and unlocks on the next native scalar update',
  { skip: !available },
  () => {
    const changes = [];
    const keyboard = createBoardKeyboard(layouts, {
      value: ' ending',
      predict: () => ['hello', 'help', 'hermit', 'hero'],
      measureText: () => 200,
      onChange: (text) => changes.push(text),
    });
    for (let index = 0; index < 7; index++) keyboard.keyInput('ArrowLeft');
    keyboard.activate('key-prediction');
    keyboard.advance(12);
    keyboard.keyInput('h');
    keyboard.keyInput('e');
    changes.length = 0;
    let strip = keyboard.snapshot().candidateStrip;
    assert.equal(strip.entries.length, 3);
    assert.ok(
      strip.entries[2].clippedRight - strip.entries[2].clippedLeft < strip.entries[2].screenWidth,
    );
    const layers = keyboard
      .presentation()
      .layers.filter((layer) => layer.prefix === 'keyboard-prediction:');
    assert.equal(layers.length, 2);
    const panes = indexLayout(layers[0].layout).panes;
    assert.ok(Math.abs(panes.get('B_prdc_Text_00').size[0] - (200.01 * 608) / 832) < 1e-9);
    assert.equal(indexLayout(layers[1].layout).panes.get('T_prdc_Text_00').text, 'hello');
    assert.ok(layers[1].clip.w > 500);
    keyboard.hover('key-candidate-0');
    assert.equal(keyboard.snapshot().displayText, 'hello ending');
    assert.equal(keyboard.snapshot().text, 'he ending');
    assert.equal(changes.length, 0);
    assert.equal(keyboard.presentation().layers.filter((layer) => layer.clip).length, 2);
    keyboard.hover(null);
    assert.equal(keyboard.snapshot().displayText, 'hello ending');
    assert.deepEqual(keyboard.snapshot().textColorRanges.at(-1).color, [192, 192, 192, 255]);
    keyboard.activate('key-candidates-next');
    assert.equal(keyboard.snapshot().candidateStrip.offset, 0);
    assert.equal(keyboard.activate('key-candidate-2'), false);
    keyboard.advance(7.5);
    strip = keyboard.snapshot().candidateStrip;
    const midpoint = strip.offset;
    assert.equal(strip.scrolling, true);
    keyboard.advance(7.5);
    strip = keyboard.snapshot().candidateStrip;
    assert.equal(strip.scrolling, true, 'frame 15 remains the active endpoint');
    assert.equal(keyboard.activate('key-candidate-2'), false);
    assert.ok(Math.abs(strip.offset - 2 * midpoint) < 1e-9);
    keyboard.advance(1);
    strip = keyboard.snapshot().candidateStrip;
    assert.equal(strip.scrolling, false);
    assert.equal(strip.first, 2);
    assert.ok(Math.abs(strip.offset - 2 * midpoint) < 1e-9);
    keyboard.activate('key-candidate-2');
    assert.equal(keyboard.snapshot().text, 'hermit ending');
    assert.equal(keyboard.snapshot().caret, 6);
    assert.equal(changes.length, 1);
  },
);


test('held Backspace and QWERTY Space repeat only their original keytop owner at 36 then every 9',
  { skip: !available }, () => {
    for (const aspect of ['4:3', '16:9']) {
      for (const variant of ['ascii-delete', 'ascii-space', 'phone-delete', 'numeric-delete']) {
        let update = 0;
        const actions = [];
        const deleting = !variant.endsWith('space');
        const keyboard = createBoardKeyboard(layouts, {
          display: createDisplay(aspect),
          value: '1234567890123456',
          nativeType: variant === 'numeric-delete' ? 12 : undefined,
          initialPreferences: { layoutMode: variant === 'phone-delete' ? 'phone' : 'qwerty' },
          onChange: (text) => actions.push({ update, text }),
        });
        const id = deleting ? 'key-delete' : 'key-space';
        keyboard.hover(id);
        assert.equal(keyboard.holdControl(id, { secondary: true }), false);
        assert.equal(actions.length, 0, 'B never owns delete/space repetition');
        assert.equal(keyboard.holdControl(id), true);
        assert.equal(actions.length, 1, 'fresh primary press edits immediately');
        for (update = 1; update <= 55; update++) keyboard.advance(1);
        assert.deepEqual(actions.map((action) => action.update), [0, 36, 45, 54], variant);
        assert.equal(keyboard.snapshot().text,
          deleting ? '123456789012' : '1234567890123456    ');
        keyboard.releaseControl();
        keyboard.advance(100);
        assert.equal(actions.length, 4, 'release ends repetition without another click');
        assert.equal(keyboard.hover(id), false, 'release retains pointer focus');
        keyboard.activate(id);
        keyboard.advance(100);
        assert.equal(actions.length, 5, 'ordinary activation remains one immediate action');
      }
    }
  });

test('keytop holds cancel on departure, blur, overlays, layout changes, replacement press and close',
  { skip: !available }, () => {
    const stops = {
      departure: (keyboard) => keyboard.hover(null),
      blur: (keyboard) => keyboard.keyInput('', { type: 'blur' }),
      symbols: (keyboard) => keyboard.activate('key-more'),
      language: (keyboard) => keyboard.activate('key-language'),
      layout: (keyboard) => keyboard.activate('key-phone'),
      replacement: (keyboard) => keyboard.activate('key-space'),
      escape: (keyboard) => keyboard.keyInput('Escape'),
      back: (keyboard) => keyboard.back(),
      dispose: (keyboard) => keyboard.dispose(),
    };
    for (const [name, stop] of Object.entries(stops)) {
      const keyboard = createBoardKeyboard(layouts, { value: 'abcdefghijklmnop' });
      keyboard.hover('key-delete');
      assert.equal(keyboard.holdControl('key-delete'), true);
      keyboard.advance(35.75);
      stop(keyboard);
      const stopped = keyboard.snapshot().text;
      keyboard.advance(200);
      assert.equal(keyboard.snapshot().text, stopped, name);
    }
    const keyboard = createBoardKeyboard(layouts);
    for (const id of ['key-12', 'key-return', 'key-shift', 'key-caps', 'key-phone']) {
      assert.equal(keyboard.holdControl(id), false, id);
    }
    keyboard.activate('key-phone');
    for (const id of ['key-phone-1', 'key-phone-10', 'key-space', 'key-phone-mode-2']) {
      assert.equal(keyboard.holdControl(id), false, id);
    }
    assert.equal(keyboard.snapshot().text, '', 'hover and unsupported holds do not type');
  });

test('held correction preserves the active ASCII or telephone composition until its last unit',
  { skip: !available }, () => {
    for (const phone of [false, true]) {
      const requests = [];
      let resets = 0;
      const predict = (prefix, options) => {
        requests.push({ prefix, ...options });
        return [];
      };
      predict.reset = () => { resets++; };
      const keyboard = createBoardKeyboard(layouts, {
        value: 'x', initialPredictionEnabled: true, predict,
        initialPreferences: { layoutMode: phone ? 'phone' : 'qwerty' },
      });
      if (phone) {
        for (const id of ['key-phone-5', 'key-phone-5', 'key-phone-1']) keyboard.activate(id);
      } else {
        for (const character of 'hel') keyboard.keyInput(character);
      }
      keyboard.snapshot();
      keyboard.hover('key-delete');
      keyboard.holdControl('key-delete');
      assert.deepEqual(keyboard.snapshot().composition, { start: 1, end: 3 });
      assert.equal(phone ? requests.at(-1).digits : requests.at(-1).prefix, phone ? '66' : 'he');
      assert.equal(resets, 0);
      keyboard.advance(36);
      assert.deepEqual(keyboard.snapshot().composition, { start: 1, end: 2 });
      assert.equal(phone ? requests.at(-1).digits : requests.at(-1).prefix, phone ? '6' : 'h');
      assert.equal(resets, 0);
      keyboard.advance(9);
      assert.equal(keyboard.snapshot().composition, null);
      assert.equal(keyboard.snapshot().text, 'x');
      assert.equal(resets, 1);
      keyboard.releaseControl();
    }
    const keyboard = createBoardKeyboard(layouts, { initialPredictionEnabled: true });
    for (const character of 'hel') keyboard.keyInput(character);
    keyboard.holdControl('key-space');
    assert.equal(keyboard.snapshot().composition, null);
    keyboard.advance(45);
    assert.equal(keyboard.snapshot().text, 'hel   ', 'held Space commits once then adds literal spaces');
  });

test('keytop held timing is invariant under batched and fractional scene updates',
  { skip: !available }, () => {
    const make = () => {
      const keyboard = createBoardKeyboard(layouts, { value: 'abcdefghijklmnop' });
      keyboard.holdControl('key-delete');
      return keyboard;
    };
    const split = make();
    const bulk = make();
    for (let frame = 0; frame < 100; frame++) {
      split.advance(0.25);
      split.advance(0.75);
    }
    bulk.advance(100);
    assert.equal(split.snapshot().text, 'abcdefg');
    assert.equal(split.snapshot().text, bulk.snapshot().text);
    assert.equal(split.snapshot().caret, bulk.snapshot().caret);
    split.releaseControl();
    split.holdControl('key-delete');
    split.advance(35);
    assert.equal(split.snapshot().text, 'abcdef', 'a new press restarts the native counter');
    split.advance(1);
    assert.equal(split.snapshot().text, 'abcde');
  });

test('held candidate arrows follow original scalar/counter requests without text-scroll timing',
  { skip: !available }, () => {
    for (const aspect of ['4:3', '16:9']) {
      let update = 0;
      const pages = [];
      const sounds = [];
      const keyboard = createBoardKeyboard(layouts, {
        display: createDisplay(aspect),
        initialPredictionEnabled: true,
        predict: () => Array.from({ length: 40 }, (_, index) => `hello${index}`),
        measureText: () => 220,
        onSound: (name) => {
          sounds.push(name);
          if (name === 'WIPL_SE_LINE_SCROLL') pages.push(update);
        },
      });
      keyboard.keyInput('h');
      keyboard.hover('key-candidates-next');
      assert.equal(keyboard.holdControl('key-candidates-next'), true);
      for (update = 1; update <= 100; update++) keyboard.advance(1);
      // Executed original Scalar::calc + button counter + candidate callback:
      // tools/dictionary/audit-candidate-input.py, both original directions.
      assert.deepEqual(pages, [0, 16, 32, 48, 64, 81, 97], aspect);
      assert.equal(sounds.filter((name) => name === 'WIPL_SE_CHAR_FOCUS').length, 1);
      keyboard.releaseControl();
      keyboard.advance(100);
      assert.equal(pages.length, 7, 'release stops page requests');
      assert.equal(keyboard.hover('key-candidates-next'), false, 'release retains arrow focus');
      keyboard.hover('key-candidates-prev');
      assert.equal(keyboard.holdControl('key-candidates-prev'), true);
      keyboard.advance(16);
      assert.equal(pages.length, 9, 'previous uses the same original held path');
      keyboard.hover(null);
      keyboard.advance(100);
      assert.equal(pages.length, 9, 'real departure stops held input');
      assert.equal(keyboard.snapshot().text, 'h', 'paging never commits preview text');
    }
  });

test('candidate hold preserves fractional updates and stops at bounds, blur, and disposal',
  { skip: !available }, () => {
    const make = (count = 40) => {
      const pages = [];
      const keyboard = createBoardKeyboard(layouts, {
        initialPredictionEnabled: true,
        predict: () => Array.from({ length: count }, (_, index) => `hello${index}`),
        measureText: () => 220,
        onSound: (name) => { if (name === 'WIPL_SE_LINE_SCROLL') pages.push(name); },
      });
      keyboard.keyInput('h');
      keyboard.hover('key-candidates-next');
      assert.equal(keyboard.holdControl('key-candidate-0'), false);
      assert.equal(keyboard.holdControl('key-candidates-next'), true);
      return { keyboard, pages };
    };
    const split = make();
    const bulk = make();
    for (let frame = 0; frame < 100; frame++) {
      split.keyboard.advance(0.25);
      split.keyboard.advance(0.75);
    }
    bulk.keyboard.advance(100);
    assert.deepEqual(split.keyboard.snapshot().candidateStrip, bulk.keyboard.snapshot().candidateStrip);
    assert.equal(split.pages.length, 7);
    assert.equal(bulk.pages.length, 7);
    for (const reason of ['blur', 'dispose']) {
      const { keyboard, pages } = make();
      if (reason === 'blur') keyboard.keyInput('', { type: 'blur' });
      else keyboard.dispose();
      keyboard.advance(100);
      assert.equal(pages.length, 1, reason);
    }
    const bounded = make(4);
    bounded.keyboard.advance(100);
    assert.equal(bounded.pages.length, 1);
    assert.equal(bounded.keyboard.controls().some((item) => item.id === 'key-candidates-next'), false);
    assert.equal(bounded.keyboard.holdControl('key-candidates-next'), false);
  });

test(
  'key focus retargets one original pane and material without inflating adjacent keys',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.hover('key-12');
    keyboard.advance(5);
    const view = keyboard.presentation(),
      ascii = view.layers.find((layer) => layer.prefix === 'keyboard-ascii:').layout;
    const panes = indexLayout(ascii).panes;
    assert.ok(panes.get('P_key_12').scale[0] > 1.2);
    assert.equal(panes.get('P_key_11').scale[0], 1);
    for (const control of view.controls)
      assert.ok(
        indexLayout(view.layers.find((layer) => layer.prefix === control.prefix).layout).panes.has(
          control.pane,
        ),
      );
  },
);

test(
  'Caps selection retains its color while pointer exit restores normal size',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    const capsPose = () => {
      const layout = keyboard
        .presentation()
        .layers.find((layer) => layer.prefix === 'keyboard-ascii:').layout;
      const pane = indexLayout(layout).panes.get('P_key_CAPS');
      return { scale: pane.scale, color: layout.materials[pane.material].colors[1] };
    };
    keyboard.hover('key-caps');
    keyboard.advance(5);
    assert.ok(capsPose().scale[0] > 1.2);
    assert.equal(keyboard.snapshot().caps, false);
    assert.equal(capsPose().color[2], 255);
    keyboard.activate('key-caps');
    keyboard.advance(20);
    assert.equal(keyboard.snapshot().caps, true);
    assert.equal(capsPose().color[2], 32);
    // Native selected Pushed completes into selected hover when focus remains.
    assert.ok(capsPose().scale[0] > 1.2);
    keyboard.advance(60);
    assert.ok(capsPose().scale[0] > 1.2);
    assert.equal(capsPose().color[2], 32);
    keyboard.hover('key-11');
    keyboard.advance(8);
    for (const frames of [0, 1, 20, 60]) {
      keyboard.advance(frames);
      assert.deepEqual(capsPose().scale, [1, 1]);
      assert.equal(capsPose().color[2], 32);
      assert.equal(keyboard.snapshot().caps, true);
    }
    keyboard.hover('key-caps');
    keyboard.advance(5);
    assert.ok(capsPose().scale[0] > 1.2);
    assert.equal(capsPose().color[2], 32);
    keyboard.activate('key-caps');
    keyboard.advance(20);
    keyboard.hover(null);
    keyboard.advance(8);
    assert.equal(keyboard.snapshot().caps, false);
    assert.deepEqual(capsPose().scale, [1, 1]);
    assert.equal(capsPose().color[2], 255);
  },
);

test(
  'only the unselected keyboard layout responds visually to pointer focus',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts, { profile: 'console-nickname' });
    const pose = (name) => {
      const layout = keyboard
        .presentation()
        .layers.find((layer) => layer.prefix === 'keyboard-toolbar:').layout;
      const pane = indexLayout(layout).panes.get(name);
      return { scale: pane.scale, color: layout.materials[pane.material].colors[1] };
    };
    const selected = pose('P_kyChng_QWERTY');
    keyboard.hover('key-qwerty');
    keyboard.advance(10);
    assert.deepEqual(pose('P_kyChng_QWERTY'), selected);
    keyboard.activate('key-qwerty');
    keyboard.advance(3);
    assert.deepEqual(pose('P_kyChng_QWERTY'), selected);
    keyboard.hover('key-phone');
    keyboard.advance(5);
    assert.ok(pose('P_kyChng_CP').scale[0] > 1);
    keyboard.activate('key-phone');
    keyboard.advance(20);
    const phone = pose('P_kyChng_CP');
    assert.deepEqual(phone.scale, [1, 1]);
    keyboard.hover('key-phone');
    keyboard.advance(10);
    assert.deepEqual(pose('P_kyChng_CP'), phone);
    keyboard.hover(null);
    keyboard.advance(10);
    assert.deepEqual(pose('P_kyChng_CP'), phone);
    keyboard.hover('key-qwerty');
    keyboard.advance(5);
    assert.ok(pose('P_kyChng_QWERTY').scale[0] > 1);
  },
);

test(
  'full Nickname fields play only rejection feedback while accepted keys play only input',
  { skip: !available },
  () => {
    const sounds = [];
    const edits = [];
    const keyboard = createBoardKeyboard(layouts, {
      profile: 'console-nickname',
      value: '1234567890',
      onSound: (id) => sounds.push(id),
      onChange: (text) => edits.push(text),
    });
    keyboard.keyInput('a');
    keyboard.keyInput('b');
    keyboard.activate('key-11');
    keyboard.activate('key-space');
    assert.equal(keyboard.snapshot().text, '1234567890');
    assert.equal(keyboard.snapshot().caret, 10);
    assert.deepEqual(edits, []);
    assert.deepEqual(sounds, Array(4).fill('WIPL_SE_CHAR_DELETE_ERROR'));
    keyboard.keyInput('Backspace');
    keyboard.keyInput('a');
    assert.equal(keyboard.snapshot().text, '123456789a');
    assert.deepEqual(sounds.slice(4), ['WIPL_SE_CHAR_DELETE', 'WIPL_SE_CHAR_INPUT']);
    const toolbar = keyboard
      .presentation()
      .layers.find((layer) => layer.prefix === 'keyboard-toolbar:').layout;
    assert.equal(indexLayout(toolbar).panes.get('T_BT_cancel').text, 'Quit');
    assert.equal(keyboard.controls().find((item) => item.id === 'key-back').label, 'Quit');
  },
);

test(
  'telephone prediction rejection emits no accepted-input sound and preserves its composition',
  { skip: !available },
  () => {
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, {
      maxLength: 1,
      onSound: (id) => sounds.push(id),
    });
    keyboard.activate('key-phone');
    keyboard.activate('key-prediction');
    keyboard.advance(12);
    sounds.length = 0;
    keyboard.activate('key-phone-1');
    const accepted = keyboard.snapshot();
    assert.equal(accepted.text.length, 1);
    assert.deepEqual(sounds, ['WIPL_SE_CHAR_INPUT']);
    sounds.length = 0;
    keyboard.activate('key-phone-2');
    assert.equal(keyboard.snapshot().text, accepted.text);
    assert.equal(keyboard.snapshot().caret, accepted.caret);
    assert.deepEqual(sounds, ['WIPL_SE_CHAR_DELETE_ERROR']);
  },
);

test(
  'symbol overlay actually appears and changes pages through original BRLAN states',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.activate('key-more');
    keyboard.advance(18);
    let overlay = keyboard
      .presentation()
      .layers.find((layer) => layer.prefix === 'keyboard-symbols:').layout;
    assert.equal(indexLayout(overlay).panes.get('N_SGNkeytop_all').alpha, 255);
    assert.equal(indexLayout(overlay).panes.get('T_SGNkey_00').text, '.');
    keyboard.activate('key-symbols-next');
    keyboard.advance(10);
    overlay = keyboard
      .presentation()
      .layers.find((layer) => layer.prefix === 'keyboard-symbols:').layout;
    assert.ok(indexLayout(overlay).panes.get('N_SGNkeyall_00').translation[0] > 0);
    assert.equal(indexLayout(overlay).panes.get('T_SGNkey_20').text, '[');
    keyboard.advance(10);
    assert.equal(keyboard.snapshot().symbolPage, 1);
  },
);

test(
  'asynchronous original prediction discards stale results and keeps literal text available',
  { skip: !available },
  async () => {
    const requests = [];
    const keyboard = createBoardKeyboard(layouts, {
      predict: (text, options) =>
        new Promise((resolve, reject) => requests.push({ text, options, resolve, reject })),
    });
    keyboard.activate('key-prediction');
    keyboard.advance(12);
    keyboard.keyInput('h');
    assert.equal(keyboard.snapshot().dictionary.state, 'loading');
    assert.deepEqual(
      keyboard.snapshot().candidateStrip.entries.map(({ value }) => value),
      ['h'],
    );
    keyboard.keyInput('e');
    keyboard.snapshot();
    assert.equal(requests.length, 2);
    requests[0].resolve({ engine: 'original-zi8', candidates: ['stale'] });
    await Promise.resolve();
    assert.equal(
      keyboard.controls().some((item) => item.label === 'stale'),
      false,
    );
    requests[1].resolve({ engine: 'original-zi8', candidates: ['he', 'here', 'help'] });
    await Promise.resolve();
    assert.equal(keyboard.snapshot().dictionary.engine, 'original-zi8');
    assert.equal(keyboard.controls().find((item) => item.id === 'key-candidate-0').label, 'he');
    keyboard.keyInput('l');
    keyboard.snapshot();
    requests[2].reject(new Error('Original dictionary unavailable'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(keyboard.snapshot().dictionary.state, 'unavailable');
    assert.equal(
      keyboard.controls().find((item) => item.id === 'key-candidate-0').label,
      'hel',
    );
    assert.equal(keyboard.snapshot().text, 'hel');
  },
);

test(
  'telephone async prediction updates only the active composition and preserves suffix text',
  { skip: !available },
  async () => {
    const requests = [];
    const keyboard = createBoardKeyboard(layouts, {
      value: 'x tail',
      predict: (text, options) =>
        new Promise((resolve) => requests.push({ text, options, resolve })),
    });
    for (let index = 0; index < 5; index++) keyboard.keyInput('ArrowLeft');
    keyboard.activate('key-phone');
    keyboard.activate('key-prediction');
    keyboard.advance(12);
    for (let index = 0; index < 3; index++) keyboard.activate('key-phone-5');
    keyboard.snapshot();
    const request = requests.at(-1);
    assert.equal(request.options.digits, '666');
    request.resolve({ engine: 'original-zi8', candidates: ['mom', 'mon', 'moo'] });
    await Promise.resolve();
    assert.equal(keyboard.snapshot().text, 'xmom tail');
    assert.equal(keyboard.snapshot().caret, 4);
    assert.equal(keyboard.snapshot().dictionary.engine, 'original-zi8');
  },
);

test(
  'Settings fields bound rows, retain a single-line caret and clip their scrolling text',
  { skip: !available },
  () => {
    const measureTextLayout = (text, pane) => {
      const width = pane.noWrap ? Infinity : 4;
      const parts = text.match(
        new RegExp(`.{1,${Number.isFinite(width) ? width : 999}}`, 'gu'),
      ) || [''];
      return {
        lineHeight: 42,
        lines: parts.map((part, row) => ({
          text: part,
          start: row * 4,
          end: row * 4 + part.length,
          x: 0,
          y: -row * 42,
          carets: Array.from({ length: part.length + 1 }, (_, index) => ({
            index: row * 4 + index,
            x: index * 100,
          })),
        })),
      };
    };
    const multiline = createBoardKeyboard(layouts, {
      nativeType: 7,
      rowLimit: 3,
      measureTextLayout,
    });
    for (const character of 'abcdefghijklmnop') multiline.keyInput(character);
    assert.equal(multiline.snapshot().text, 'abcdefghijkl');
    multiline.advance(15);
    assert.ok(multiline.snapshot().textField.y > 0);
    const textLayers = multiline
      .presentation()
      .layers.filter((layer) => layer.prefix === 'keyboard-text:');
    assert.equal(textLayers.length, 2);
    assert.equal(indexLayout(textLayers[0].layout).panes.get('P_txtScrll_UP').alpha, 255);
    assert.equal(textLayers[1].clipFollowsRoot, true);
    assert.ok(textLayers[1].clip.h > 0 && textLayers[1].clip.h < 100);
    assert.equal(indexLayout(textLayers[1].layout).panes.get('T_2l_TextBox').text, 'abcdefghijkl');
    const single = createBoardKeyboard(layouts, { nativeType: 6, rowLimit: 1, measureTextLayout });
    for (const character of 'abcdefghij') single.keyInput(character);
    single.advance(15);
    assert.equal(single.snapshot().textField.noWrap, true);
    assert.ok(single.snapshot().textField.x > 0);
    assert.equal(single.snapshot().textField.y, 0);
  },
);

test(
  'telephone selected tabs keep their pose while all focused keys draw above neighboring groups',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.activate('key-phone');
    keyboard.advance(20);
    const view = () =>
      keyboard.presentation().layers.find((layer) => layer.prefix === 'keyboard-phone:').layout;
    const pane = (name) => indexLayout(view()).panes.get(name);
    const selectedBefore = structuredClone(pane('W_ChngTag_00'));
    keyboard.hover('key-phone-mode-0');
    keyboard.advance(3);
    assert.deepEqual(pane('W_ChngTag_00'), selectedBefore);
    keyboard.hover(null);
    keyboard.advance(8);
    assert.deepEqual(pane('W_ChngTag_00'), selectedBefore);
    keyboard.hover('key-phone-mode-0');
    keyboard.activate('key-phone-mode-0');
    const clicked = view();
    const selected = indexLayout(clicked).panes.get('W_ChngTag_00');
    assert.deepEqual(clicked.materials[selected.material].colors[1].slice(0, 3), [144, 220, 232]);
    keyboard.advance(20);
    assert.equal(keyboard.snapshot().phoneMode, 0);
    assert.deepEqual(pane('W_ChngTag_00'), selectedBefore);

    for (const [id, picture, branch] of [
      ['key-phone-3', 'W_CPkey_03', 'N_CPkeytop'],
      ['key-delete', 'W_CPkey_DELETE', 'N_CP_del_all'],
      ['key-return', 'W_CPkey_LF', 'N_CP_LF_all'],
    ]) {
      keyboard.hover(id);
      keyboard.advance(5);
      const focused = indexLayout(view()).panes;
      assert.ok(focused.get(picture).scale[0] > 1.2, id);
      assert.equal(focused.get('N_CPkeytop_all').children.at(-1).name, branch, id);
      if (branch === 'N_CPkeytop')
        assert.equal(focused.get(branch).children.at(-1).name, picture);
      keyboard.hover(null);
      keyboard.advance(8);
      assert.equal(pane(picture).scale[0], 1, id);
    }
  },
);

test(
  'symbol page arrows share their source appearance before either arrow is focused',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.activate('key-more');
    const arrows = () => {
      const layer = keyboard.presentation().layers.find((layer) => layer.prefix === 'keyboard-symbols:');
      const panes = indexLayout(layer.layout).panes;
      const alpha = panes.get('P_SGNkey_close').alpha;
      assert.ok(['P_SGNkey_prev', 'P_SGNkey_next'].every((name) => panes.get(name).alpha === alpha));
      return alpha;
    };
    assert.equal(arrows(), 255);
    keyboard.advance(9);
    assert.equal(arrows(), 255);
    keyboard.advance(9);
    assert.equal(arrows(), 255);
    keyboard.activate('key-symbols-close');
    keyboard.advance(6);
    const closing = keyboard.presentation().layers.find((layer) => layer.prefix === 'keyboard-symbols:');
    const closingPanes = indexLayout(closing.layout).panes;
    assert.equal(closingPanes.get('P_SGNkey_prev').alpha, closingPanes.get('P_SGNkey_next').alpha);
  },
);

test(
  'dictionary composition previews gray and completes a Memo line with Enter',
  { skip: !available },
  () => {
    const requests = [];
    const preferences = [];
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, {
      value: 'old ',
      initialDictionaryLanguage: 'es',
      predict: (prefix) => {
        requests.push(prefix);
        return ['farmacia'];
      },
      onPreferencesChange: (value) => preferences.push(value),
      onSound: (id) => sounds.push(id),
    });
    for (const character of 'far') keyboard.keyInput(character);
    keyboard.activate('key-prediction');
    keyboard.advance(12);
    assert.equal(keyboard.snapshot().composition, null);
    assert.deepEqual(requests, []);
    for (let index = 0; index < 3; index++) keyboard.keyInput('Backspace');
    for (const character of 'far') keyboard.keyInput(character);
    let state = keyboard.snapshot();
    assert.deepEqual(state.composition, { start: 4, end: 7 });
    assert.equal(state.text, 'old far');
    assert.equal(state.displayText, 'old farmacia');
    assert.equal(state.displayCaret, 7);
    assert.deepEqual(state.textColorRanges, [
      { start: 4, end: 7, color: [255, 50, 50, 255] },
      { start: 7, end: 12, color: [192, 192, 192, 255] },
    ]);
    keyboard.keyInput('Enter');
    state = keyboard.snapshot();
    assert.equal(state.text, 'old far\n');
    assert.equal(state.caret, state.text.length);
    assert.equal(state.composition, null);
    assert.equal(state.candidateStrip.entries.length, 0);
    assert.deepEqual(state.textColorRanges, []);
    assert.equal(sounds.at(-1), 'WIPL_SE_CHAR_DECIDE');
    keyboard.keyInput('Backspace');
    assert.equal(keyboard.snapshot().candidateStrip.entries.length, 0);
    keyboard.activate('key-return');
    assert.equal(keyboard.snapshot().text, 'old far\n');
    assert.equal(sounds.at(-1), 'WIPL_SE_CHAR_DECIDE');
    keyboard.activate('key-prediction');
    assert.deepEqual(preferences, [
      normalizeKeyboardPreferences({
        schemaVersion: 2, predictionEnabled: true, dictionaryLanguage: 'es',
      }),
      normalizeKeyboardPreferences({
        schemaVersion: 2, predictionEnabled: false, dictionaryLanguage: 'es',
      }),
    ]);
  },
);

test(
  'dictionary exposes an unmatched composition literally, clears it on Space, and restarts after Enter',
  { skip: !available },
  () => {
    const sounds = [];
    const resets = [];
    let keyboard;
    const predict = () => [];
    predict.createSession = () => {
      const session = (prefix) => predict(prefix);
      session.reset = () => {
        const state = keyboard.snapshot();
        resets.push({ text: state.text, caret: state.caret });
      };
      return session;
    };
    keyboard = createBoardKeyboard(layouts, {
      initialPredictionEnabled: true,
      predict,
      onSound: (id) => sounds.push(id),
    });

    for (const character of 'zxq') keyboard.keyInput(character);
    let state = keyboard.snapshot();
    assert.deepEqual(state.candidateStrip.entries.map(({ value }) => value), ['zxq']);
    assert.equal(keyboard.controls().find((item) => item.id === 'key-candidate-0').label, 'zxq');

    keyboard.activate('key-candidate-0');
    state = keyboard.snapshot();
    assert.equal(state.text, 'zxq');
    assert.equal(state.composition, null);
    assert.equal(state.candidateStrip.entries.length, 0);

    keyboard.keyInput(' ');
    for (const character of 'mystery') keyboard.keyInput(character);
    assert.deepEqual(keyboard.snapshot().candidateStrip.entries.map(({ value }) => value), ['mystery']);
    keyboard.keyInput(' ');
    state = keyboard.snapshot();
    assert.equal(state.text, 'zxq mystery ');
    assert.equal(state.composition, null);
    assert.equal(state.candidateStrip.entries.length, 0);

    for (const character of 'next') keyboard.keyInput(character);
    const resetCount = resets.length;
    keyboard.keyInput('Enter');
    state = keyboard.snapshot();
    assert.equal(state.text, 'zxq mystery next\n');
    assert.equal(state.caret, state.text.length);
    assert.equal(resets.length, resetCount + 1);
    assert.deepEqual(resets.at(-1), { text: state.text, caret: state.caret });
    assert.equal(state.composition, null);
    assert.equal(state.candidateStrip.entries.length, 0);
    assert.equal(sounds.at(-1), 'WIPL_SE_CHAR_DECIDE');

    keyboard.keyInput('a');
    state = keyboard.snapshot();
    assert.deepEqual(state.candidateStrip.entries.map(({ value }) => value), ['a']);
    assert.deepEqual(state.composition, { start: state.text.length - 1, end: state.text.length });
  },
);

test(
  'accepted candidates and disabled prediction cannot resume composition on backspace',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts, {
      initialPredictionEnabled: true,
      predict: () => ['farmacia'],
    });
    for (const character of 'far') keyboard.keyInput(character);
    keyboard.activate('key-candidate-0');
    keyboard.keyInput('Backspace');
    keyboard.keyInput('Backspace');
    assert.equal(keyboard.snapshot().text, 'farmac');
    assert.equal(keyboard.snapshot().composition, null);
    assert.equal(keyboard.snapshot().candidateStrip.entries.length, 0);
    keyboard.keyInput('a');
    assert.notEqual(keyboard.snapshot().composition, null);
    keyboard.activate('key-prediction');
    assert.equal(keyboard.snapshot().composition, null);
    assert.deepEqual(keyboard.snapshot().textColorRanges, []);
  },
);

test(
  'moving the text caret uses Unicode boundaries and ends an unfinished composition',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts, {
      value: 'A😀Z',
      initialPredictionEnabled: true,
    });
    assert.equal(keyboard.setCaret(2), true);
    assert.equal(keyboard.snapshot().caret, 1);
    keyboard.keyInput('b');
    assert.equal(keyboard.snapshot().text, 'Ab😀Z');
    assert.deepEqual(keyboard.snapshot().composition, { start: 1, end: 2 });
    keyboard.setCaret(5);
    assert.equal(keyboard.snapshot().composition, null);
    keyboard.keyInput('c');
    assert.equal(keyboard.snapshot().text, 'Ab😀Zc');
  },
);

test('fresh text pointer commits the selected full word before a later press moves the caret',
  { skip: !available }, () => {
    for (const phone of [false, true]) {
      for (const index of [0, 3, 9]) {
        const sounds = [];
        const keyboard = createBoardKeyboard(layouts, {
          value: 'abYZ', initialPredictionEnabled: true,
          predict: () => ['hel', 'hello'], onSound: (name) => sounds.push(name),
        });
        keyboard.setCaret(2);
        if (phone) {
          keyboard.activate('key-phone');
          for (const digit of [3, 2, 4]) keyboard.activate(`key-phone-${digit}`);
        } else {
          for (const character of 'hel') keyboard.keyInput(character);
        }
        keyboard.hover('key-candidate-1');
        keyboard.hover(null);
        sounds.length = 0;
        assert.equal(keyboard.setCaret(index, { pointer: true }), true);
        assert.equal(keyboard.snapshot().text, 'abhelloYZ');
        assert.equal(keyboard.snapshot().caret, 7);
        assert.equal(keyboard.snapshot().composition, null);
        assert.deepEqual(sounds, ['WIPL_SE_CHAR_DECIDE']);
        assert.equal(keyboard.setCaret(index, { pointer: true }), true);
        assert.equal(keyboard.snapshot().caret, index);
        assert.deepEqual(sounds, ['WIPL_SE_CHAR_DECIDE', 'WIPL_SE_CHAR_CURSOR']);
      }
    }
  });

test('pending fresh-pointer commit preserves subsequent edits, a second click and normal close',
  { skip: !available }, async () => {
    const { provider, sessions } = deferredDictionary();
    const closes = [];
    const keyboard = createBoardKeyboard(layouts, {
      predict: provider, initialPredictionEnabled: true,
      onClose: (value) => closes.push(value),
    });
    for (const character of 'hel') keyboard.keyInput(character);
    assert.equal(keyboard.setCaret(0, { pointer: true }), true);
    keyboard.keyInput('x');
    keyboard.keyInput('Backspace');
    keyboard.setCaret(1, { pointer: true });
    keyboard.keyInput('Escape');
    assert.deepEqual(closes, []);
    sessions[0].requests.at(-1).resolve({ candidates: ['hello'] });
    await flushDictionary();
    assert.deepEqual(closes, ['hello']);
    assert.equal(keyboard.snapshot().caret, 1);
    assert.equal(sessions[0].closeCalls, 1);
  });

test('a pointer queued after unit 33 commits the new composition in its original event order',
  { skip: !available }, async () => {
    const { provider, sessions } = deferredDictionary();
    const keyboard = createBoardKeyboard(layouts, {
      predict: provider, initialPredictionEnabled: true,
    });
    for (const character of 'a'.repeat(32)) keyboard.keyInput(character);
    keyboard.keyInput('b');
    keyboard.setCaret(0, { pointer: true });
    const session = sessions[0];
    session.requests.at(-1).resolve({ candidates: [`${'a'.repeat(32)}ghost`] });
    await flushDictionary();
    assert.equal(session.requests.at(-1).text, 'b');
    assert.equal(keyboard.snapshot().text, `${'a'.repeat(32)}ghostb`);
    session.requests.at(-1).resolve({ candidates: ['be'] });
    await flushDictionary();
    assert.equal(keyboard.snapshot().text, `${'a'.repeat(32)}ghostbe`);
    assert.equal(keyboard.snapshot().caret, 39);
    assert.equal(keyboard.snapshot().composition, null);
    keyboard.setCaret(0, { pointer: true });
    assert.equal(keyboard.snapshot().caret, 0);
  });

test(
  'prediction text layers share immutable archive metadata while isolating mutable pane trees',
  { skip: !available },
  () => {
    const keyboard = createBoardKeyboard(layouts, { initialPredictionEnabled: true });
    keyboard.keyInput('h');
    const presentation = keyboard.presentation();
    const layers = presentation.layers.filter((layer) => layer.prefix === 'keyboard-prediction:');
    assert.equal(layers.length, 2);
    assert.equal(layers[0].layout.animations, layouts.fs_VK_predictInput_a.animations);
    assert.equal(layers[1].layout.animations, layouts.fs_VK_predictInput_a.animations);
    assert.notEqual(layers[0].layout.root, layers[1].layout.root);
    assert.notEqual(layers[0].layout.materials, layers[1].layout.materials);
    assert.ok(
      presentation.layers.findIndex((layer) => layer.prefix === 'keyboard-prediction:') <
        presentation.layers.findIndex((layer) => layer.prefix === 'keyboard-ascii:'),
      'dictionary strip is drawn below the keytops',
    );
  },
);

test('candidate hover redraws only the selected word and preserves all other visible suggestions',
  { skip: !available }, () => {
    const source = layouts.fs_VK_predictInput_a;
    const original = JSON.stringify({ root: source.root, materials: source.materials });
    for (const aspect of ['4:3', '16:9']) {
      const display = createDisplay(aspect);
      const keyboard = createBoardKeyboard(layouts, {
        display,
        initialPredictionEnabled: true,
        predict: () => ['hello', 'help', 'hermit', 'hero'],
        measureText: () => 200,
      });
      keyboard.keyInput('h');
      keyboard.advance(12);
      const renderer = Object.create(Renderer.prototype);
      renderer.display = display;
      renderer.bounds = new Map();
      const sample = () => {
        const calls = [];
        const layers = keyboard.presentation().layers.filter(({ prefix }) =>
          prefix === 'keyboard-prediction:');
        for (const [index, layer] of layers.entries()) {
          renderer.quad = (_layout, pane) => calls.push({ index, name: pane.name, kind: 'picture' });
          renderer.window = (_layout, pane) => calls.push({ index, name: pane.name, kind: 'window' });
          renderer.draw(layer.layout, {
            ...layer,
            onPane(pane, matrix, alpha) {
              if (pane.type === 'txt1' && pane.text && alpha > 0) {
                calls.push({ index, name: pane.name, kind: 'text', text: pane.text,
                  alpha, matrix, scale: pane.scale,
                  material: layer.layout.materials[pane.material].name });
              }
            },
          });
        }
        assert.equal(calls.filter(({ name }) => name === 'W_predictWindow').length, 1,
          `${aspect}: background window is drawn exactly once`);
        assert.ok(calls.filter(({ index }) => index > 0).every(({ kind }) => kind === 'text'),
          `${aspect}: clipped text passes cannot draw a window or texture over other words`);
        const words = calls.filter(({ kind }) => kind === 'text');
        assert.deepEqual(words.map(({ text }) => text).sort(),
          keyboard.snapshot().candidateStrip.entries.map(({ value }) => value).sort());
        for (const word of words) {
          assert.equal(word.material, word.name, 'each word retains its own source material');
          assert.equal(word.alpha, 1, 'transform-only ancestors preserve inherited opacity');
        }
        return { layers, words };
      };
      const resting = sample();
      assert.ok(resting.words.length > 1, 'fixture contains multiple simultaneous suggestions');
      for (const entry of keyboard.snapshot().candidateStrip.entries) {
        keyboard.hover(`key-candidate-${entry.index}`);
        keyboard.advance(10);
        const focused = sample();
        assert.equal(focused.layers.length, 3);
        assert.equal(focused.words.at(-1).text, entry.value, 'selected word is drawn last');
        assert.ok(focused.words.at(-1).scale[0] > 1, 'original focus animation remains bound');
        assert.equal(focused.layers.at(-1).clip.x, -1,
          'focused word keeps a one-pixel left antialiasing margin');
        assert.equal(focused.layers.at(-1).clip.w,
          focused.layers[1].clip.x + focused.layers[1].clip.w + 1);
      }
      keyboard.hover(null);
      keyboard.advance(20);
      assert.deepEqual(sample().words, resting.words, 'departure restores every original word pose');
      keyboard.activate('key-candidates-next');
      keyboard.advance(7);
      assert.equal(sample().layers.length, 2, 'scrolling uses only the regular text pass');
      keyboard.advance(8);
      sample();
    }
    assert.equal(JSON.stringify({ root: source.root, materials: source.materials }), original);
  });

test(
  'Space and Enter use the original decide cue while rejected whitespace uses only the error cue',
  { skip: !available },
  () => {
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, { onSound: (id) => sounds.push(id), maxLength: 5 });
    keyboard.activate('key-space');
    keyboard.keyInput(' ');
    keyboard.activate('key-phone');
    keyboard.activate('key-phone-10');
    keyboard.activate('key-return');
    keyboard.keyInput('Enter');
    assert.equal(keyboard.snapshot().text, '   \n\n');
    assert.deepEqual(sounds, [
      'WIPL_SE_CHAR_DECIDE',
      'WIPL_SE_CHAR_DECIDE',
      'WIPL_SE_SK_SWITCH_TO_KETAI',
      'WIPL_SE_CHAR_DECIDE',
      'WIPL_SE_CHAR_DECIDE',
      'WIPL_SE_CHAR_DECIDE',
    ]);
    keyboard.keyInput(' ');
    assert.equal(sounds.at(-1), 'WIPL_SE_CHAR_DELETE_ERROR');
    assert.equal(keyboard.snapshot().text, '   \n\n');
  },
);


test('each keyboard owns a dictionary session and sends literal selection and lifecycle commands',
  { skip: !available }, () => {
    const sessions = [];
    const provider = () => { throw new Error('Shared provider must not own editor state'); };
    provider.createSession = () => {
      const calls = [];
      const predict = (text, options) => {
        calls.push(['query', text, options]);
        return { engine: 'original-zi8', candidates: ['>', 'm', 'n', 'o', '6'] };
      };
      predict.accept = (index) => calls.push(['accept', index]);
      predict.reset = () => calls.push(['reset']);
      predict.close = () => calls.push(['close']);
      sessions.push(calls);
      return predict;
    };
    const first = createBoardKeyboard(layouts, { predict: provider, initialPredictionEnabled: true });
    first.activate('key-phone');
    first.activate('key-phone-5');
    first.snapshot();
    first.activate('key-candidate-0');
    assert.equal(first.snapshot().text, '>');
    assert.equal(first.snapshot().caret, 1);
    assert.deepEqual(sessions[0].at(-1), ['accept', 0]);
    first.activate('key-phone-5');
    first.snapshot();
    first.activate('key-delete');
    assert.deepEqual(sessions[0].at(-1), ['reset']);
    first.activate('key-back');
    assert.deepEqual(sessions[0].at(-1), ['close']);
    const reopened = createBoardKeyboard(layouts, {
      predict: provider, initialPredictionEnabled: true,
    });
    reopened.keyInput('h');
    reopened.snapshot();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[1][0][1], 'h');
    assert.deepEqual(sessions[0].at(-1), ['close']);
  });


test('both Enter paths expose newline markers only after an actual line feed',
  { skip: !available }, () => {
    for (const enabled of [false, true]) {
      for (const enter of [(keyboard) => keyboard.keyInput('Enter'),
        (keyboard) => keyboard.activate('key-return')]) {
        const keyboard = createBoardKeyboard(layouts, {
          value: 'committed', showTextBox: true, initialPredictionEnabled: enabled,
        });
        enter(keyboard);
        const state = keyboard.snapshot();
        assert.equal(state.text, 'committed\n');
        assert.equal(state.caret, 10);
        const input = indexLayout(keyboard.presentation().layers.find(
          (layer) => layer.prefix === 'keyboard-text:',
        ).layout).panes.get('T_2l_TextBox');
        assert.equal(input.text, 'committed\n');
        assert.equal(input.showLineFeeds, true);
      }
    }
    const keyboard = createBoardKeyboard(layouts, {
      showTextBox: true, initialPredictionEnabled: true, predict: () => ['farmacia'],
    });
    for (const character of 'far') keyboard.keyInput(character);
    keyboard.activate('key-return');
    assert.equal(keyboard.snapshot().text, 'far\n');
    assert.equal(keyboard.snapshot().caret, 4);
    assert.equal(keyboard.snapshot().composition, null);
    assert.equal(keyboard.snapshot().candidateStrip.entries.length, 0);
    keyboard.keyInput('Enter');
    assert.equal(keyboard.snapshot().text, 'far\n\n');
  });


test('More arrow bodies render on first appearance and return to their complete idle poses',
  { skip: !available }, () => {
    const keyboard = createBoardKeyboard(layouts);
    keyboard.activate('key-more');
    const rendered = () => {
      const source = keyboard.presentation().layers.find(
        (layer) => layer.prefix === 'keyboard-symbols:',
      ).layout;
      const drawn = new Map();
      const renderer = Object.create(Renderer.prototype);
      renderer.display = createDisplay();
      renderer.bounds = new Map();
      renderer.window = () => {};
      renderer.quad = (layout, pane, matrix, alpha) => {
        if (!/^P_SGNkey_(prev|next|close)$/.test(pane.name)) return;
        drawn.set(pane.name, {
          opacity: alpha * layout.materials[pane.material].colors[1][3],
          scale: [matrix[0], matrix[5]],
          size: pane.size,
        });
      };
      renderer.draw(source);
      return drawn;
    };
    keyboard.advance(1);
    const initial = rendered();
    for (const name of ['P_SGNkey_prev', 'P_SGNkey_next']) {
      assert.equal(initial.get(name).opacity, initial.get('P_SGNkey_close').opacity);
      assert.ok(initial.get(name).opacity > 0);
    }
    keyboard.advance(17);
    const idle = rendered();
    keyboard.hover('key-symbols-next');
    keyboard.advance(5);
    // The source close-button prototype retains scale one during focus.
    assert.deepEqual(rendered().get('P_SGNkey_next'), idle.get('P_SGNkey_next'));
    assert.deepEqual(rendered().get('P_SGNkey_prev'), idle.get('P_SGNkey_prev'));
    keyboard.hover(null);
    keyboard.advance(8);
    for (const name of ['P_SGNkey_prev', 'P_SGNkey_next'])
      assert.deepEqual(rendered().get(name), idle.get(name));
    keyboard.activate('key-symbols-next');
    keyboard.advance(20);
    for (const name of ['P_SGNkey_prev', 'P_SGNkey_next'])
      assert.deepEqual(rendered().get(name), idle.get(name));
  });


test('English dictionary labels render the complete original g glyph in both key layouts',
  { skip: !available || !manifest.fonts?.['WiiBitmapFontType1.brfnt'] }, () => {
    const sourceFont = JSON.parse(readFileSync(new URL(
      manifest.fonts['WiiBitmapFontType1.brfnt'].url, url,
    )));
    const draws = [];
    const face = new BitmapFont(sourceFont, {
      quad: (layout, pane, matrix) => draws.push({ layout, pane, matrix }),
    });
    const keyboard = createBoardKeyboard(layouts);
    for (const [prefix, name] of [
      ['keyboard-ascii:', 'T_USEU_prdc_lang'],
      ['keyboard-phone:', 'N_prdc_EU_lang'],
    ]) {
      if (prefix === 'keyboard-phone:') {
        keyboard.activate('key-phone');
        keyboard.advance(20);
      }
      const layer = keyboard.presentation().layers.find((item) => item.prefix === prefix);
      const pane = indexLayout(layer.layout).panes.get(name);
      assert.equal(layer.layout.fonts[pane.font], 'WiiBitmapFontType1.brfnt');
      assert.equal(pane.text, 'Eng');
      const lines = face.layoutPaneText(pane.text, pane).lines;
      assert.deepEqual(lines.map((line) => line.text), ['Eng']);
      draws.length = 0;
      face.drawPane(pane.text, pane, [1, 0, 0, 1, 0, 0]);
      assert.equal(draws.length, 3);
      const glyph = face.glyph('g');
      const sheet = sourceFont.sheets[glyph.sheet];
      const last = draws.at(-1);
      const [sx, sy] = face.scale(pane.fontSize);
      assert.deepEqual(last.pane.size, [glyph.width * sx, glyph.height * sy]);
      assert.equal(last.pane.texCoords[0][2][1], (glyph.y + glyph.height) / sheet.height);
      assert.ok(last.matrix[4] + last.pane.size[0] <= pane.size[0] / 2);
      assert.ok(last.matrix[5] - last.pane.size[1] >= -pane.size[1] / 2);
    }
  });


test('layout, telephone case and symbol page survive keyboard cancellation and reopening',
  { skip: !available }, () => {
    let preferences = normalizeKeyboardPreferences({
      schemaVersion: 1, predictionEnabled: false, dictionaryLanguage: 'es',
    });
    const create = () => createBoardKeyboard(layouts, {
      initialPreferences: preferences,
      onPreferencesChange: (value) => { preferences = value; },
    });
    const first = create();
    first.activate('key-phone');
    first.activate('key-phone-mode-2');
    first.activate('key-more');
    first.advance(18);
    for (let page = 1; page <= 2; page++) {
      first.activate('key-symbols-next');
      first.advance(20);
      assert.equal(preferences.symbolPage, page);
    }
    first.activate('key-symbols-close');
    first.advance(13);
    first.back();
    assert.deepEqual(preferences, {
      schemaVersion: 2, predictionEnabled: false, dictionaryLanguage: 'es',
      layoutMode: 'phone', phoneMode: 2, symbolPage: 2,
    });
    const second = create();
    assert.equal(second.snapshot().layoutMode, 'phone');
    assert.equal(second.snapshot().phoneMode, 2);
    const phone = second.presentation().layers.find((layer) => layer.prefix === 'keyboard-phone:');
    assert.equal(indexLayout(phone.layout).panes.get('T_CPkey_01').text, 'ABC');
    second.activate('key-phone-1');
    assert.equal(second.snapshot().text, 'A');
    second.activate('key-more');
    second.advance(18);
    assert.equal(second.snapshot().symbolPage, 2);
    const symbols = second.presentation().layers.find((layer) => layer.prefix === 'keyboard-symbols:');
    assert.equal(indexLayout(symbols.layout).panes.get('T_SGN_pageNumber').text, '3/10');
    second.activate('key-symbols-close');
    second.advance(13);
    second.activate('key-more');
    assert.equal(second.snapshot().symbolPage, 2);
  });

test('forced profiles and physical modifiers preserve unrelated general keyboard preferences',
  { skip: !available }, () => {
    const preferences = normalizeKeyboardPreferences({
      schemaVersion: 2, predictionEnabled: true, dictionaryLanguage: 'fr',
      layoutMode: 'phone', phoneMode: 1, symbolPage: 2,
    });
    const changes = [];
    for (const nativeType of [3, 10, 7, 12]) {
      const keyboard = createBoardKeyboard(layouts, {
        nativeType, initialPreferences: preferences,
        onPreferencesChange: (value) => changes.push(value),
      });
      assert.equal(keyboard.snapshot().layoutMode, nativeType === 7 ? 'qwerty' : 'phone');
      assert.equal(keyboard.snapshot().predictionEnabled, false);
      assert.equal(keyboard.activate('key-phone-mode-2'), false);
      keyboard.keyInput('Shift', { down: true });
      keyboard.keyInput('CapsLock', { down: true, capsLock: true });
      keyboard.keyInput('9');
      keyboard.back();
      assert.deepEqual(keyboard.snapshot().preferences, preferences);
    }
    assert.deepEqual(changes, []);
    const nickname = createBoardKeyboard(layouts, {
      nativeType: 6, initialPreferences: preferences,
      onPreferencesChange: (value) => changes.push(value),
    });
    nickname.activate('key-qwerty');
    assert.deepEqual(changes.at(-1), { ...preferences, layoutMode: 'qwerty' });
    assert.equal(nickname.snapshot().predictionEnabled, false);
  });

test('Wii Number alone draws its original three separator bars without changing text or caret units',
  { skip: !available || !manifest.fonts?.['WiiBitmapFontType1.brfnt'] }, () => {
    const original = JSON.stringify(layouts);
    const face = new BitmapFont(JSON.parse(readFileSync(new URL(
      manifest.fonts['WiiBitmapFontType1.brfnt'].url, url,
    ))), {});
    const source = layouts.fs_VK_textBox_b;
    const sourcePanes = indexLayout(source).panes;
    for (const aspect of ['4:3', '16:9']) {
      for (const nativeType of [3, 6, 10, 11, 12]) {
        const display = createDisplay(aspect);
        const keyboard = createBoardKeyboard(layouts, {
          nativeType, display, value: '1234567890123456', maxLength: 16, rowLimit: 2,
          measureTextLayout: (text, pane) => face.layoutPaneText(text, pane),
        });
        const renderedBars = () => {
          const renderer = Object.create(Renderer.prototype);
          renderer.display = display;
          renderer.bounds = new Map();
          renderer.window = () => {};
          const bars = [];
          renderer.quad = (layout, pane, matrix, alpha) => {
            if (!pane.name?.startsWith('P_sprtBar')) return;
            bars.push({ name: pane.name, pane, material: layout.materials[pane.material], matrix, alpha });
          };
          for (const layer of keyboard.presentation().layers) renderer.draw(layer.layout, layer);
          return bars;
        };
        const bars = renderedBars();
        assert.deepEqual(bars.map((bar) => bar.name), nativeType === 12
          ? ['P_sprtBar_00', 'P_sprtBar_01', 'P_sprtBar_02'] : [], `${aspect}, type ${nativeType}`);
        if (nativeType === 12) {
          for (const bar of bars) {
            assert.deepEqual(bar.pane, sourcePanes.get(bar.name));
            assert.deepEqual(bar.material, source.materials[bar.pane.material]);
            assert.equal(bar.alpha, 1);
          }
          assert.equal(keyboard.snapshot().displayText, '1234567890123456');
          assert.equal(keyboard.snapshot().displayCaret, 16);
          keyboard.setCaret(4);
          keyboard.keyInput('Backspace');
          assert.equal(keyboard.snapshot().text, '123567890123456');
          assert.equal(keyboard.snapshot().caret, 3);
          assert.deepEqual(renderedBars(), bars, 'separator artwork does not join the editable string');
        }
        keyboard.dispose();
      }
    }
    assert.equal(JSON.stringify(layouts), original);
  });

test('the native 32-unit boundary commits its full selected candidate before new Latin input',
  { skip: !available }, () => {
    for (const phone of [false, true]) {
      const requests = [];
      const sounds = [];
      let resets = 0;
      const predict = (prefix, options) => {
        requests.push({ prefix, ...options });
        return [prefix, `${prefix}ghost`];
      };
      predict.reset = () => { resets++; };
      const keyboard = createBoardKeyboard(layouts, {
        value: 'left  tail', initialPredictionEnabled: true, predict,
        initialPreferences: { layoutMode: phone ? 'phone' : 'qwerty' },
        onSound: (name) => sounds.push(name),
      });
      keyboard.setCaret(5);
      for (let index = 0; index < 31; index++) {
        if (phone) keyboard.activate('key-phone-1');
        else keyboard.keyInput('a');
      }
      assert.deepEqual(keyboard.snapshot().composition, { start: 5, end: 36 });
      if (phone) keyboard.activate('key-phone-1');
      else keyboard.keyInput('a');
      assert.deepEqual(keyboard.snapshot().composition, { start: 5, end: 37 });
      assert.equal(resets, 0);
      keyboard.hover('key-candidate-1');
      keyboard.hover(phone ? 'key-phone-1' : 'key-10');
      sounds.length = 0;
      if (phone) keyboard.activate('key-phone-1');
      else keyboard.keyInput('b');
      const state = keyboard.snapshot();
      const finalUnit = phone ? 'a' : 'b';
      assert.equal(state.text, `left ${'a'.repeat(32)}ghost${finalUnit} tail`);
      assert.deepEqual(state.composition, { start: 42, end: 43 });
      assert.equal(state.caret, 43);
      assert.equal(resets, 1);
      assert.equal(phone ? requests.at(-1).digits : requests.at(-1).prefix, phone ? '2' : 'b');
      assert.deepEqual(sounds, ['WIPL_SE_CHAR_DECIDE']);
      keyboard.keyInput('Backspace');
      assert.equal(keyboard.snapshot().text, `left ${'a'.repeat(32)}ghost tail`);
      assert.equal(keyboard.snapshot().composition, null, 'the committed prefix cannot resume');
    }
  });

test('async boundary waits only at unit 33 and replays ordered typing around a retained suffix',
  { skip: !available }, async () => {
    const requests = [];
    const predict = (prefix, options) => new Promise((resolve) =>
      requests.push({ prefix, options, resolve }));
    const resets = [];
    predict.reset = () => resets.push('reset');
    const keyboard = createBoardKeyboard(layouts, {
      value: 'x tail', predict, initialPredictionEnabled: true,
    });
    keyboard.setCaret(1);
    for (const character of 'a'.repeat(32)) keyboard.keyInput(character);
    assert.equal(keyboard.snapshot().text, `x${'a'.repeat(32)} tail`);
    keyboard.keyInput('b');
    keyboard.keyInput('c');
    keyboard.keyInput('d');
    assert.equal(keyboard.snapshot().caret, 33, 'only the boundary waits for prediction');
    assert.equal(requests.length, 32, 'shorter input stays immediate while requests are pending');
    requests[0].resolve({ engine: 'original-zi8', candidates: ['obsolete'] });
    await flushDictionary();
    assert.equal(keyboard.snapshot().caret, 33, 'an earlier request cannot release the boundary');
    requests.at(-1).resolve({ engine: 'original-zi8', candidates: [`${'a'.repeat(32)}ghost`] });
    await flushDictionary();
    const state = keyboard.snapshot();
    assert.equal(state.text, `x${'a'.repeat(32)}ghostbcd tail`);
    assert.equal(state.caret, 41);
    assert.deepEqual(state.composition, { start: 38, end: 41 });
    assert.equal(requests.at(-1).prefix, 'bcd');
    assert.deepEqual(resets, ['reset']);
  });

test('pending boundary preserves accepted typing before editing, mode changes and normal closure',
  { skip: !available }, async () => {
    const commands = {
      backspace: (keyboard) => keyboard.keyInput('Backspace'),
      deleteKeytop: (keyboard) => keyboard.activate('key-delete'),
      caret: (keyboard) => keyboard.setCaret(2),
      arrow: (keyboard) => keyboard.keyInput('ArrowLeft'),
      toggle: (keyboard) => keyboard.activate('key-prediction'),
      layout: (keyboard) => keyboard.activate('key-phone'),
      symbols: (keyboard) => keyboard.activate('key-more'),
      blur: (keyboard) => keyboard.keyInput('', { type: 'blur' }),
      back: (keyboard) => keyboard.back(),
      backKeytop: (keyboard) => keyboard.activate('key-back'),
      okKeytop: (keyboard) => keyboard.activate('key-ok'),
      escape: (keyboard) => keyboard.keyInput('Escape'),
    };
    for (const phone of [false, true]) {
      for (const [name, command] of Object.entries(commands)) {
        let settle;
        const closes = [];
        const keyboard = createBoardKeyboard(layouts, {
          initialPredictionEnabled: true,
          initialPreferences: { layoutMode: phone ? 'phone' : 'qwerty', phoneMode: 1 },
          predict: () => new Promise((resolve) => { settle = resolve; }),
          onClose: (value) => closes.push(value),
        });
        for (let index = 0; index < 33; index++) {
          if (phone) keyboard.activate('key-phone-1');
          else keyboard.keyInput('a');
        }
        const boundaryResolve = settle;
        assert.equal(command(keyboard), true, name);
        assert.equal(keyboard.snapshot().text, 'a'.repeat(32), `${name}: still awaiting result`);
        if (['back', 'backKeytop', 'okKeytop', 'escape'].includes(name)) {
          assert.equal(keyboard.keyInput('z'), false, 'a dismissed editor accepts no later input');
          assert.equal(keyboard.activate('key-delete'), false);
        }
        boundaryResolve({ engine: 'original-zi8', candidates: [`${'a'.repeat(32)}ghost`] });
        await flushDictionary();
        const deleted = name === 'backspace' || name === 'deleteKeytop';
        const expected = `${'a'.repeat(32)}ghost${deleted ? '' : 'a'}`;
        const state = keyboard.snapshot();
        assert.equal(state.text, expected, `${phone ? 'phone' : 'ASCII'} ${name}`);
        if (name === 'caret') assert.equal(state.caret, 2);
        if (name === 'arrow') assert.equal(state.caret, expected.length - 1);
        if (['back', 'backKeytop', 'okKeytop', 'escape'].includes(name)) {
          assert.deepEqual(closes, [expected]);
          assert.equal(state.caretVisible, false);
        }
        keyboard.dispose();
      }
    }
  });

test('Backspace after accepted unit 33 removes that unit, while disposal cancels the owner',
  { skip: !available }, async () => {
    for (const dispose of [false, true]) {
      let resolve;
      const changes = [];
      const keyboard = createBoardKeyboard(layouts, {
        initialPredictionEnabled: true,
        predict: () => new Promise((settle) => { resolve = settle; }),
        onChange: (text) => changes.push(text),
      });
      for (const character of 'a'.repeat(33)) keyboard.keyInput(character);
      if (dispose) keyboard.dispose();
      else keyboard.keyInput('Backspace');
      resolve({ engine: 'original-zi8', candidates: ['a'.repeat(32)] });
      await flushDictionary();
      assert.equal(keyboard.snapshot().text, 'a'.repeat(32));
      assert.equal(changes.length, dispose ? 32 : 35,
        'normal editing commits, inserts and deletes; disposal never replays pending input');
      keyboard.dispose();
    }
  });

test('queued commands retain order through another async segment and a later close',
  { skip: !available }, async () => {
    const requests = [];
    const closes = [];
    const keyboard = createBoardKeyboard(layouts, {
      initialPredictionEnabled: true,
      predict: (prefix) => new Promise((resolve) => requests.push({ prefix, resolve })),
      onClose: (value) => closes.push(value),
    });
    for (const character of 'a'.repeat(66)) keyboard.keyInput(character);
    keyboard.keyInput('Backspace');
    keyboard.setCaret(1);
    keyboard.keyInput('z');
    keyboard.back();
    assert.deepEqual(closes, []);
    requests.at(-1).resolve({ engine: 'original-zi8', candidates: ['a'.repeat(32)] });
    await flushDictionary();
    assert.equal(keyboard.snapshot().text, 'a'.repeat(64));
    assert.deepEqual(closes, [], 'normal close waits behind the second accepted boundary');
    requests.at(-1).resolve({ engine: 'original-zi8', candidates: ['a'.repeat(32)] });
    await flushDictionary();
    assert.deepEqual(closes, [`az${'a'.repeat(64)}`]);
    assert.equal(keyboard.snapshot().caret, 2);
  });

test('boundary failures preserve literal input and field rejection preserves the active composition',
  { skip: !available }, async () => {
    let reject;
    const keyboard = createBoardKeyboard(layouts, {
      initialPredictionEnabled: true,
      predict: () => new Promise((resolve, fail) => { reject = fail; }),
    });
    for (const character of 'a'.repeat(33)) keyboard.keyInput(character);
    reject(new Error('Synthetic unavailable dictionary'));
    await flushDictionary();
    assert.equal(keyboard.snapshot().text, 'a'.repeat(33));
    assert.deepEqual(keyboard.snapshot().composition, { start: 32, end: 33 });
    keyboard.dispose();
    for (const phone of [false, true]) {
      let resets = 0;
      const predict = (prefix) => [prefix];
      predict.reset = () => { resets++; };
      const limited = createBoardKeyboard(layouts, {
        maxLength: 32, initialPredictionEnabled: true, predict,
        initialPreferences: { layoutMode: phone ? 'phone' : 'qwerty', phoneMode: 1 },
      });
      for (let index = 0; index < 33; index++) {
        if (phone) limited.activate('key-phone-1');
        else limited.keyInput('a');
      }
      assert.equal(limited.snapshot().text, 'a'.repeat(32));
      assert.deepEqual(limited.snapshot().composition, { start: 0, end: 32 });
      assert.equal(resets, 0, 'a rejected next character does not commit or reset');
    }
  });

test('telephone boundary owns the pending prediction and applies new digits after full completion',
  { skip: !available }, async () => {
    const requests = [];
    const keyboard = createBoardKeyboard(layouts, {
      value: 'x tail', initialPredictionEnabled: true,
      initialPreferences: { layoutMode: 'phone', phoneMode: 1 },
      predict: (prefix, options) => new Promise((resolve) =>
        requests.push({ prefix, options, resolve })),
    });
    keyboard.setCaret(1);
    for (let index = 0; index < 34; index++) keyboard.activate('key-phone-1');
    assert.equal(keyboard.snapshot().text, `x${'a'.repeat(32)} tail`);
    assert.equal(requests.at(-1).options.digits, '2'.repeat(32));
    requests.at(-1).resolve({ engine: 'original-zi8', candidates: [`${'a'.repeat(32)}ghost`] });
    await flushDictionary();
    assert.equal(keyboard.snapshot().text, `x${'a'.repeat(32)}ghostaa tail`);
    assert.equal(requests.at(-1).options.digits, '22');
    assert.deepEqual(keyboard.snapshot().composition, { start: 38, end: 40 });
    keyboard.dispose();
  });

test('long sequential input remains within native query segments and never treats text as a paste',
  { skip: !available }, () => {
    const lengths = [];
    let resets = 0;
    const predict = (prefix) => { lengths.push(prefix.length); return [prefix]; };
    predict.reset = () => { resets++; };
    const keyboard = createBoardKeyboard(layouts, { initialPredictionEnabled: true, predict });
    assert.equal(keyboard.keyInput('a'.repeat(70)), false, 'this API represents a key, not native paste');
    for (const character of 'a'.repeat(70)) keyboard.keyInput(character);
    assert.equal(keyboard.snapshot().text, 'a'.repeat(70));
    assert.deepEqual(keyboard.snapshot().composition, { start: 64, end: 70 });
    assert.equal(Math.max(...lengths), 32);
    assert.equal(resets, 2);

    const limited = createBoardKeyboard(layouts, {
      maxLength: 35, initialPredictionEnabled: true,
      predict: (prefix) => [`${prefix}ghost`],
    });
    for (const character of 'a'.repeat(33)) limited.keyInput(character);
    assert.equal(limited.snapshot().text, 'a'.repeat(32));
    assert.deepEqual(limited.snapshot().composition, { start: 0, end: 32 },
      'an oversized selected completion cannot corrupt the field or consume the new character');
  });

test('a stale candidate cannot replace accepted typing between result and boundary settlement',
  { skip: !available }, async () => {
    let resolve;
    const keyboard = createBoardKeyboard(layouts, {
      initialPredictionEnabled: true,
      predict: () => new Promise((settle) => { resolve = settle; }),
    });
    for (const character of 'a'.repeat(32)) keyboard.keyInput(character);
    keyboard.keyInput('b');
    assert.equal(keyboard.activate('key-candidate-0'), false, 'pending choices cannot activate');
    resolve({ engine: 'original-zi8', candidates: ['a'.repeat(32), `${'a'.repeat(32)}choice`] });
    await Promise.resolve();
    assert.equal(keyboard.controls().find((item) => item.id === 'key-candidate-1').disabled, true);
    assert.equal(keyboard.hover('key-candidate-1'), false);
    assert.equal(keyboard.activate('key-candidate-1'), false, 'the old request has already been used');
    await flushDictionary();
    assert.equal(keyboard.snapshot().text, `${'a'.repeat(32)}b`);
    assert.deepEqual(keyboard.snapshot().composition, { start: 32, end: 33 });
    keyboard.dispose();
  });

test('boundary replay stops if its commit callback disposes the editor',
  { skip: !available }, async () => {
    let resolve;
    let closeOnCommit = false;
    const values = [];
    const keyboard = createBoardKeyboard(layouts, {
      initialPredictionEnabled: true,
      predict: () => new Promise((settle) => { resolve = settle; }),
      onChange: (value) => {
        values.push(value);
        if (closeOnCommit) keyboard.dispose();
      },
    });
    for (const character of 'a'.repeat(32)) keyboard.keyInput(character);
    keyboard.keyInput('b');
    keyboard.keyInput('c');
    closeOnCommit = true;
    resolve({ engine: 'original-zi8', candidates: [`${'a'.repeat(32)}ghost`] });
    await flushDictionary();
    assert.equal(keyboard.snapshot().text, `${'a'.repeat(32)}ghost`);
    assert.equal(values.length, 33, 'commit was the final edit; no queued input ran after disposal');
    assert.equal(keyboard.snapshot().caretVisible, false);
  });


test('an oversized boundary completion rejects its insertion but preserves subsequent commands',
  { skip: !available }, async () => {
    let resolve;
    const closes = [];
    const sounds = [];
    const keyboard = createBoardKeyboard(layouts, {
      maxLength: 35, initialPredictionEnabled: true,
      predict: () => new Promise((settle) => { resolve = settle; }),
      onClose: (text) => closes.push(text),
      onSound: (sound) => sounds.push(sound),
    });
    for (const character of 'a'.repeat(33)) keyboard.keyInput(character);
    keyboard.keyInput('Backspace');
    keyboard.back();
    resolve({ engine: 'original-zi8', candidates: [`${'a'.repeat(32)}ghost`] });
    await flushDictionary();
    assert.deepEqual(closes, ['a'.repeat(31)]);
    assert.equal(sounds.filter((sound) => sound === 'WIPL_SE_CHAR_DELETE_ERROR').length, 1);
    assert.equal(keyboard.snapshot().caretVisible, false);
  });
