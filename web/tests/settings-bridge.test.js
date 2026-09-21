import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/settings-bridge.js', import.meta.url), 'utf8');
function bridge(name = '') {
  const messages = [],
    appended = [],
    nodes = { Name: { value: 'Browser Wii' } },
    listeners = {};
  const document = {
    head: { appendChild: (node) => appended.push(node) },
    createElement: (name) => ({ tagName: name.toUpperCase() }),
    getElementById: (id) => nodes[id],
    getElementsByName: () => [],
    querySelectorAll: () => [],
    addEventListener: (name, callback) => {
      listeners[name] = callback;
    },
  };
  const window = {
    name,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    document,
    parent: { postMessage: (message) => messages.push(message) },
    location: {
      href: 'http://localhost/assets/settings/US2/FIX/US/ENG/index01.html',
      pathname: '/assets/settings/US2/FIX/US/ENG/index01.html',
    },
    addEventListener: (name, callback) => {
      listeners[name] = callback;
    },
  };
  vm.runInNewContext(source, { window, Date, URL });
  return {
    window, document, messages, nodes, listeners, appended,
    wii: new window.wiiSetting(),
  };
}
function dismissValidation(context) {
  const request = context.messages.findLast((message) => message.action === 'validation-request');
  context.listeners.message({
    source: context.window.parent,
    data: { type: 'wii-settings-validation-complete', requestId: request.requestId },
  });
  return request;
}

test('Settings font readiness waits for stylesheet and both original physical faces', async () => {
  const context = bridge();
  const stylesheet = context.appended.find((node) => node.tagName === 'LINK');
  const requested = [];
  let finished = false;
  context.document.fonts = {
    async load(family) {
      requested.push(family);
      return [{ status: 'loaded' }];
    },
  };
  context.window.WiiSettingsFontsReady.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  await stylesheet.onload();
  await context.window.WiiSettingsFontsReady;
  assert.deepEqual(requested, ['16px "Wii NTLG Gothic"', '16px "Wii NTLG PGothic"']);
  assert.equal(finished, true);
});

test('missing stylesheet or failed original face is reported instead of accepting fallback fonts', async () => {
  const missing = bridge();
  missing.appended.find((node) => node.tagName === 'LINK').onerror();
  await assert.rejects(missing.window.WiiSettingsFontsReady, /stylesheet could not load/);
  for (const faces of [[], [{ status: 'error' }]]) {
    const context = bridge();
    context.document.fonts = { load: async () => faces };
    await context.appended.find((node) => node.tagName === 'LINK').onload();
    await assert.rejects(context.window.WiiSettingsFontsReady, /original Settings font could not load/);
  }
});

test('three local connection slots retain independent fields, labels and current selection', () => {
  const first = bridge();
  for (let slot = 0; slot < 3; slot++) {
    first.wii.profileID = slot;
    if (slot === 1) first.wii.selectWire = 0;
    else first.wii.wifiType = 0;
    first.nodes.textfield = { value: `Network ${slot}` };
    first.wii.setstring = 4;
    first.wii.autoIP = 0;
    first.nodes.textfield22 = { value: `192.168.${slot}.10` };
    first.nodes.textfield2 = { value: '255.255.255.0' };
    first.nodes.textfield3 = { value: `192.168.${slot}.1` };
    first.wii.setstring = 5;
    first.wii.funcID = 20;
  }
  const second = bridge(first.window.name);
  assert.deepEqual(
    [second.wii.connectType1, second.wii.connectType2, second.wii.connectType3],
    [2, 1, 2],
  );
  for (let slot = 0; slot < 3; slot++) {
    second.wii.profileID = slot;
    assert.equal(second.wii.ipAddr, `192.168.${slot}.10`);
    assert.equal(second.wii.ssID, slot === 1 ? '' : `Network ${slot}`);
  }
  second.wii.useID = 0;
  assert.equal(second.wii.useID, 3);
  second.wii.connectTest = 1;
  assert.equal(second.wii.useID, 2);
  second.wii.profileID = 1;
  second.wii.funcID = 10;
  assert.deepEqual(
    [second.wii.connectType1, second.wii.connectType2, second.wii.connectType3],
    [2, 0, 2],
  );
  const saved = JSON.parse(second.window.WiiSettingsBridge.snapshot().networkSavedProfiles);
  assert.equal(saved.version, 1);
  assert.equal(saved.profiles[0].ssID, 'Network 0');
  assert.equal(saved.profiles[1].ipAddr, '0.0.0.0');
});

