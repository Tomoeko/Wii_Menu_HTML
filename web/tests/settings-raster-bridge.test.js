import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/settings-raster-bridge.js', import.meta.url), 'utf8');

test('offscreen document readiness and mutation coalescing do not depend on throttled timers', async () => {
  const messages = [];
  const tasks = [];
  const documentEvents = {};
  const windowEvents = {};
  let mutation;
  let markup = '<div>page</div>';
  let finishFontLoad;
  const fontsReady = new Promise((resolve) => { finishFontLoad = resolve; });
  const node = () => ({
    nodeType: 1,
    tagName: 'BODY',
    attributes: [],
    childNodes: [],
    style: {},
    setAttribute() {},
    appendChild() {},
  });
  const document = {
    readyState: 'loading',
    fonts: { ready: Promise.resolve() },
    body: node(),
    querySelectorAll: () => [],
    createElementNS: node,
    addEventListener: (name, callback) => {
      documentEvents[name] = callback;
    },
  };
  const unavailableTimer = () => {
    throw new Error('Hidden-frame timers must not be required');
  };
  const window = {
    document,
    WiiSettingsFontsReady: fontsReady,
    parent: { postMessage: (message) => messages.push(message) },
    location: { pathname: '/assets/settings/index01.html' },
    innerWidth: 608,
    innerHeight: 456,
    getComputedStyle: () => [],
    setTimeout: unavailableTimer,
    setInterval: unavailableTimer,
    addEventListener: (name, callback) => {
      windowEvents[name] = callback;
    },
    MessageChannel: class {
      constructor() {
        this.port1 = {};
        this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) };
      }
    },
  };
  vm.runInNewContext(source, {
    window,
    MutationObserver: class {
      constructor(callback) {
        mutation = callback;
      }
      observe() {}
    },
    XMLSerializer: class {
      serializeToString() {
        return markup;
      }
    },
  });
  const flushTasks = async () => {
    while (tasks.length) tasks.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  };
  windowEvents.message({ source: window.parent, data: { type: 'wii-settings-raster-configure' } });
  await flushTasks();
  assert.equal(messages.filter((item) => item.action === 'snapshot').length, 0);
  document.readyState = 'complete';
  documentEvents.readystatechange();
  windowEvents.load();
  assert.equal(tasks.length, 1);
  await flushTasks();
  assert.equal(messages.filter((item) => item.action === 'snapshot').length, 0);
  finishFontLoad();
  await flushTasks();
  assert.equal(messages.filter((item) => item.action === 'snapshot').length, 1);
  markup = '<div>changed</div>';
  for (let i = 0; i < 240; i++) mutation([{ type: 'characterData' }]);
  assert.equal(tasks.length, 1);
  await flushTasks();
  const snapshots = messages.filter((item) => item.action === 'snapshot');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.at(-1).markup, markup);
});

test('snapshot keeps hidden layout without fetching its absent artwork or hiding visible children', async () => {
  const messages = [];
  const events = {};
  const tasks = [];
  const node = (tagName, css = {}, childNodes = []) => ({
    nodeType: 1,
    tagName,
    css,
    childNodes,
    attributes: [],
    style: {},
    setAttribute(name, value) {
      this.attributes.push({ name, value });
    },
    appendChild(child) {
      this.childNodes.push(child);
    },
  });
  const hiddenIcon = node(
    'DIV',
    {
      display: 'block',
      visibility: 'hidden',
      width: '136px',
      'background-image': 'url("/missing-optional-icon.png")',
    },
    [node('IMG', { display: 'block', visibility: 'visible' })],
  );
  hiddenIcon.childNodes[0].src = '/visible-child.png';
  const hiddenImage = node('IMG', { display: 'block', visibility: 'hidden' });
  hiddenImage.src = '/missing-hidden-image.png';
  const absentPanel = node('DIV', {
    display: 'none',
    visibility: 'visible',
    'background-image': 'url("/unused-panel.png")',
  });
  const document = {
    body: node('BODY', { display: 'block', visibility: 'visible' }, [
      hiddenIcon,
      hiddenImage,
      absentPanel,
    ]),
    readyState: 'complete',
    fonts: { ready: Promise.resolve() },
    querySelectorAll: () => [],
    createElementNS: (_namespace, tagName) => node(tagName),
    addEventListener() {},
  };
  const window = {
    document,
    parent: { postMessage: (message) => messages.push(message) },
    location: { pathname: '/assets/settings/Internet/Connect_set_top.html' },
    innerWidth: 608,
    innerHeight: 456,
    getComputedStyle(element) {
      const properties = Object.keys(element.css);
      return Object.assign(properties, element.css, {
        getPropertyValue: (name) => element.css[name],
      });
    },
    addEventListener: (type, listener) => {
      events[type] = listener;
    },
    MessageChannel: class {
      constructor() {
        this.port1 = {};
        this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) };
      }
    },
  };
  vm.runInNewContext(source, {
    window,
    MutationObserver: class {
      observe() {}
    },
    XMLSerializer: class {
      serializeToString(value) {
        return JSON.stringify(value);
      }
    },
  });
  events.message({ source: window.parent, data: { type: 'wii-settings-raster-configure' } });
  tasks.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = messages.find((message) => message.action === 'snapshot');
  assert.ok(snapshot);
  assert.doesNotMatch(snapshot.markup, /missing-|unused-panel/);
  assert.match(snapshot.markup, /width:136px/);
  assert.match(snapshot.markup, /visibility:hidden/);
  assert.match(snapshot.markup, /visible-child\.png/);
  assert.equal(JSON.parse(snapshot.markup).childNodes.length, 2);
});

