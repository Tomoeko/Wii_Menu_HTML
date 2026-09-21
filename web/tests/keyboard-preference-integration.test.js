import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { indexLayout, transform } from '../src/animation.js';
import { BitmapFont } from '../src/font.js';
import { Renderer } from '../src/renderer.js';
import { createDisplay } from '../src/display.js';
import { CREATE_LAYOUTS, createBoardCreate } from '../src/board-create.js';
import { createBoardAddress } from '../src/board-address.js';
import { createBoardLetter } from '../src/board-letter.js';
import { createSettingsKeyboard } from '../src/settings-keyboard.js';
import { normalizeKeyboardPreferences } from '../src/keyboard-preferences.js';
import { deferredDictionary, flushDictionary } from './helpers/deferred-dictionary.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && CREATE_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available ? Object.fromEntries(CREATE_LAYOUTS.map((key) => [
  key, JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
])) : {};

function openMemo(options) {
  const create = createBoardCreate(layouts, options);
  create.advance(39);
  create.activate('memo');
  create.advance(27);
  create.activate('memo-edit');
  create.advance(30);
  return create;
}

function openAddress(kind, options) {
  const address = createBoardAddress(layouts, options);
  address.advance(17);
  address.submit();
  address.advance(36);
  address.activate(`address-${kind}`);
  address.advance(61);
  address.activate('address-edit');
  return address;
}

function pane(controller, prefix, name) {
  const layer = controller.presentation().layers.find((item) => item.prefix === prefix);
  assert.ok(layer, prefix);
  return indexLayout(layer.layout).panes.get(name);
}

test('JSON-reloaded Memo choices survive forced Settings and Address fields, then restore in Letter',
  { skip: !available }, () => {
    // The adapter boundary matches main's validated local-storage JSON callback.
    // Reconstructing each owner and parsing on every open avoids shared-object
    // state making this test pass without exercising the persistence contract.
    let stored = JSON.stringify({
      schemaVersion: 1, predictionEnabled: false, dictionaryLanguage: 'fr',
    });
    const options = {
      getKeyboardPreferences: () => normalizeKeyboardPreferences(JSON.parse(stored)),
      onKeyboardPreferencesChange: (value) => {
        stored = JSON.stringify(normalizeKeyboardPreferences(value));
      },
    };
    const memo = openMemo(options);
    memo.activate('key-prediction');
    memo.advance(12);
    memo.activate('key-phone');
    memo.activate('key-phone-mode-2');
    memo.activate('key-more');
    memo.advance(18);
    for (let page = 0; page < 2; page++) {
      memo.activate('key-symbols-next');
      memo.advance(20);
    }
    memo.activate('key-symbols-close');
    memo.advance(13);
    memo.activate('key-back');
    memo.dispose();
    const saved = stored;
    assert.deepEqual(JSON.parse(saved), {
      schemaVersion: 2, predictionEnabled: true, dictionaryLanguage: 'fr',
      layoutMode: 'phone', phoneMode: 2, symbolPage: 2,
    });

    for (const nativeType of [3, 10]) {
      const settings = createSettingsKeyboard(layouts, options);
      settings.open({
        requestId: nativeType, profile: 'settings-form', nativeType, text: '', maxLength: 16,
      });
      settings.advance(30);
      assert.equal(settings.getSnapshot().keyboard.layoutMode, 'phone');
      assert.equal(settings.getSnapshot().keyboard.phoneMode, 3);
      assert.equal(settings.getSnapshot().keyboard.predictionEnabled, false);
      settings.keyInput('9');
      settings.activate('key-back');
      settings.advance(30);
      settings.reset();
      assert.equal(stored, saved);
    }

    for (const kind of ['wii', 'email']) {
      const address = openAddress(kind, options);
      for (const control of [
        'key-phone', 'key-qwerty', 'key-phone-mode-2', 'key-prediction', 'key-language',
        'key-more', 'key-return',
      ]) assert.equal(address.activate(control), false, `${kind}: ${control}`);
      if (kind === 'wii') {
        assert.equal(pane(address, 'keyboard-phone:', 'T_CPkey_01').text, '2');
        for (const character of 'A1.2345678123456789') address.keyInput(character);
        assert.equal(pane(address, 'keyboard-text:', 'T_2l_TextBox').text, '1234567812345678');
      } else {
        assert.ok(address.presentation().layers.some((layer) => layer.prefix === 'keyboard-ascii:'));
        for (const character of 'a'.repeat(100)) address.keyInput(character);
        assert.equal(pane(address, 'keyboard-text:', 'T_2l_TextBox').text.length, 99);
      }
      address.back();
      address.dispose();
      assert.equal(stored, saved, `${kind} effective overrides never enter saved preferences`);
    }

    const reopened = openMemo(options);
    assert.equal(pane(reopened, 'keyboard-phone:', 'T_CPkey_01').text, 'ABC');
    assert.equal(reopened.presentation().controls.find((item) => item.id === 'key-prediction').label,
      'Turn dictionary off');
    reopened.activate('key-more');
    reopened.advance(18);
    assert.equal(pane(reopened, 'keyboard-symbols:', 'T_SGN_pageNumber').text, '3/10');
    reopened.dispose();

    const letter = createBoardLetter(layouts, {
      ...options, recipient: { kind: 'wii', address: '1234567812345678', nickname: 'Fixture' },
    });
    letter.advance(17);
    letter.activate('letter-edit');
    letter.advance(30);
    assert.equal(pane(letter, 'keyboard-phone:', 'T_CPkey_01').text, 'ABC');
    letter.activate('key-more');
    letter.advance(18);
    assert.equal(pane(letter, 'keyboard-symbols:', 'T_SGN_pageNumber').text, '3/10');
    letter.dispose();
    assert.equal(stored, saved);
  });