test('connection capability and automatic DNS flags follow the selected local profile', () => {
  const { wii } = bridge();
  for (const [type, changeEnable] of [
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 1],
  ]) {
    wii.wifiType = type;
    assert.equal(wii.changeEnable, changeEnable);
  }
  wii.autoIP = 1;
  wii.autoDNS = 1;
  assert.equal(wii.autoDNS, 1);
  wii.autoIP = 0;
  assert.equal(wii.autoDNS, 0);
  wii.autoIP = 1;
  assert.equal(wii.autoDNS, 0);
  wii.connectTest = 1;
  wii.profileID = 1;
  assert.equal(wii.connectTest, 0);
  wii.profileID = 0;
  assert.equal(wii.connectTest, 1);
});

test('NCD cancel restores all local profile buffers without changing the selected slot', () => {
  const { wii } = bridge();
  wii.ssID = 'First';
  wii.profileID = 1;
  wii.ssID = 'Second';
  wii.backupNCD;
  wii.ssID = 'Second draft';
  wii.profileID = 0;
  wii.ssID = 'First draft';
  wii.resetNCD;
  assert.equal(wii.profileID, 0);
  assert.equal(wii.ssID, 'First');
  wii.profileID = 1;
  assert.equal(wii.ssID, 'Second');
});

test('native field validation keeps invalid edits local and permits correction after the timed message', () => {
  const context = bridge();
  const { wii, nodes, messages } = context;
  nodes.Name.value = '';
  wii.setstring = 2;
  assert.equal(wii.funcResult, 4);
  assert.equal(wii.nickname, 'Wii');
  assert.equal(dismissValidation(context).messageId, 448);
  nodes.Name.value = '\u3000 ';
  wii.setstring = 2;
  assert.equal(dismissValidation(context).messageId, 449);
  nodes.Name.value = 'Updated';
  wii.setstring = 2;
  assert.equal(wii.funcResult, 3);
  assert.equal(wii.nickname, 'Updated');
  nodes.textfield = { value: 'bad..proxy' };
  nodes.textfield22 = { value: '8080' };
  wii.setstring = 7;
  assert.equal(wii.proxy, '');
  assert.equal(dismissValidation(context).messageId, 446);
  nodes.textfield.value = 'proxy.local';
  nodes.textfield22.value = '0';
  wii.setstring = 7;
  assert.equal(dismissValidation(context).messageId, 446);
  nodes.textfield22.value = '8080';
  wii.setstring = 7;
  assert.equal(wii.proxy, 'proxy.local');
  assert.equal(wii.proxyPort, '8080');
  assert.equal(wii.funcResult, 3);
  assert.equal(messages.filter((message) => message.action === 'validation-request').length, 4);
});

