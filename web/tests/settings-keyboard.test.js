import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { indexLayout } from '../src/animation.js';
import { KEYBOARD_LAYOUTS } from '../src/board-keyboard.js';
import { createSettingsKeyboard, settingsKeyboardPose } from '../src/settings-keyboard.js';
import { normalizeKeyboardPreferences } from '../src/keyboard-preferences.js';
import { deferredDictionary, flushDictionary } from './helpers/deferred-dictionary.js';
import { isPersistentArrowControl } from '../src/arrow-interaction.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && KEYBOARD_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      KEYBOARD_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
      ]),
    )
  : {};
const request = { requestId: 3, formId: 1, profile: 'console-nickname', text: 'Wii' };

test('Settings prediction forwards candidate holds and closes them with its input lifetime',
  { skip: !available }, () => {
    const sounds = [];
    const controller = createSettingsKeyboard(layouts, {
      getKeyboardPreferences: () => ({ predictionEnabled: true }),
      predict: () => Array.from({ length: 40 }, (_, index) => `hello${index}`),
      measureText: () => 220,
      onSound: (name) => sounds.push(name),
    });
    controller.open({ ...request, text: '', nativeType: 13, predictionAllowed: true });
    assert.equal(controller.holdControl('key-candidates-next'), false, 'entrance is locked');
    controller.advance(30);
    controller.keyInput('h');
    controller.hover('key-candidates-next');
    assert.equal(controller.holdControl('key-candidates-next'), true);
    assert.equal(isPersistentArrowControl('settings-keyboard-key-candidates-next'), true);
    controller.advance(16);
    assert.equal(sounds.filter((name) => name === 'WIPL_SE_LINE_SCROLL').length, 2);
    controller.keyInput('', { type: 'blur' });
    controller.advance(100);
    assert.equal(sounds.filter((name) => name === 'WIPL_SE_LINE_SCROLL').length, 2);
    assert.equal(controller.holdControl('key-candidates-next'), true);
    controller.reset();
    controller.advance(100);
    assert.equal(sounds.filter((name) => name === 'WIPL_SE_LINE_SCROLL').length, 3);
  });

test('forced Settings reset releases its pending dictionary without affecting the next form',
  { skip: !available }, async () => {
    const { provider, sessions } = deferredDictionary();
    const callbacks = [];
    const sounds = [];
    const controller = createSettingsKeyboard(layouts, {
      predict: provider,
      getKeyboardPreferences: () => ({ predictionEnabled: true, layoutMode: 'phone' }),
      onResult: (value) => callbacks.push(value), onComplete: (value) => callbacks.push(value),
      onSound: (sound) => sounds.push(sound),
    });
    const predicting = { ...request, text: '', predictionAllowed: true };
    controller.open(predicting);
    controller.advance(30);
    controller.activate('key-phone-5');
    assert.equal(controller.getSnapshot().keyboard.dictionary.state, 'loading');
    const quiet = sounds.length;
    controller.reset();
    controller.reset();
    assert.equal(sounds.length, quiet);
    assert.equal(sessions[0].closeCalls, 1);
    controller.open({ ...predicting, requestId: 4 });
    controller.advance(30);
    controller.activate('key-phone-5');
    controller.getSnapshot();
    sessions[1].requests.at(-1).resolve({ engine: 'synthetic-predictor', candidates: ['mom'] });
    await flushDictionary();
    assert.equal(controller.getSnapshot().keyboard.text, 'M');
    sessions[0].requests.at(-1).resolve({ engine: 'synthetic-predictor', candidates: ['stale'] });
    await flushDictionary();
    assert.equal(controller.getSnapshot().keyboard.text, 'M');
    assert.deepEqual(callbacks, []);
    controller.reset();
    assert.equal(sessions[1].closeCalls, 1);
  });

test(
  'Settings keyboard renders the original localized Quit caption and preserves cancellation',
  { skip: !available },
  () => {
    const results = [];
    const keyboard = createSettingsKeyboard(layouts, {
      messages: { 37: 'Localized Quit' },
      onResult: (result) => results.push(result),
    });
    keyboard.open(request);
    keyboard.advance(30);
    const toolbar = keyboard
      .presentation()
      .layers.find((layer) => layer.prefix === 'keyboard-toolbar:').layout;
    assert.equal(indexLayout(toolbar).panes.get('T_BT_cancel').text, 'Localized Quit');
    assert.equal(
      keyboard.presentation().controls.find((control) => control.id === 'key-back').label,
      'Localized Quit',
    );
    keyboard.activate('key-back');
    assert.deepEqual(results, [{ requestId: 3, text: 'Wii', accepted: false }]);
  },
);