test('Address nickname uses the native large symbols-enabled profile without overwriting prediction',
  { skip: !available }, () => {
    let stored = JSON.stringify({
      schemaVersion: 2, predictionEnabled: true, dictionaryLanguage: 'es',
      layoutMode: 'phone', phoneMode: 1, symbolPage: 2,
    });
    const address = openAddress('wii', {
      getKeyboardPreferences: () => normalizeKeyboardPreferences(JSON.parse(stored)),
      onKeyboardPreferencesChange: (value) => { stored = JSON.stringify(value); },
    });
    // Generated checksum-valid fixture, not an assigned console identity.
    for (const character of '8742285515623182') address.keyInput(character);
    address.back();
    address.submit();
    address.advance(40);
    address.activate('address-edit');
    const field = address.presentation().layers.find((layer) => layer.prefix === 'keyboard-text:');
    assert.equal(field.layout.name, 'fs_VK_textBox_b');
    assert.equal(pane(address, 'keyboard-phone:', 'T_CPkey_01').text, 'abc');
    for (const id of ['key-language', 'key-prediction', 'key-return'])
      assert.equal(address.activate(id), false);
    assert.equal(address.activate('key-more'), true);
    address.advance(18);
    assert.equal(pane(address, 'keyboard-symbols:', 'T_SGN_pageNumber').text, '3/10');
    address.activate('key-symbols-close');
    address.advance(13);
    assert.equal(address.activate('key-qwerty'), true);
    for (const character of 'NicknameTooLong') address.keyInput(character);
    assert.equal(pane(address, 'keyboard-text:', 'T_2l_TextBox').text, 'NicknameTo');
    address.back();
    address.dispose();
    assert.deepEqual(JSON.parse(stored), {
      schemaVersion: 2, predictionEnabled: true, dictionaryLanguage: 'es',
      layoutMode: 'qwerty', phoneMode: 1, symbolPage: 2,
    });
  });