test('frame rollovers retain child state and font-load errors reach the host without stale composites', async () => {
  const messages = [];
  const events = {};
  const tasks = [];
  const children = [0, 1].map((index) => ({
    nodeType: 1,
    tagName: 'FRAME',
    attributes: [],
    childNodes: [],
    sent: [],
    getBoundingClientRect: () => ({ left: 0, top: index * 100, width: 608, height: 100 }),
  }));
  for (const child of children) child.contentWindow = {
    postMessage: (message) => child.sent.push(message),
  };
  const node = (tagName = 'div') => ({
    nodeType: 1,
    tagName,
    attributes: [],
    childNodes: [],
    style: {},
    setAttribute() {},
    appendChild(child) { this.childNodes.push(child); },
    querySelectorAll: () => [],
  });
  const body = node('FRAMESET');
  body.childNodes = children;
  const document = {
    body,
    readyState: 'complete',
    fonts: { ready: Promise.resolve() },
    querySelectorAll: (selector) => selector === 'frame,iframe' ? children : [],
    createElement: node,
    createElementNS: (_namespace, tagName) => node(tagName),
    addEventListener() {},
  };
  const window = {
    document,
    parent: { postMessage: (message) => messages.push(message) },
    location: { pathname: '/assets/settings/Country/frame.html' },
    innerWidth: 608,
    innerHeight: 456,
    getComputedStyle: () => [],
    addEventListener: (type, listener) => { events[type] = listener; },
    MessageChannel: class {
      constructor() {
        this.port1 = {};
        this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) };
      }
    },
  };
  vm.runInNewContext(source, {
    window,
    MutationObserver: class { observe() {} },
    XMLSerializer: class {
      serializeToString(value) { return JSON.stringify(value); }
    },
  });
  const flush = async () => {
    while (tasks.length) tasks.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  };
  const receive = (source, data) => events.message({ source, data });
  receive(window.parent, { type: 'wii-settings-raster-configure' });
  for (const child of children) receive(child.contentWindow, {
    type: 'wii-settings-raster',
    action: 'snapshot',
    sequence: 1,
    markup: '<div>Child image</div>',
    images: [{ id: 'same-id', src: '/off.png', alternates: ['/on.png'], x: 10, y: 20, width: 40, height: 30 }],
  });
  await flush();
  const snapshot = messages.find((message) => message.action === 'snapshot');
  assert.equal(snapshot.images[0].id, 'frame-0:same-id');
  assert.equal(snapshot.images[1].id, 'frame-1:same-id');
  assert.equal(snapshot.images[1].y, 120);
  receive(window.parent, {
    type: 'wii-settings-raster-fast-images',
    sequence: snapshot.sequence,
    ids: snapshot.images.map((image) => image.id),
  });
  for (const child of children) assert.equal(child.sent.at(-1).ids[0], 'same-id');
  receive(children[1].contentWindow, {
    type: 'wii-settings-raster',
    action: 'image-patch',
    baseSequence: 1,
    images: [{ id: 'same-id', src: '/on.png' }],
  });
  await flush();
  assert.equal(messages.filter((message) => message.action === 'snapshot').length, 1);
  const patch = messages.at(-1);
  assert.equal(patch.action, 'image-patch');
  assert.equal(patch.baseSequence, snapshot.sequence);
  assert.equal(patch.images[0].src, '/off.png');
  assert.equal(patch.images[1].src, '/on.png');
  const count = messages.length;
  receive(children[1].contentWindow, {
    type: 'wii-settings-raster', action: 'image-patch', baseSequence: 0, images: [],
  });
  await flush();
  assert.equal(messages.length, count, 'stale child patches must not reach the host');

  const snapshotsBeforeError = messages.filter((message) => message.action === 'snapshot').length;
  const fontError = 'An original Settings font could not load. Prepare the assets again.';
  receive({}, { type: 'wii-settings-raster', action: 'error', message: fontError });
  assert.equal(messages.length, count, 'unrelated windows cannot report a frame failure');
  receive(children[1].contentWindow, {
    type: 'wii-settings-raster', action: 'error', message: fontError,
  });
  await flush();
  assert.equal(messages.at(-1).action, 'error');
  assert.equal(messages.at(-1).message, fontError);
  receive(children[0].contentWindow, {
    type: 'wii-settings-raster', action: 'snapshot', sequence: 2,
    markup: '<div>Updated first child</div>', images: [],
  });
  await flush();
  assert.equal(messages.filter((message) => message.action === 'snapshot').length,
    snapshotsBeforeError, 'failed child pixels cannot join a new sibling raster');
  receive(children[1].contentWindow, { type: 'wii-settings-raster', action: 'ready' });
  receive(children[1].contentWindow, {
    type: 'wii-settings-raster', action: 'snapshot', sequence: 2,
    markup: '<div>Reloaded child with original fonts</div>', images: [],
  });
  await flush();
  assert.equal(messages.filter((message) => message.action === 'snapshot').length,
    snapshotsBeforeError + 1);
  assert.match(messages.at(-1).markup, /Reloaded child with original fonts/);
});