test('Settings keyboard entrance and exit use symmetric thirty-update Hermite motion', () => {
  assert.deepEqual(settingsKeyboardPose('enter', 0), { y: -200, alpha: 0 });
  assert.deepEqual(settingsKeyboardPose('enter', 15), { y: -100, alpha: 127 });
  assert.deepEqual(settingsKeyboardPose('enter', 30), { y: -0, alpha: 255 });
  for (let frame = 0; frame <= 30; frame++) {
    const incoming = settingsKeyboardPose('enter', frame);
    const outgoing = settingsKeyboardPose('exit', 30 - frame);
    assert.ok(Math.abs(incoming.y - outgoing.y) < 1e-10);
    assert.ok(Math.abs(incoming.alpha - outgoing.alpha) <= 1);
  }
});

test(
  'nickname lifecycle retains the Settings raster until original keyboard dismissal finishes',
  {
    skip: !available,
  },
  () => {
    const completions = [];
    const results = [];
    const sounds = [];
    const pristine = JSON.stringify(layouts);
    const controller = createSettingsKeyboard(layouts, {
      measureTextLayout: (text) => ({
        lineHeight: 42,
        lines: [{ text, start: 0, end: text.length, x: 0, y: 0 }],
      }),
      onComplete: (value) => completions.push(value),
      onResult: (value) => results.push(value),
      onSound: (value) => sounds.push(value),
    });
    assert.equal(controller.open(request), true);
    assert.equal(controller.open(request), false);
    assert.equal(controller.keyInput('A'), false);
    assert.equal(controller.presentation().controls.length, 0);
    controller.advance(15);
    const layers = controller.presentation().layers;
    const enteringText = layers.find((layer) => layer.clipFollowsRoot);
    assert.ok(enteringText);
    const background = layers.find((layer) => layer.prefix === 'keyboard-background:');
    assert.equal(background.layout.root.translation[1], layouts.fs_VK_bg_a.root.translation[1]);
    assert.equal(background.alpha, 127 / 255);
    const panes = indexLayout(
      layers.find((layer) => layer.prefix === 'keyboard-toolbar:').layout,
    ).panes;
    const original = indexLayout(layouts.fs_VK_toolbar_a).panes;
    assert.equal(panes.get('N_UP').alpha, 0);
    assert.equal(panes.get('N_DOWN').alpha, 127);
    assert.equal(
      panes.get('N_DOWN').translation[1],
      original.get('N_DOWN').translation[1] - 100 / 3,
    );
    assert.equal(panes.get('N_UP').translation[1], original.get('N_UP').translation[1] + 100 / 3);
    controller.advance(15);
    assert.equal(controller.getSnapshot().phase, 'edit');
    const settledText = controller.presentation().layers.find((layer) => layer.clipFollowsRoot);
    assert.equal(enteringText.clip.y, settledText.clip.y + 100);
    assert.equal(
      enteringText.layout.root.translation[1],
      settledText.layout.root.translation[1] - 100,
    );
    assert.equal(controller.keyInput('A'), true);
    assert.equal(controller.activate('key-language'), false);
    assert.equal(controller.activate('key-ok'), true);
    assert.equal(controller.active, true);
    assert.equal(completions.length, 0);
    assert.deepEqual(results, [{ requestId: 3, text: 'WiiA', accepted: true }]);
    controller.advance(29);
    assert.equal(controller.active, true);
    controller.advance(1);
    assert.equal(controller.active, false);
    assert.deepEqual(completions, [{ requestId: 3, text: 'WiiA', accepted: true }]);
    assert.equal(sounds.filter((sound) => sound === 'WIPL_SE_SK_OPEN').length, 1);
    assert.equal(sounds.filter((sound) => sound === 'WIPL_SE_SK_DECIDE_CLOSE').length, 1);
    controller.advance(10);
    assert.equal(completions.length, 1);
    assert.equal(JSON.stringify(layouts), pristine);
  },
);

test(
  'Settings forwards both Caps event edges and releases held Shift on focus loss',
  { skip: !available },
  () => {
    const keyboard = createSettingsKeyboard(layouts);
    keyboard.open(request);
    keyboard.advance(30);
    keyboard.keyInput('CapsLock', { capsLock: true });
    assert.equal(keyboard.getSnapshot().keyboard.caps, true);
    keyboard.keyInput('CapsLock', { type: 'keyup', capsLock: false });
    assert.equal(keyboard.getSnapshot().keyboard.caps, false);
    keyboard.keyInput('Shift', { shiftKey: true });
    assert.equal(keyboard.getSnapshot().keyboard.shift, true);
    keyboard.keyInput('', { type: 'blur' });
    assert.equal(keyboard.getSnapshot().keyboard.shift, false);
  },
);

test(
  'nickname cancellation remains distinct from accepting edited text',
  { skip: !available },
  () => {
    const completions = [];
    const controller = createSettingsKeyboard(layouts, {
      onComplete: (value) => completions.push(value),
    });
    controller.open(request);
    controller.advance(30);
    controller.keyInput('!');
    controller.back();
    controller.advance(30);
    assert.deepEqual(completions, [{ requestId: 3, text: 'Wii!', accepted: false }]);
  },
);