test('Address e-mail applies its native five-row bound with original font metrics and scroll clipping',
  { skip: !available || !manifest.fonts?.['WiiBitmapFontType1.brfnt'] }, () => {
    const font = new BitmapFont(JSON.parse(readFileSync(new URL(
      manifest.fonts['WiiBitmapFontType1.brfnt'].url, manifestUrl,
    ))), {});
    const address = openAddress('email', {
      measureTextLayout: (text, template) => font.layoutPaneText(text, template),
    });
    for (const character of 'W'.repeat(100)) address.keyInput(character);
    address.advance(30);
    const textLayers = address.presentation().layers.filter((layer) => layer.prefix === 'keyboard-text:');
    assert.equal(textLayers.length, 2, 'original field background and clipped text remain separate');
    const input = indexLayout(textLayers[1].layout).panes.get('T_2l_TextBox');
    assert.equal(input.text.length, 90, 'five original-font rows of eighteen wide letters fit');
    assert.equal(font.layoutPaneText(input.text, input).lines.length, 5);
    assert.ok(input.translation[1] > 0, 'the caret follows the final row');
    assert.equal(textLayers[1].clipFollowsRoot, true);
    assert.ok(textLayers[1].clip.h > 0);
    address.dispose();
  });

test('Memo, Letter, Address and Settings owners forward held Backspace and stop it on blur/close',
  { skip: !available }, () => {
    const factories = {
      memo: () => openMemo({}),
      letter: () => {
        const letter = createBoardLetter(layouts, {
          recipient: { kind: 'wii', address: '1234567812345678', nickname: 'Fixture' },
        });
        letter.advance(17);
        letter.activate('letter-edit');
        letter.advance(30);
        return letter;
      },
      wii: () => openAddress('wii', {}),
      email: () => openAddress('email', {}),
      settings: () => {
        const settings = createSettingsKeyboard(layouts);
        settings.open({ requestId: 1, nativeType: 6, profile: 'console-nickname', text: '' });
        settings.advance(30);
        return settings;
      },
    };
    const read = (owner, kind) => {
      if (kind === 'settings') return owner.getSnapshot().keyboard.text;
      if (kind === 'memo') return owner.snapshot().memoText;
      if (kind === 'letter') return owner.snapshot().text;
      return pane(owner, 'keyboard-text:', 'T_2l_TextBox').text;
    };
    for (const [kind, create] of Object.entries(factories)) {
      const owner = create();
      for (const character of '12345678') owner.keyInput(character);
      assert.equal(owner.holdControl('key-delete'), true, kind);
      assert.equal(read(owner, kind), '1234567', kind);
      owner.advance(35);
      assert.equal(read(owner, kind), '1234567', kind);
      owner.advance(1);
      assert.equal(read(owner, kind), '123456', kind);
      owner.keyInput('', { type: 'blur' });
      owner.advance(100);
      assert.equal(read(owner, kind), '123456', `${kind} blur`);
      assert.equal(owner.holdControl('key-delete'), true, kind);
      assert.equal(read(owner, kind), '12345', kind);
      owner.activate('key-back');
      owner.advance(30);
      assert.equal(owner.holdControl('key-delete'), false, `${kind} closed keyboard`);
      if (kind === 'settings') owner.reset();
      else owner.dispose();
    }
  });