test('nickname pointer selection reports a static glyph boundary before opening the keyboard', () => {
  const events = {};
  const actions = [];
  const input = {
    tagName: 'INPUT',
    id: 'Name',
    value: 'Wii',
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 100, right: 300, top: 200, width: 200, height: 44 }),
    dispatchEvent() {},
    click: () => actions.push({ action: 'keyboard-request' }),
  };
  const widths = { '': 0, W: 30, Wi: 38, Wii: 46 };
  const style = {
    fontStyle: 'normal',
    fontWeight: '700',
    fontSize: '36px',
    fontFamily: 'Wii NTLG PGothic Latin',
    textAlign: 'center',
    borderLeftWidth: '2px',
    borderRightWidth: '2px',
    paddingLeft: '2px',
    paddingRight: '2px',
  };
  const document = {
    querySelectorAll: () => [],
    elementFromPoint: () => input,
    createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: widths[text] }) }) }),
    addEventListener() {},
  };
  const window = {
    document,
    parent: { postMessage: (message) => actions.push(message) },
    getComputedStyle: () => style,
    addEventListener: (type, callback) => { events[type] = callback; },
    MessageChannel: class {
      constructor() {
        this.port1 = {};
        this.port2 = { postMessage() {} };
      }
    },
  };
  vm.runInNewContext(source, {
    window,
    MouseEvent: class {},
    MutationObserver: class { observe() {} },
  });
  const click = (x) => events.message({
    source: window.parent,
    data: { type: 'wii-settings-raster-input', action: 'activate', x, y: 220 },
  });
  click(205);
  const marker = actions.find((message) => message.action === 'input-marker');
  assert.deepEqual(JSON.parse(JSON.stringify(marker.marker)), { x: 207, y: 204, width: 1, height: 36 });
  assert.equal(actions.indexOf(marker) + 1, actions.findIndex((item) => item.action === 'keyboard-request'));
  assert.equal(input.value, 'Wii');
  click(100);
  assert.equal(actions.filter((message) => message.action === 'input-marker').at(-1).marker.x, 177);
});