test('security formats and numeric normalization follow the verified native validators', () => {
  const context = bridge();
  const { wii, nodes, window } = context;
  wii.selectSecKey = 1;
  nodes.textfield = { value: 'bad' };
  wii.setstring = 3;
  assert.equal(dismissValidation(context).messageId, 446);
  for (const key of ['abcde', '0123456789', '0123456789ab', 'a'.repeat(26)]) {
    nodes.textfield.value = key;
    wii.setstring = 3;
    if (key.length === 12) {
      assert.equal(dismissValidation(context).messageId, 446);
    } else {
      assert.equal(wii.funcResult, 3);
      assert.equal(window.WiiSettingsBridge.snapshot().securityKey, key);
    }
  }
  wii.selectSecKey = 2;
  nodes.textfield.value = 'g'.repeat(64);
  wii.setstring = 3;
  assert.equal(dismissValidation(context).messageId, 446);
  nodes.textfield.value = 'a'.repeat(64);
  wii.setstring = 3;
  assert.equal(wii.funcResult, 3);
  nodes.textfield22 = { value: '192.1' };
  nodes.textfield2 = { value: '999.255.255.0' };
  nodes.textfield3 = { value: '' };
  wii.setstring = 5;
  assert.equal(wii.ipAddr, '192.0.0.1');
  assert.equal(wii.subnet, '255.255.255.0');
  assert.equal(wii.gateway, '0.0.0.0');
  for (const [value, expected] of [
    ['575', 0],
    ['576', 576],
    ['1500', 1500],
    ['1501', 0],
  ]) {
    nodes.textfield2.value = value;
    wii.setstring = 9;
    assert.equal(wii.mtu, expected);
  }
});
test('original synchronous constructors retain only browser-local settings across navigation', () => {
  const first = bridge();
  first.wii.soundId = 2;
  first.wii.WriteBack();
  assert.equal(bridge(first.window.name).wii.soundId, 2);
  assert.equal(first.document.all('Name'), first.nodes.Name);
  assert.equal(first.document.all.Name, first.nodes.Name);
  first.wii.setstring = 2;
  assert.equal(first.wii.funcResult, 3);
  assert.equal(first.wii.nickname, 'Browser Wi');
  assert.equal(first.messages.at(-1).action, 'changed');
});
test('nickname keyboard completion edits the form, while original Confirm owns persistence', () => {
  const { window, listeners, wii, nodes, messages } = bridge();
  const events = [];
  nodes.Name.dispatchEvent = (event) => events.push(event.type);
  wii.formID = 1;
  const request = messages.find((message) => message.action === 'keyboard-request');
  assert.equal(request.profile, 'console-nickname');
  assert.equal(request.title, '');
  assert.equal(request.titleId, undefined);
  assert.equal(request.text, 'Browser Wii');
  assert.equal(request.maxLength, 10);
  for (const key of [
    'multiline',
    'predictionAllowed',
    'languageSelectionAllowed',
    'symbolsAllowed',
  ])
    assert.equal(request[key], false);
  assert.equal(request.layoutSelectionAllowed, true);
  const complete = (source, requestId, accepted, text) =>
    listeners.message({
      source,
      data: { type: 'wii-settings-keyboard-complete', requestId, accepted, text },
    });
  complete({}, request.requestId, true, 'Ignored');
  complete(window.parent, request.requestId + 1, true, 'Ignored');
  assert.equal(nodes.Name.value, 'Browser Wii');
  complete(window.parent, request.requestId, true, 'Test\nConsole long');
  assert.equal(nodes.Name.value, 'TestConsol');
  assert.equal(wii.nickname, 'Wii');
  assert.equal(wii.formID, 0);
  assert.deepEqual(events, ['input', 'change']);
  wii.setstring = 2;
  assert.equal(wii.nickname, 'TestConsol');
  assert.equal(wii.funcResult, 3);
  wii.formID = 1;
  const cancel = messages.findLast((message) => message.action === 'keyboard-request');
  complete(window.parent, cancel.requestId, false, 'Discard');
  assert.equal(nodes.Name.value, 'TestConsol');
});
test('same-document choice links do not acquire a navigation lock', () => {
  const { listeners, messages } = bridge();
  let prevented = 0;
  for (const href of ['#', '#choice', 'index01.html'])
    listeners.click({
      target: { closest: () => ({ getAttribute: () => href }) },
      preventDefault: () => prevented++,
    });
  assert.equal(prevented, 3);
  assert.equal(messages.filter((message) => message.action === 'navigation').length, 0);
  listeners.click({
    target: { closest: () => ({ getAttribute: () => 'index02.html' }) },
    preventDefault: () => prevented++,
  });
  assert.equal(messages.at(-1).action, 'navigation');
});