test('Memo Back preserves accepted boundary typing before closing and reopening its draft',
  { skip: !available }, async () => {
    const { provider, sessions } = deferredDictionary();
    const drafts = [];
    const memo = openMemo({
      predict: provider,
      getKeyboardPreferences: () => normalizeKeyboardPreferences({ schemaVersion: 2, predictionEnabled: true }),
      onDraft: (value) => drafts.push(value),
    });
    for (const character of 'a'.repeat(32)) memo.keyInput(character);
    memo.keyInput('b');
    memo.keyInput('c');
    memo.keyInput('Backspace');
    assert.equal(memo.back(), true);
    assert.equal(memo.snapshot().editing, true, 'the pending edit still owns its keyboard');
    assert.equal(sessions[0].closeCalls, 0);
    sessions[0].requests.at(-1).resolve({
      engine: 'original-zi8', candidates: [`${'a'.repeat(32)}ghost`],
    });
    await flushDictionary();
    const expected = `${'a'.repeat(32)}ghostb`;
    assert.equal(memo.snapshot().memoText, expected);
    assert.equal(drafts.at(-1), expected);
    assert.equal(sessions[0].closeCalls, 1);
    memo.advance(30);
    assert.equal(memo.snapshot().editing, false);
    assert.equal(memo.activate('memo-edit'), true);
    memo.advance(30);
    assert.equal(memo.snapshot().memoText, expected);
    assert.equal(sessions.length, 2, 'reopening starts an isolated provider without losing text');
    memo.dispose();
  });

test('Memo, Letter and prediction-enabled Settings route fresh text clicks through composition commit',
  { skip: !available || !manifest.fonts?.['WiiBitmapFontType1.brfnt'] }, () => {
    const font = new BitmapFont(JSON.parse(readFileSync(new URL(
      manifest.fonts['WiiBitmapFontType1.brfnt'].url, manifestUrl,
    ))), {});
    for (const aspect of ['4:3', '16:9']) {
      for (const kind of ['memo', 'letter', 'settings']) {
        const display = createDisplay(aspect);
        const sounds = [];
        const options = {
          display,
          predict: () => ['hello'],
          getKeyboardPreferences: () => ({ predictionEnabled: true }),
          measureTextLayout: (text, template) => font.layoutPaneText(text, template),
          onSound: (name) => sounds.push(name),
        };
        let owner;
        let prefix;
        let paneName = 'T_Letter';
        if (kind === 'memo') {
          owner = openMemo(options);
          prefix = 'scene-create-body:';
        } else if (kind === 'letter') {
          owner = createBoardLetter(layouts, {
            ...options,
            recipient: { kind: 'wii', address: '1234567812345678', nickname: 'Fixture' },
          });
          owner.advance(17);
          owner.activate('letter-edit');
          owner.advance(30);
          prefix = 'letter-body:';
        } else {
          owner = createSettingsKeyboard(layouts, options);
          owner.open({
            requestId: 1, profile: 'settings-form', nativeType: 13,
            text: '', maxLength: 40, predictionAllowed: true,
          });
          owner.advance(30);
          prefix = 'keyboard-text:';
          paneName = 'T_2l_TextBox';
        }
        for (const character of 'hel') owner.keyInput(character);
        owner.advance(15);
        const renderer = Object.create(Renderer.prototype);
        renderer.display = display;
        renderer.bounds = new Map();
        renderer.quad = () => {};
        renderer.window = () => {};
        const field = () => {
          for (const layer of owner.presentation().layers)
            renderer.draw(layer.layout, { ...layer });
          return renderer.bounds.get(prefix + paneName);
        };
        const bound = field();
        const line = font.layoutPaneText(bound.pane.text, bound.pane).lines[0];
        const [x, y] = transform(bound.matrix, line.carets[0].x, line.y - 14);
        const point = { x: display.halfWidth + x, y: display.halfHeight - y };
        sounds.length = 0;
        assert.equal(owner.selectTextAt(point), true, `${kind} ${aspect}`);
        assert.equal(field().pane.text, 'hello');
        assert.equal(field().pane.caretIndex, 5, `${kind} first click only commits`);
        assert.deepEqual(sounds, ['WIPL_SE_CHAR_DECIDE']);
        assert.equal(owner.selectTextAt(point), true);
        assert.equal(field().pane.caretIndex, 0, `${kind} second click moves to the point`);
        assert.deepEqual(sounds, ['WIPL_SE_CHAR_DECIDE', 'WIPL_SE_CHAR_CURSOR']);
        if (kind === 'settings') owner.reset();
        else owner.dispose();
      }
    }
  });
