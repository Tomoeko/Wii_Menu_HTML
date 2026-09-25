import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/tool-theme.js', import.meta.url), 'utf8');

function startTheme({ stored = null, systemLight = false, storageUnavailable = false } = {}) {
  const elements = [];
  const toolbar = { append(element) { elements.push(element); } };
  const themeColor = { content: '#111820' };
  const documentElement = { dataset: {} };
  const eventHandlers = new Map();
  const mediaQuery = {
    matches: systemLight,
    addEventListener(name, callback) { eventHandlers.set(`media:${name}`, callback); },
  };
  const saved = [];
  const document = {
    documentElement,
    readyState: 'complete',
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return themeColor;
      if (selector === '[data-tool-toolbar]') return toolbar;
      return null;
    },
    createElement(tagName) {
      return {
        tagName,
        children: [],
        append(child) { this.children.push(child); },
        addEventListener(name, callback) { eventHandlers.set(`${tagName}:${name}`, callback); },
        setAttribute() {},
      };
    },
    createTextNode(text) { return { text }; },
  };
  const window = {
    matchMedia() { return mediaQuery; },
    addEventListener(name, callback) { eventHandlers.set(`window:${name}`, callback); },
  };
  const localStorage = {
    getItem() {
      if (storageUnavailable) throw new Error('Storage unavailable');
      return stored;
    },
    setItem(key, value) { saved.push({ key, value }); },
  };

  vm.runInNewContext(source, { document, localStorage, window });
  const selector = elements[0].children[1];
  return { documentElement, eventHandlers, mediaQuery, saved, selector, themeColor };
}

test('tool pages open dark for fresh users and when browser storage is unavailable', () => {
  for (const options of [{}, { storageUnavailable: true }, { stored: 'invalid' }]) {
    const theme = startTheme(options);
    assert.equal(theme.documentElement.dataset.toolTheme, 'dark');
    assert.equal(theme.documentElement.dataset.toolPalette, 'dark');
    assert.equal(theme.selector.value, 'dark');
    assert.equal(theme.themeColor.content, '#111820');
  }
});

test('tool pages retain explicit light and system choices', () => {
  const light = startTheme({ stored: 'light' });
  assert.equal(light.documentElement.dataset.toolTheme, 'light');
  assert.equal(light.documentElement.dataset.toolPalette, 'light');
  assert.equal(light.themeColor.content, '#f5f8fb');

  const system = startTheme({ stored: 'system', systemLight: true });
  assert.equal(system.documentElement.dataset.toolTheme, 'system');
  assert.equal(system.documentElement.dataset.toolPalette, 'light');
  assert.equal(system.themeColor.content, '#f5f8fb');
  system.mediaQuery.matches = false;
  system.eventHandlers.get('media:change')();
  assert.equal(system.documentElement.dataset.toolPalette, 'dark');
  assert.equal(system.themeColor.content, '#111820');

  system.selector.value = 'dark';
  system.eventHandlers.get('select:change')();
  assert.equal(system.documentElement.dataset.toolTheme, 'dark');
  assert.equal(system.documentElement.dataset.toolPalette, 'dark');
  assert.equal(system.saved.at(-1).value, 'dark');
});