const originalRoot = new URL('../public/assets/settings/US2/FIX/', import.meta.url);
function originalScripts(context, paths) {
  for (const path of paths)
    vm.runInContext(readFileSync(new URL(path, originalRoot), 'utf8'), context);
}
test(
  'extracted resolution script selects EDTV and retains its native unavailable treatment',
  {
    skip: !existsSync(new URL('js/US/COM/Display.js', originalRoot)),
  },
  () => {
    const { wii, nodes, document } = bridge();
    for (const id of ['mySet', 'List01', 'List01Check', 'List02Check']) nodes[id] = { style: {} };
    const context = vm.createContext({ wii, document, setTimeout() {} });
    originalScripts(context, ['js/iplSetting.js', 'js/US/COM/Display.js']);
    vm.runInContext('init_Progressive_set()', context);
    assert.equal(nodes.List01Check.style.visibility, 'visible');
    assert.equal(nodes.List02Check.style.visibility, 'hidden');
    assert.equal(nodes.List01.style.visibility, 'visible');
    wii.dtv = 0;
    vm.runInContext('waitFuncResult_Progressive_set()', context);
    assert.equal(wii.progressive, 0);
    assert.equal(nodes.List01Check.style.visibility, 'hidden');
    assert.equal(nodes.List02Check.style.visibility, 'visible');
    assert.equal(nodes.List01.style.visibility, 'hidden');
    assert.match(nodes.mySet.style.backgroundImage, /Btn_List_Dark\.gif/);
  },
);
test(
  'extracted connection scripts initialize and navigate all three local empty slots',
  {
    skip: !existsSync(new URL('js/US/COM/Internet.js', originalRoot)),
  },
  () => {
    const { wii, nodes, document } = bridge();
    for (const id of [
      'List01Check',
      'List02Check',
      'List03Check',
      'conType1',
      'conType2',
      'conType3',
    ])
      nodes[id] = { style: {}, innerHTML: '' };
    const location = { href: '' };
    const context = vm.createContext({ wii, document, location, setTimeout() {} });
    originalScripts(context, [
      'js/iplSetting.js',
      'js/US/ENG/iplMessage.js',
      'js/US/COM/Internet.js',
    ]);
    vm.runInContext('init_Connect_set_top()', context);
    assert.deepEqual(
      [nodes.conType1.innerHTML, nodes.conType2.innerHTML, nodes.conType3.innerHTML],
      ['None', 'None', 'None'],
    );
    for (let slot = 0; slot < 3; slot++) {
      vm.runInContext(
        `setProfileID_Connect_set_top(${slot}); jump_Connect_set_top(${slot})`,
        context,
      );
      assert.equal(wii.profileID, slot);
      assert.equal(location.href, 'Connect_select.html');
    }
  },
);
test('hardware services remain dummy and exit/sound use typed messages', () => {
  const { wii, messages } = bridge();
  wii.funcID = 29;
  assert.equal(wii.funcResult, 1); // Unprotected local-console navigation.
  wii.funcID = 100;
  assert.equal(wii.funcResult, 2);
  assert.equal(messages.at(-1).action, 'dummy');
  wii.se = 3;
  assert.equal(messages.at(-1).value, 3);
  wii.finish = 1;
  assert.equal(messages.at(-1).type, 'wii-settings');
  assert.equal(messages.at(-1).action, 'exit');
  wii.soundId = 2;
  assert.equal(messages.at(-1).action, 'sound');
  assert.equal(messages.at(-1).value, 12);
});
test('sandbox JavaScript links call only the original supported functions after onclick', () => {
  const { window, listeners, wii } = bridge();
  const calls = [];
  window.jump_ONOFF_set = () => calls.push(['onoff', wii.nwc24]);
  window.jumpPare_index02 = () => calls.push(['parental']);
  window.jump_Connect_set_top = (slot) => calls.push(['connection', slot, wii.profileID]);
  window.unrelated = () => calls.push(['unrelated']);
  function activate(href, defaultPrevented = false) {
    const event = {
      defaultPrevented,
      target: { closest: () => ({ getAttribute: () => href }) },
      preventDefault() { this.defaultPrevented = true; },
    };
    listeners.click(event);
    return event.defaultPrevented;
  }
  // The page's own onclick has committed the chosen setting or profile before
  // the document's bubbling listener handles its original URL action.
  wii.nwc24 = 1;
  assert.equal(activate('javaScript:jump_ONOFF_set()'), true);
  assert.equal(activate('javaScript:jumpPare_index02()'), true);
  for (let slot = 0; slot < 3; slot++) {
    wii.profileID = slot;
    assert.equal(activate(`javaScript:jump_Connect_set_top(${slot})`), true);
  }
  assert.equal(activate('javaScript:void(0)'), true);
  activate('javaScript:jump_ONOFF_set()', true);
  activate('javaScript:unrelated()');
  activate('javaScript:jump_Connect_set_top(3)');
  activate('javaScript:jump_ONOFF_set(); unrelated()');
  assert.deepEqual(calls, [
    ['onoff', 1], ['parental'],
    ['connection', 0, 0], ['connection', 1, 1], ['connection', 2, 2],
  ]);
});

