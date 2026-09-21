/* Classic script: the original Opera pages construct these objects while
 * parsing. This bridge implements browser-local dummy state, never Wii IOS,
 * networking, firmware updates, formatting, or host settings. */
(function installSettingsBridge(window) {
  'use strict';
  const document = window.document;
  const now = new Date();
  const defaults = {
    version: 'Ver. 4.3U',
    nickname: 'Wii',
    language: 1,
    languageSave: 1,
    country: 49,
    countrySave: 49,
    year: now.getFullYear() - 2000,
    month: now.getMonth() + 1,
    date: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    soundId: 1,
    dis_pos: 16,
    dis_wide: 1,
    progressive: 1,
    pal: 0,
    dtv: 1,
    sensorBar: 0,
    screensaver: 1,
    LED: 1,
    light: 1,
    standby: 0,
    nwc24: 0,
    pare_flag: 0,
    restrictions: 0,
    restrictionsSave: 0,
    rate: 20,
    rateSave: 20,
    secQ: 0,
    secQSave: 0,
    secA: '',
    parentalPin: '',
    parentalPinDraft: '',
    master: '',
    directUrl: '',
    initFlag: 0,
    funcResult: 1,
    connectType: 0,
    connectType1: 0,
    connectType2: 0,
    connectType3: 0,
    profileID: 0,
    useID: 3,
    wifiType: 0,
    selectSecKey: 0,
    connectTest: 0,
    changeEnable: 1,
    networkBackup: '',
    networkProfiles: '',
    networkSavedProfiles: '',
    autoIP: 0,
    autoDNS: 0,
    autoProxy: 0,
    autoBasic: 0,
    ssID: '',
    securityKey: '',
    securityModeBackup: 0,
    ipAddr: '0.0.0.0',
    subnet: '0.0.0.0',
    gateway: '0.0.0.0',
    dns1: '0.0.0.0',
    dns2: '0.0.0.0',
    proxy: '',
    proxyPort: '',
    basicName: '',
    basicPass: '',
    macAddr: '00-00-00-00-00-00',
    lanMac: '00-00-00-00-00-00',
    macAvailable: 0,
    mtu: 0,
    tvrc: 0,
    tvrc_maker: 0,
    tvrc_type: 0,
    selectWire: 0,
    updateType: 0,
    pageID: 0,
    subPageID: 0,
    formID: 0,
  };
  let saved = {};
  try {
    const value = JSON.parse(window.name || '{}');
    if (value?.wiiMenuSettings === 1 && value.state && typeof value.state === 'object')
      saved = value.state;
  } catch {
    /* A normal iframe name is not settings state. */
  }
  const state = { ...defaults };
  for (const key of Object.keys(defaults))
    if (Object.hasOwn(saved, key) && ['string', 'number', 'boolean'].includes(typeof saved[key]))
      state[key] = saved[key];
  const send = (action, data = {}) =>
    window.parent.postMessage({ type: 'wii-settings', action, ...data }, '*');
  let homeKeys = ['Home', 'h'];
  let keyboardSequence = 0;
  let keyboardRequest = null;
  let validationSequence = 0;
  let validationRequest = null;
  const editedValues = new WeakMap();
  const persist = () => {
    saveCurrentProfile();
    window.name = JSON.stringify({ wiiMenuSettings: 1, state });
  };
  const patch = (values) => {
    for (const [key, value] of Object.entries(values || {}))
      if (Object.hasOwn(defaults, key) && ['string', 'number', 'boolean'].includes(typeof value))
        state[key] = value;
    persist();
  };
  const frameMessage = (action, data = {}) =>
    window.parent.postMessage({ type: 'wii-settings-frame', action, ...data }, '*');
  const networkFields = [
    'connectType',
    'connectTest',
    'wifiType',
    'selectSecKey',
    'autoIP',
    'autoDNS',
    'autoProxy',
    'autoBasic',
    'ssID',
    'securityKey',
    'ipAddr',
    'subnet',
    'gateway',
    'dns1',
    'dns2',
    'proxy',
    'proxyPort',
    'basicName',
    'basicPass',
    'mtu',
  ];
  const emptyProfile = () => Object.fromEntries(networkFields.map((key) => [key, defaults[key]]));
  function readProfiles(serialized) {
    const result = Array.from({ length: 3 }, emptyProfile);
    try {
      const data = JSON.parse(serialized);
      if (data?.version !== 1 || !Array.isArray(data.profiles)) return result;
      for (let index = 0; index < 3; index++) {
        for (const key of networkFields) {
          const value = data.profiles[index]?.[key];
          if (typeof value === typeof defaults[key]) result[index][key] = value;
        }
      }
    } catch {
      // A missing or older local state starts with three empty profiles.
    }
    return result;
  }
  const serializeProfiles = () => JSON.stringify({ version: 1, profiles });
  let profiles = readProfiles(state.networkProfiles);
  state.profileID = Math.min(2, Math.max(0, Math.trunc(Number(state.profileID) || 0)));
  if (state.networkProfiles) Object.assign(state, profiles[state.profileID]);
  else
    profiles[state.profileID] = Object.fromEntries(networkFields.map((key) => [key, state[key]]));
  function saveCurrentProfile() {
    profiles[state.profileID] = Object.fromEntries(networkFields.map((key) => [key, state[key]]));
    state.networkProfiles = serializeProfiles();
    for (let index = 0; index < 3; index++)
      state[`connectType${index + 1}`] = profileType(profiles[index]);
  }
  function profileType(profile) {
    if (profile.connectType === 1) return 1;
    if (!profile.ssID && !profile.selectSecKey && !profile.wifiType) return 0;
    return profile.wifiType ? profile.wifiType + 2 : 2;
  }
  function selectProfile(index) {
    if (!Number.isInteger(index) || index < 0 || index > 2) return;
    saveCurrentProfile();
    state.profileID = index;
    Object.assign(state, profiles[index]);
    state.securityModeBackup = state.selectSecKey;
  }
  function clearProfile({ wired = false, wifiType = null } = {}) {
    Object.assign(state, emptyProfile(), {
      connectType: wired ? 1 : 0,
      wifiType: wifiType ?? 0,
      autoIP: Number(wired || wifiType !== null),
      autoDNS: Number(wired || wifiType !== null),
    });
  }
  function commitNetwork() {
    // 0x813FA1BC/0x813FB274 normalize automatic address fields before saving.
    if (state.autoIP) {
      state.ipAddr = '0.0.0.0';
      state.subnet = '0.0.0.0';
      state.gateway = '0.0.0.0';
    }
    if (state.autoIP && state.autoDNS) state.dns1 = state.dns2 = '0.0.0.0';
    else if (state.dns1 === '0.0.0.0' && state.dns2 === '0.0.0.0') state.autoDNS = 1;
    if (state.connectType === 1) {
      state.ssID = '';
      state.securityKey = '';
      state.selectSecKey = 0;
      state.wifiType = 0;
    }
    saveCurrentProfile();
    state.networkSavedProfiles = state.networkProfiles;
  }
  function backupNetwork() {
    // Native NCD backup/reset (0x813FB300/0x813FB318) copy the local config
    // buffer in opposite directions. This copies only our dummy NCD fields.
    saveCurrentProfile();
    state.networkBackup = JSON.stringify({ version: 1, profiles, useID: state.useID });
    persist();
    return 0;
  }
  function resetNetwork() {
    try {
      const backup = JSON.parse(state.networkBackup);
      if (backup?.version !== 1 || !Array.isArray(backup.profiles)) return 0;
      profiles = readProfiles(state.networkBackup);
      Object.assign(state, profiles[state.profileID]);
      state.securityModeBackup = state.selectSecKey;
      if (Number.isInteger(backup.useID) && backup.useID >= 0 && backup.useID <= 3)
        state.useID = backup.useID;
      persist();
    } catch {
      // No edit backup has been created in this Settings session.
    }
    return 0;
  }
  const childFrames = () => [...document.querySelectorAll('frame,iframe')];
  const navigate = (href) => {
    const target = new URL(href, window.location.href),
      base = new URL(window.location.href);
    if (target.origin === base.origin && target.pathname.startsWith('/assets/settings/')) {
      frameMessage('navigate', { url: target.href, state: { ...state } });
    }
  };
  const localForm = () => {
    const nickname = document.getElementById('Name');
    if (nickname) state.nickname = String(nickname.value).slice(0, 10);
    persist();
  };
  // 4.3U initKeyboard jump table 0x81657290 and its original HTML fields.
  // Each binding is [field name, local value, native type, character limit, rows].
  const formBindings = {
    1: ['Name', 'nickname', 6, 10, 1],
    2: ['textfield', 'securityKey', 7, 64, 4],
    3: ['textfield', 'ssID', 7, 32, 2],
    4: ['textfield22', 'ipAddr', 10, 15, 1],
    5: ['textfield2', 'subnet', 10, 15, 1],
    6: ['textfield3', 'gateway', 10, 15, 1],
    7: ['textfield', 'dns1', 10, 15, 1],
    8: ['textfield2', 'dns2', 10, 15, 1],
    10: ['textfield', 'proxy', 7, 255, 16],
    11: ['textfield22', 'proxyPort', 3, 5, 1],
    12: ['textfield', 'basicName', 7, 32, 2],
    13: ['password', 'basicPass', 7, 32, 2],
    14: ['textfield2', 'mtu', 3, 4, 1],
    15: ['textfield2', 'parentalPinDraft', 3, 4, 1],
    16: ['textfield2', 'parentalPin', 3, 4, 1],
    17: ['textfield2', 'parentalPin', 3, 4, 1],
    18: ['textarea', 'secA', 5, 32, 2],
    19: ['textarea', 'secA', 5, 32, 2],
    20: ['textfield2', 'master', 3, 5, 1],
    22: ['textfield', 'securityKey', 7, 64, 4],
  };
  const formInput = (formId) => {
    const name = formBindings[formId]?.[0];
    return name && (document.getElementById(name) || document.getElementsByName(name)[0]);
  };
  function requestKeyboard(formId) {
    const binding = formBindings[formId];
    const input = formInput(formId);
    if (!binding || !input || keyboardRequest) return;
    let [, , nativeType, maxLength, rowLimit] = binding;
    if (formId === 2 && Number(state.selectSecKey) === 1) {
      maxLength = 26;
      rowLimit = 2;
    }
    if ((formId === 18 || formId === 19) && [6, 11].includes(Number(state.language)))
      nativeType = 13;
    keyboardRequest = { requestId: ++keyboardSequence, input, maxLength, formId };
    // Native initKeyboard deliberately starts these sensitive fields empty.
    const blank = [2, 13, 18, 19, 22].includes(formId);
    send('keyboard-request', {
      requestId: keyboardRequest.requestId,
      formId,
      // Valid inputs use an empty native header. Error-specific prompts are separate.
      title: '',
      profile: formId === 1 ? 'console-nickname' : 'settings-form',
      nativeType,
      text: blank ? '' : String(input.value),
      maxLength,
      rowLimit,
      secret: formId === 17,
      multiline: false,
      predictionAllowed: nativeType === 13,
      languageSelectionAllowed: nativeType === 13,
      layoutSelectionAllowed: [5, 6, 13].includes(nativeType),
      symbolsAllowed: nativeType === 5 || nativeType === 13,
    });
  }
  const maskSecurityKey = (value) => {
    const mask = '*'.repeat(value.length);
    return mask.length > 32 ? `${mask.slice(0, 32)}\n${mask.slice(32)}` : mask;
  };
  function formValue(formId) {
    const input = formInput(formId);
    if (!input) return null;
    if (editedValues.has(input)) return editedValues.get(input);
    const value = String(input.value);
    if ([2, 22].includes(formId) && value === maskSecurityKey(state.securityKey))
      return state.securityKey;
    return value;
  }
  function validationFailure(messageId, operation) {
    state.funcResult = 4;
    validationRequest = { requestId: ++validationSequence, messageId, operation };
    persist();
    send('validation-request', validationRequest);
  }
  function validationMessage(operation) {
    // Verified Settings::checkTextNum / NCD validators; native failures use
    // the original buttonless message for 180 normal-state updates.
    const value = (formId) => formValue(formId) ?? '';
    const hasText = (text) => /[^ \u3000]/u.test(text);
    if (operation === 2) {
      if (!value(1).length) return 0x1c0;
      if (!hasText(value(1))) return 0x1c1;
    } else if ([10, 11, 12].includes(operation)) {
      if (value(operation + 5).length !== 4) return 0x1ba;
    } else if (operation === 13 || operation === 14) {
      const minimum = state.language === 6 ? 2 : [0, 11].includes(state.language) ? 3 : 6;
      if (value(operation + 5).length < minimum) return 0x1bb;
      if (!hasText(value(operation + 5))) return 0x1c1;
    } else if (operation === 15) {
      if (value(20).length !== 5) return 0x1bc;
    } else if (operation === 3) {
      const key = value(2);
      if (key.length) {
        const hex = /^[\da-f]+$/i.test(key);
        const valid =
          state.selectSecKey <= 1
            ? [5, 13].includes(key.length) || ([10, 26].includes(key.length) && hex)
            : (key.length >= 8 && key.length <= 63) || (key.length === 64 && hex);
        if (!valid) return 0x1be;
      }
    } else if (operation === 7) {
      const host = value(10);
      const port = (Number.parseInt(value(11), 10) || 0) & 0xffff;
      if (
        !port ||
        host.length > 255 ||
        host.startsWith('.') ||
        host.includes('..') ||
        /[^a-z\d_.-]/i.test(host)
      )
        return 0x1be;
    } else if (operation === 8) {
      if ([value(12), value(13)].some((text) => text.length > 32 || /[^\x20-\x7e]/.test(text)))
        return 0x1be;
    }
    return null;
  }
  function normalizeAddress(value) {
    // 0x813F5E1C clamps each parsed octet to 255 and right-aligns components
    // after the first: e.g. 192.1 becomes 192.0.0.1.
    const parts = String(value)
      .split('.')
      .slice(0, 4)
      .map((part) => Math.min(255, (Number.parseInt(part, 10) || 0) >>> 0));
    return [parts[0], ...Array(4 - parts.length).fill(0), ...parts.slice(1)].join('.');
  }
  function commitStrings(operation) {
    if (validationRequest) return;
    const messageId = validationMessage(operation);
    if (messageId !== null) {
      validationFailure(messageId, operation);
      return;
    }
    const groups = {
      2: [1],
      3: [2],
      4: [3],
      5: [4, 5, 6],
      6: [7, 8],
      7: [10, 11],
      8: [12, 13],
      9: [14],
      10: [15],
      13: [18],
    };
    if (operation === 11 || operation === 12) {
      const value = formValue(operation === 11 ? 16 : 17) || '';
      const expected = operation === 11 ? state.parentalPinDraft : state.parentalPin;
      state.funcResult = value.length === 4 && value === expected ? 1 : 2;
      if (operation === 11 && state.funcResult === 1) state.parentalPin = value;
    } else if (operation === 14) {
      state.funcResult = formValue(19) === state.secA ? 1 : 2;
    } else if (operation === 15) {
      state.funcResult = 2;
      send('dummy', { operation: 'master-key' });
    } else {
      for (const formId of groups[operation] || []) {
        const value = formValue(formId);
        if (value !== null)
          state[formBindings[formId][1]] = value.slice(0, formBindings[formId][3]);
      }
      if (operation === 5 || operation === 6)
        for (const formId of groups[operation]) {
          const key = formBindings[formId][1];
          state[key] = normalizeAddress(state[key]);
        }
      if (operation === 7)
        state.proxyPort = String((Number.parseInt(state.proxyPort, 10) || 0) & 0xffff);
      if (operation === 9) {
        const mtu = (Number.parseInt(state.mtu, 10) || 0) & 0xffff;
        state.mtu = mtu >= 576 && mtu <= 1500 ? mtu : 0;
      }
      state.funcResult = 3;
    }
    persist();
    send('changed', { state: { ...state } });
  }
  function completeKeyboard(data) {
    if (!keyboardRequest || data.requestId !== keyboardRequest.requestId) return;
    const { input, maxLength, formId } = keyboardRequest;
    keyboardRequest = null;
    state.formID = 0;
    if (data.accepted === true && typeof data.text === 'string') {
      const value = data.text.replace(/[\r\n]/g, '').slice(0, maxLength);
      editedValues.set(input, value);
      input.value = [2, 22].includes(formId) ? maskSecurityKey(value) : value;
      // Keyboard OK updates the HTML field. The original Confirm button still
      // owns setstring and committing edits to browser-local state.
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    persist();
  }
  const functions = new Set([21, 23, 25, 26, 29, 51, 77, 81, 82, 91, 93, 94, 95]);
  function nativeFunction(value) {
    if (value === 10 || value === 16) {
      clearProfile();
      if (value === 10) {
        saveCurrentProfile();
        state.networkSavedProfiles = state.networkProfiles;
      }
      return;
    }
    if (value === 20) {
      commitNetwork();
      return;
    }
    if (value === 25) {
      // Native function25 reloads the committed parental restriction byte.
      state.restrictions = state.restrictionsSave;
      return;
    }
    if (value === 21) state.restrictionsSave = state.restrictions;
    if (value === 22) {
      for (const key of [
        'pare_flag',
        'restrictions',
        'restrictionsSave',
        'rate',
        'rateSave',
        'parentalPin',
        'parentalPinDraft',
        'secQ',
        'secQSave',
        'secA',
      ])
        state[key] = defaults[key];
      return;
    }
    // Parent-control checks permit viewing pages in this unprotected dummy
    // console. Native network/format operations report no successful operation.
    state.funcResult = value === 78 ? 6 : functions.has(value) ? 1 : 2;
    // These original waiting pages recognize 10 as a finished unavailable
    // operation and return to their menu. Returning generic failure 2 caused
    // their native-error-dialog polling branch to repeat forever.
    if ([32, 34, 40, 41, 42, 44].includes(value)) state.funcResult = 10;
    if (!functions.has(value) && value !== 78) send('dummy', { operation: 'function', value });
  }
  function writeBack() {
    localForm();
    state.languageSave = state.language;
    state.countrySave = state.country;
    state.rateSave = state.rate;
    state.secQSave = state.secQ;
    state.restrictionsSave = state.restrictions;
    persist();
    send('changed', { state: { ...state } });
  }
  window.wiiSetting = function WiiSetting() {
    return new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'WriteBack') return writeBack;
          if (key === 'backupNCD') return backupNetwork();
          if (key === 'resetNCD') return resetNetwork();
          if (key === 'connectType') return profileType(state);
          // Native getUseProfileID requires both the active and tested flags.
          // Selecting a dummy profile must not imply a successful connection.
          if (key === 'useID')
            return profiles[state.useID]?.connectTest && profiles.some(profileType)
              ? state.useID
              : 3;
          if (key === 'changeEnable') return Number(![1, 2].includes(state.wifiType));
          if (key === 'autoDNS' && !state.autoIP) {
            state.autoDNS = 0;
            persist();
            return 0;
          }
          if (key === 'securityKey')
            return state.securityModeBackup === state.selectSecKey
              ? maskSecurityKey(state.securityKey)
              : '';
          if (key === 'dummySec') return maskSecurityKey(state.securityKey);
          if (key === Symbol.toStringTag) return 'WiiSetting';
          return state[key] ?? 0;
        },
        set(_target, key, value) {
          if (typeof key !== 'string' || !['string', 'number', 'boolean'].includes(typeof value))
            return true;
          if (key === 'se' || key === 'excse') {
            send('sound', { value: Number(value), channel: key, pageId: Number(state.pageID) });
          } else if (key === 'finish' && value) send('exit');
          else if (key === 'funcID') nativeFunction(Number(value));
          else if (key === 'setstring') {
            commitStrings(Number(value));
          } else if (key === 'flush') writeBack();
          else if (key === 'changeConnectType') state.connectType = Number(value) === 1 ? 1 : 0;
          else if (key === 'backSecKey') state.selectSecKey = state.securityModeBackup;
          else if (Object.hasOwn(defaults, key)) {
            // The native setter treats restrictions as set/clear commands,
            // not replacement bytes (4.3U Setter_ at 0x813705B4).
            if (key === 'profileID') selectProfile(Number(value));
            else if (key === 'selectWire') clearProfile({ wired: true });
            else if (key === 'wifiType') {
              clearProfile({ wifiType: Number(value) });
              if (Number(value) === 0) backupNetwork();
            } else if (key === 'selectSecKey') {
              state.securityModeBackup = state.selectSecKey;
              state.selectSecKey = Number(value);
            } else if (key === 'useID') state.useID = state.profileID;
            else if (key === 'restrictions') {
              const mask = Number(value) & 0x7f;
              state.restrictions =
                Number(value) & 0x80 ? state.restrictions & ~mask : state.restrictions | mask;
            } else if (key === 'rate' && Number(value) & 0x100) state.rate = state.rateSave;
            else if (key === 'rateSave') state.rateSave = state.rate;
            else if (key === 'secQSave') state.secQSave = state.secQ;
            else if (key === 'countrySave') state.country = state.countrySave;
            else state[key] = value;
            if (key === 'formID') requestKeyboard(Number(value));
            frameMessage('patch', {
              state: key === 'countrySave' ? { country: state.country } : { [key]: state[key] },
            });
            // www::wiisetting::Setter_ queues the output-mode preview cue.
            if (key === 'soundId') {
              send('sound', {
                value: Number(value) + 10,
                channel: 'se',
                pageId: Number(state.pageID),
              });
            }
          }
          persist();
          return true;
        },
      },
    );
  };
  window.wiiTrasition = function WiiTrasition() {
    this.LeftScroll = () => send('transition', { direction: -1 });
    this.RightScroll = () => send('transition', { direction: 1 });
  };

  // Opera supported both document.all.Name and document.all('Name'). Its
  // falsy modern-browser replacement breaks the original display-position UI.
  const lookup = (name) =>
    typeof name === 'number'
      ? document.querySelectorAll('*')[name]
      : document.getElementById(String(name)) || document.getElementsByName(String(name))[0];
  const all = new Proxy(lookup, {
    get(target, key) {
      if (key === 'item' || key === 'namedItem') return lookup;
      if (key === 'length') return document.querySelectorAll('*').length;
      return typeof key === 'string'
        ? (lookup(key) ?? Reflect.get(target, key))
        : Reflect.get(target, key);
    },
  });
  try {
    Object.defineProperty(document, 'all', { configurable: true, get: () => all });
  } catch {
    /* Native compatibility collection remains available. */
  }

  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = '/assets/fonts/outline-fonts.css';
  window.WiiSettingsFontsReady = new Promise((resolve, reject) => {
    font.onerror = () => reject(new Error('The original Settings font stylesheet could not load.'));
    font.onload = async () => {
      try {
        // FontFaceSet.ready resolves even when a face failed. Requiring the
        // original physical faces avoids caching a successful-looking fallback
        // raster after an interrupted preparation or a cold resource failure.
        for (const family of ['Wii NTLG Gothic', 'Wii NTLG PGothic']) {
          const faces = await document.fonts.load(`16px "${family}"`, 'Wii');
          if (!faces.length || faces.some((face) => face.status !== 'loaded')) {
            throw new Error('An original Settings font could not load. Prepare the assets again.');
          }
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    };
  });
  // The raster bridge is a separate script and may attach its await later.
  // Keep early load failures handled here without changing the promise outcome.
  void window.WiiSettingsFontsReady.catch(() => {});
  document.head.appendChild(font);
  // Original pages are authored at 608×456. The host captures this fixed raster
  // and centers it between the native side textures on a widescreen display.
  const style = document.createElement('style');
  style.textContent =
    'html,body{overflow:hidden}body{font-family:"Wii NTLG PGothic Latin Regular",sans-serif}' +
    (window.parent !== window ? '*{cursor:none!important}' : '');
  document.head.appendChild(style);
  const rasterBridge = document.createElement('script');
  rasterBridge.src = '/src/settings-raster-bridge.js';
  document.head.appendChild(rasterBridge);
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented) return;
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href) return;
      if (/^javascript:/i.test(href)) {
        // Chromium's opaque sandbox runs onclick but skips javascript: URL
        // activation. The original archive uses these three call signatures;
        // run their existing functions after onclick without evaluating code
        // or granting the Settings engine same-origin access.
        const expression = href.replace(/^javascript:/i, '').trim();
        const plain = /^(jump_ONOFF_set|jumpPare_index02)\(\s*\)$/.exec(expression);
        const slot = /^jump_Connect_set_top\(\s*([012])\s*\)$/.exec(expression);
        const name = plain?.[1] ?? (slot ? 'jump_Connect_set_top' : null);
        if (name && typeof window[name] === 'function') {
          event.preventDefault();
          window[name](...(slot ? [Number(slot[1])] : []));
        } else if (/^void\(\s*0\s*\)$/.test(expression)) event.preventDefault();
        return;
      }
      const target = new URL(href, window.location.href),
        base = new URL(window.location.href);
      // '#' is an in-page choice in the original Display/Sound forms. It does
      // not produce a new document, so it cannot acquire the navigation lock.
      if (target.pathname === base.pathname && target.search === base.search) {
        event.preventDefault();
        return;
      }
      if (target.origin !== base.origin || !target.pathname.startsWith('/assets/settings/')) {
        event.preventDefault();
        send('dummy', { operation: 'external-navigation' });
      } else {
        if (['_top', '_parent'].includes(link.getAttribute('target'))) {
          event.preventDefault();
          // Preserve the original onclick's state writes before relaying a
          // frame exit. Sandboxed children cannot navigate browser top-level.
          Promise.resolve().then(() => navigate(target.href));
          return;
        }
        persist();
        send('navigation', { path: target.pathname });
      }
    },
    false,
  );
  document.addEventListener('submit', (event) => {
    event.preventDefault();
    localForm();
  });
  document.addEventListener('pointermove', (event) =>
    send('pointer', { x: event.clientX, y: event.clientY, visible: true }),
  );
  document.addEventListener('pointerleave', () => send('pointer', { visible: false }));
  document.addEventListener('pointerdown', () => send('gesture'), true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      send('exit');
    } else if (
      homeKeys.some((key) => key.toLowerCase() === event.key?.toLowerCase()) &&
      !/^(INPUT|TEXTAREA)$/.test(event.target?.tagName)
    ) {
      event.preventDefault();
      send('home');
    }
  });
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source === window.parent) {
      if (data?.type === 'wii-settings-configure') {
        if (typeof data.wide === 'boolean') {
          state.dis_wide = Number(data.wide);
          persist();
        }
        if (Array.isArray(data.homeKeys) && data.homeKeys.every((key) => typeof key === 'string'))
          homeKeys = data.homeKeys;
        for (const frame of childFrames()) frame.contentWindow.postMessage(data, '*');
      } else if (data?.type === 'wii-settings-keyboard-complete') {
        completeKeyboard(data);
      } else if (
        data?.type === 'wii-settings-validation-complete' &&
        data.requestId === validationRequest?.requestId
      ) {
        validationRequest = null;
      } else if (data?.type === 'wii-settings-frame' && data.action === 'state') {
        patch(data.state);
        // Country lists draw their initial selection synchronously, before the
        // opaque child can receive the frameset's current local state.
        if (typeof window.baseOffset === 'number') {
          const count = [...document.querySelectorAll('[id^="List"][id$="Check"]')].length;
          for (let index = 0; index < count; index++) {
            const pane = document.getElementById(`List${String(index + 1).padStart(2, '0')}Check`);
            if (pane)
              pane.style.visibility =
                state.country - window.baseOffset === index ? 'visible' : 'hidden';
          }
        }
      }
      return;
    }
    const child = childFrames().find((frame) => frame.contentWindow === event.source);
    if (!child) return;
    if (data?.type === 'wii-settings-frame') {
      patch(data.state);
      if (data.action === 'navigate') {
        const target = new URL(data.url, window.location.href),
          base = new URL(window.location.href);
        if (target.origin === base.origin && target.pathname.startsWith('/assets/settings/'))
          window.location.href = target.href;
      } else if (data.action === 'patch' || data.action === 'ready') {
        for (const frame of childFrames())
          frame.contentWindow.postMessage(
            { type: 'wii-settings-frame', action: 'state', state: { ...state } },
            '*',
          );
      }
    } else if (
      data?.type === 'wii-settings' &&
      ['sound', 'exit', 'home', 'gesture', 'pointer', 'dummy', 'changed'].includes(data.action)
    ) {
      const relayed = { ...data };
      if (data.action === 'pointer' && Number.isFinite(data.x) && Number.isFinite(data.y)) {
        const bounds = child.getBoundingClientRect();
        relayed.x += bounds.left;
        relayed.y += bounds.top;
      }
      window.parent.postMessage(relayed, '*');
    }
  });
  window.addEventListener('DOMContentLoaded', () => {
    if (typeof window.ParentalMiddleIndex_setLocation === 'function') {
      const original = window.ParentalMiddleIndex_setLocation;
      window.ParentalMiddleIndex_setLocation = (selection) => {
        if (selection !== 0) return original(selection);
        // The original script spells this filename Re_setting_index.html,
        // while the archive contains Re_Setting_index.html.
        const wii = new window.wiiSetting();
        wii.rate = 0x100;
        wii.rateSave = 0;
        wii.pageID = 13;
        wii.se = 3;
        window.location.href = 'Re_Setting_index.html';
      };
    }
    if (/\/Country\/US_Country_flame_D\.html$/i.test(window.location.pathname)) {
      // The original Opera app was top-level. Its country footer's top.location
      // assignments must stay inside the sandboxed settings frameset here.
      window.setSE = () => {
        state.country = state.countrySave;
        persist();
        send('sound', { value: 4 });
        navigate(state.initFlag === 0 ? '../index03.html' : '../Setup/Nickname_set.html');
      };
      window.setCountry = () => {
        writeBack();
        send('sound', { value: 3 });
        if (state.initFlag === 0) navigate('../index03.html');
        else if (state.updateType === 0)
          navigate('../Parental_Control/Parental_Control_index.html');
        else navigate('../Setup/ScreenSave.html');
      };
    }
    frameMessage('ready');
    send('ready', { path: window.location.pathname, state: { ...state } });
  });
  window.addEventListener('error', (event) => {
    send('error', { message: event.message, path: window.location.pathname });
  });
  // Exposed only inside the isolated iframe for deterministic bridge tests.
  window.WiiSettingsBridge = Object.freeze({ snapshot: () => ({ ...state }) });
})(window);