test(
  'global HOME exit discards the keyboard and pending callbacks before a later Settings entry',
  {
    skip: !available,
  },
  () => {
    const completed = [];
    const results = [];
    const controller = createSettingsKeyboard(layouts, {
      onComplete: (result) => completed.push(result),
      onResult: (result) => results.push(result),
    });
    controller.open(request);
    assert.equal(controller.reset(), true);
    controller.advance(100);
    assert.equal(controller.active, false);
    assert.equal(results.length, 0);
    assert.equal(completed.length, 0);
    assert.equal(controller.open({ ...request, requestId: 4 }), true);
    controller.advance(30);
    controller.activate('key-ok');
    assert.equal(results.length, 1);
    controller.reset();
    controller.advance(100);
    assert.equal(completed.length, 0);
    assert.equal(controller.presentation().layers.length, 0);
  },
);

test(
  'Settings wrapper preserves numeric filters and secret rendering while returning the raw value',
  {
    skip: !available,
  },
  () => {
    const results = [];
    const controller = createSettingsKeyboard(layouts, {
      onResult: (result) => results.push(result),
    });
    controller.open({
      requestId: 8,
      formId: 17,
      profile: 'settings-form',
      nativeType: 3,
      maxLength: 4,
      secret: true,
      text: '',
    });
    controller.advance(30);
    for (const key of '12a.345') controller.keyInput(key);
    const layer = controller
      .presentation()
      .layers.findLast((item) => item.prefix === 'keyboard-text:');
    assert.equal(layer.layout.name, 'fs_VK_textBox_b');
    assert.equal(indexLayout(layer.layout).panes.get('T_2l_TextBox').text, '****');
    assert.equal(controller.activate('key-qwerty'), false);
    controller.activate('key-ok');
    assert.deepEqual(results, [{ requestId: 8, text: '1234', accepted: true }]);
  },
);

test(
  'Settings keyboards reread dictionary preferences and hide the caret on the first quit frame',
  { skip: !available },
  () => {
    let preferences = { predictionEnabled: true, dictionaryLanguage: 'fr' };
    const controller = createSettingsKeyboard(layouts, {
      getKeyboardPreferences: () => preferences,
      onKeyboardPreferencesChange: (next) => { preferences = next; },
    });
    const predictionRequest = { ...request, predictionAllowed: true, languageSelectionAllowed: true };
    controller.open(predictionRequest);
    controller.advance(30);
    assert.equal(controller.getSnapshot().keyboard.predictionEnabled, true);
    assert.equal(controller.getSnapshot().keyboard.dictionaryLanguage, 'fr');
    controller.activate('key-prediction');
    controller.advance(12);
    controller.activate('key-back');
    assert.equal(controller.getSnapshot().keyboard.caretVisible, false);
    const field = controller.presentation().layers.find((layer) => layer.prefix === 'keyboard-text:');
    assert.equal(indexLayout(field.layout).panes.get('T_2l_TextBox').caretVisible, false);
    controller.advance(30);
    controller.open({ ...predictionRequest, requestId: 4 });
    controller.advance(30);
    assert.equal(controller.getSnapshot().keyboard.predictionEnabled, false);
    assert.equal(controller.getSnapshot().keyboard.dictionaryLanguage, 'fr');
  },
);

test(
  'Settings reads current general preferences once per form without saving numeric overrides',
  { skip: !available },
  () => {
    let preferences = normalizeKeyboardPreferences({
      schemaVersion: 2, predictionEnabled: true, dictionaryLanguage: 'fr',
      layoutMode: 'qwerty', phoneMode: 1, symbolPage: 3,
    });
    let reads = 0;
    const changes = [];
    const controller = createSettingsKeyboard(layouts, {
      getKeyboardPreferences: () => {
        reads++;
        return preferences;
      },
      onKeyboardPreferencesChange: (next) => {
        preferences = next;
        changes.push(next);
      },
    });
    controller.open({ ...request, nativeType: 3 });
    controller.advance(30);
    assert.equal(reads, 1);
    assert.equal(controller.getSnapshot().keyboard.layoutMode, 'phone');
    assert.equal(controller.getSnapshot().keyboard.phoneMode, 3);
    controller.activate('key-back');
    controller.advance(30);
    assert.deepEqual(changes, []);
    preferences = { ...preferences, layoutMode: 'phone', phoneMode: 2 };
    controller.open({ ...request, requestId: 4 });
    controller.advance(30);
    assert.equal(reads, 2);
    assert.equal(controller.getSnapshot().keyboard.layoutMode, 'phone');
    assert.equal(controller.getSnapshot().keyboard.phoneMode, 2);
    controller.activate('key-qwerty');
    assert.deepEqual(changes, [{
      schemaVersion: 2, predictionEnabled: true, dictionaryLanguage: 'fr',
      layoutMode: 'qwerty', phoneMode: 2, symbolPage: 3,
    }]);
    assert.equal(controller.getSnapshot().keyboard.predictionEnabled, false);
  },
);