test('extracted WiiConnect24 confirmation routes both values through the sandbox link bridge', {
  skip: !existsSync(new URL('js/US/COM/WiiConnect24.js', originalRoot)),
}, () => {
  const { window, listeners, wii, document } = bridge();
  const location = { href: '' };
  const context = vm.createContext({ wii, document, location });
  originalScripts(context, ['js/US/COM/WiiConnect24.js']);
  window.jump_ONOFF_set = context.jump_ONOFF_set;
  for (const value of [0, 1]) {
    wii.nwc24 = value;
    listeners.click({
      target: { closest: () => ({ getAttribute: () => 'javaScript:jump_ONOFF_set()' }) },
      preventDefault() {},
    });
    assert.equal(location.href, value ? 'Wiiconnect24_index.html' : 'Wiiconnect24_off_index.html');
  }
});

test('configuration accepts messages only from the iframe parent', () => {
  const { window, listeners, wii } = bridge();
  listeners.message({ source: {}, data: { type: 'wii-settings-configure', wide: false } });
  assert.equal(wii.dis_wide, 1);
  listeners.message({
    source: window.parent,
    data: { type: 'wii-settings-configure', wide: false },
  });
  assert.equal(wii.dis_wide, 0);
});
test('opaque country frames share local values and navigate only inside the settings subtree', () => {
  const { window, document, listeners, wii } = bridge(),
    replies = [];
  const child = {
    contentWindow: { postMessage: (value) => replies.push(value) },
    getBoundingClientRect: () => ({ left: 0, top: 64 }),
  };
  document.querySelectorAll = (selector) => (selector === 'frame,iframe' ? [child] : []);
  const patch = {
    type: 'wii-settings-frame',
    action: 'patch',
    state: { country: 72, unknown: 'ignored' },
  };
  listeners.message({ source: {}, data: patch });
  assert.equal(wii.country, 49);
  listeners.message({ source: child.contentWindow, data: patch });
  assert.equal(wii.country, 72);
  assert.equal(replies[0].state.country, 72);
  assert.equal(replies[0].state.unknown, undefined);
  const before = window.location.href;
  listeners.message({
    source: child.contentWindow,
    data: { type: 'wii-settings-frame', action: 'navigate', url: 'https://example.org/' },
  });
  assert.equal(window.location.href, before);
  listeners.message({
    source: child.contentWindow,
    data: {
      type: 'wii-settings-frame',
      action: 'navigate',
      url: '/assets/settings/US2/FIX/US/ENG/index03.html',
    },
  });
  assert.ok(window.location.href.endsWith('index03.html'));
});

test('country footer preserves local cancel and setup destinations inside its frameset', () => {
  for (const [initFlag, updateType, destination] of [
    [0, 0, 'index03.html'],
    [1, 0, 'Parental_Control/Parental_Control_index.html'],
    [1, 1, 'Setup/ScreenSave.html'],
  ]) {
    const { window, listeners, wii, messages } = bridge();
    window.location.href =
      'http://localhost/assets/settings/US2/FIX/US/ENG/Country/US_Country_flame_D.html';
    window.location.pathname = new URL(window.location.href).pathname;
    wii.initFlag = initFlag;
    wii.updateType = updateType;
    listeners.DOMContentLoaded();
    wii.country = 72;
    window.setSE();
    assert.equal(wii.country, 49);
    assert.ok(messages.at(-1).url.endsWith(initFlag ? 'Setup/Nickname_set.html' : 'index03.html'));
    wii.country = 72;
    window.setCountry();
    assert.equal(wii.countrySave, 72);
    assert.ok(messages.at(-1).url.endsWith(destination));
  }
});

test(
  'original network Cancel restores the edit backup across document navigation',
  {
    skip: !existsSync(new URL('js/US/COM/Internet.js', originalRoot)),
  },
  () => {
    const original = bridge();
    original.wii.ssID = 'Saved network';
    original.wii.proxy = 'saved.local';
    original.wii.backupNCD;
    original.wii.ssID = 'Draft network';
    original.wii.proxy = 'draft.local';
    const next = bridge(original.window.name);
    const context = vm.createContext({ wii: next.wii });
    originalScripts(context, ['js/US/COM/Internet.js']);
    vm.runInContext('resetData_Hand_Connect_select()', context);
    assert.equal(next.wii.ssID, 'Saved network');
    assert.equal(next.wii.proxy, 'saved.local');
    assert.equal(next.wii.nickname, 'Wii');
    assert.equal(bridge(next.window.name).wii.proxy, 'saved.local');
  },
);

test(
  'original local text Confirm handlers commit their form and leave their polling page',
  {
    skip: !existsSync(new URL('js/US/COM/Internet.js', originalRoot)),
  },
  () => {
    for (const example of [
      {
        fields: { textfield: 'proxy.local', textfield22: '8080' },
        call: 'Hand_Proxy_keycode',
        destination: 'Hand_Proxy_select.html',
        values: { proxy: 'proxy.local', proxyPort: '8080' },
      },
      {
        fields: { textfield: 'test-user', password: 'local-only' },
        call: 'Hand_Basic_keycode',
        destination: 'Hand_Proxy_keycode.html',
        values: { basicName: 'test-user', basicPass: 'local-only' },
      },
    ]) {
      const { wii, nodes, document } = bridge();
      for (const [name, value] of Object.entries(example.fields)) nodes[name] = { value };
      const location = { href: '' };
      const context = vm.createContext({ wii, document, location, setTimeout() {} });
      originalScripts(context, ['js/US/COM/Internet.js']);
      vm.runInContext(`setString_${example.call}(); waitFuncResult_${example.call}()`, context);
      assert.equal(wii.funcResult, 3);
      assert.equal(location.href, example.destination);
      for (const [key, value] of Object.entries(example.values)) assert.equal(wii[key], value);
    }
  },
);

test(
  'parental PIN setup advances, and mismatched repeat uses the original retry page',
  {
    skip: !existsSync(new URL('js/US/COM/Parental_Control.js', originalRoot)),
  },
  () => {
    const { wii, nodes, document } = bridge();
    nodes.textfield2 = { value: '1234' };
    const location = { href: '' };
    const context = vm.createContext({
      wii,
      document,
      location,
      setTimeout() {},
      _commonSetString: (sound, operation) => {
        wii.se = sound;
        wii.setstring = operation;
      },
    });
    originalScripts(context, ['js/US/COM/Parental_Control.js']);
    vm.runInContext(
      'setString_Input_Secret_number01(); waitFuncResult_Input_Secret_number01()',
      context,
    );
    assert.equal(location.href, 'Input_Secret_number02.html');
    nodes.textfield2.value = '4567';
    vm.runInContext(
      'setString_Input_Secret_number02(); waitFuncResult_Input_Secret_number02()',
      context,
    );
    assert.equal(location.href, 'Common0101.html');
    nodes.textfield2.value = '1234';
    vm.runInContext(
      'setString_Input_Secret_number02(); waitFuncResult_Input_Secret_number02()',
      context,
    );
    assert.equal(location.href, 'Input_Secret_keyword01.html');
    assert.equal(wii.parentalPin, '1234');
  },
);

test(
  'dummy pairing failures finish the original waiting pages instead of polling an absent native dialog',
  {
    skip: !existsSync(new URL('js/US/COM/Internet.js', originalRoot)),
  },
  () => {
    for (const page of ['Common0209', 'Common0211', 'Common0212', 'Common0212b']) {
      const { wii, document } = bridge();
      const location = { href: '' };
      const context = vm.createContext({
        wii,
        document,
        location,
        setTimeout() {},
        _msgConnectNum() {},
        _msgWirelessSetting() {},
      });
      originalScripts(context, ['js/US/COM/Internet.js']);
      vm.runInContext(`init_${page}(); waitFuncResult_${page}()`, context);
      assert.equal(wii.funcResult, 10);
      assert.equal(location.href, 'Wi_Fi_set_top.html');
    }
  },
);

test('Settings form requests retain binary keyboard limits and blank sensitive initial fields', () => {
  for (const [formId, name, nativeType, limit, rows] of [
    [3, 'textfield', 7, 32, 2],
    [4, 'textfield22', 10, 15, 1],
    [10, 'textfield', 7, 255, 16],
    [11, 'textfield22', 3, 5, 1],
    [13, 'password', 7, 32, 2],
    [17, 'textfield2', 3, 4, 1],
    [18, 'textarea', 5, 32, 2],
    [22, 'textfield', 7, 64, 4],
  ]) {
    const { wii, nodes, messages } = bridge();
    nodes[name] = { value: 'Initial' };
    wii.formID = formId;
    const request = messages.find((message) => message.action === 'keyboard-request');
    assert.equal(request.nativeType, nativeType);
    assert.equal(request.maxLength, limit);
    assert.equal(request.rowLimit, rows);
    assert.equal(request.secret, formId === 17);
    assert.equal(request.text, [13, 18, 22].includes(formId) ? '' : 'Initial');
  }
});

test('sandboxed top-frame links relay navigation after original form state writes', async () => {
  const { wii, listeners, messages } = bridge();
  let prevented = false;
  listeners.click({
    target: {
      closest: () => ({
        getAttribute: (name) => (name === 'href' ? 'Parental_Control/Last_Check.html' : '_top'),
      }),
    },
    preventDefault: () => {
      prevented = true;
    },
  });
  wii.rate = 13;
  await Promise.resolve();
  assert.equal(prevented, true);
  const navigation = messages.find((message) => message.action === 'navigate');
  assert.equal(navigation.type, 'wii-settings-frame');
  assert.equal(navigation.state.rate, 13);
  assert.match(navigation.url, /Parental_Control\/Last_Check\.html$/);
});

test('parental restriction bit commands retain other choices and subpage progression', () => {
  const { wii } = bridge();
  wii.restrictions = 1;
  wii.restrictions = 2;
  assert.equal(wii.restrictions, 3);
  wii.restrictions = 0x81;
  assert.equal(wii.restrictions, 2);
  wii.subPageID = 3;
  assert.equal(wii.subPageID, 3);
  wii.rate = 13;
  wii.rateSave = 0;
  wii.rate = 17;
  wii.rate = 0x100;
  assert.equal(wii.rate, 13);
});

test('parental return fixes the original resource filename case inside the isolated engine', () => {
  const { window, listeners, wii } = bridge();
  let delegated = null;
  window.ParentalMiddleIndex_setLocation = (selection) => {
    delegated = selection;
  };
  listeners.DOMContentLoaded();
  window.ParentalMiddleIndex_setLocation(1);
  assert.equal(delegated, 1);
  window.ParentalMiddleIndex_setLocation(0);
  assert.equal(window.location.href, 'Re_Setting_index.html');
  assert.equal(wii.pageID, 13);
});
