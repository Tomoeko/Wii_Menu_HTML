import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHomeUnderlayCache,
  homeUnderlayEligible,
} from '../src/home-underlay-cache.js';

class FakeCanvas {
  #listeners = new Map();

  addEventListener(type, listener) {
    this.#listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.#listeners.get(type) === listener) this.#listeners.delete(type);
  }

  dispatch(type) {
    this.#listeners.get(type)?.({ preventDefault() {} });
  }
}

function fakeRenderer({ width = 640, height = 456 } = {}) {
  let error = 0;
  const gl = {
    READ_FRAMEBUFFER_BINDING: 1,
    DRAW_FRAMEBUFFER_BINDING: 2,
    RENDERBUFFER_BINDING: 3,
    VIEWPORT: 4,
    SCISSOR_BOX: 5,
    SCISSOR_TEST: 6,
    READ_FRAMEBUFFER: 7,
    DRAW_FRAMEBUFFER: 8,
    FRAMEBUFFER: 9,
    RENDERBUFFER: 10,
    RGBA8: 11,
    COLOR_ATTACHMENT0: 12,
    FRAMEBUFFER_COMPLETE: 13,
    COLOR_BUFFER_BIT: 14,
    NEAREST: 15,
    NO_ERROR: 0,
    getParameter(parameter) {
      if (parameter === 1 || parameter === 2 || parameter === 3) return null;
      if (parameter === 4) return [0, 0, width, height];
      if (parameter === 5) return [0, 0, width, height];
      return null;
    },
    isEnabled() {
      return false;
    },
    createFramebuffer() {
      return {};
    },
    createRenderbuffer() {
      return {};
    },
    deleteFramebuffer() {},
    deleteRenderbuffer() {},
    bindRenderbuffer() {},
    renderbufferStorage() {},
    bindFramebuffer() {},
    framebufferRenderbuffer() {},
    checkFramebufferStatus() {
      return 13;
    },
    disable() {},
    enable() {},
    viewport() {},
    scissor() {},
    blitFramebuffer() {},
    getError() {
      const current = error;
      error = 0;
      return current;
    },
  };
  const canvas = new FakeCanvas();
  return {
    canvas,
    gl,
    display: { width: 608, height: 456 },
    rasterWidth: width,
    rasterHeight: height,
  };
}

function eligible(overrides = {}) {
  return homeUnderlayEligible({
    state: { overlay: 'home', screen: 'grid', transition: null },
    homeActive: true,
    startupComplete: true,
    entranceComplete: true,
    settingsVisible: false,
    dragging: false,
    sceneTransition: false,
    sceneFaderActive: false,
    restartActive: false,
    notice: false,
    keyboardActive: false,
    dialogActive: false,
    ...overrides,
  });
}

test('HOME underlay eligibility is limited to a stable grid or preview', () => {
  assert.equal(eligible(), true);
  assert.equal(eligible({ state: { overlay: 'home', screen: 'sd', transition: null } }), false);
  assert.equal(eligible({ state: { overlay: 'home', screen: 'grid', transition: {} } }), false);
  assert.equal(eligible({ dragging: true }), false);
  assert.equal(eligible({ sceneFaderActive: true }), false);
  assert.equal(eligible({ notice: true }), false);
  assert.equal(eligible({ homeActive: false }), false);
});

test('cache captures once and restores without redrawing a stable underlay', () => {
  const renderer = fakeRenderer();
  const cache = createHomeUnderlayCache(renderer);
  let draws = 0;
  const draw = () => {
    draws++;
  };

  cache.draw(['grid', 0], draw);
  cache.draw(['grid', 0], draw);

  assert.equal(draws, 1);
  assert.deepEqual(cache.status(), {
    captures: 1,
    restores: 1,
    underlayDraws: 1,
    releases: 0,
    bytes: 640 * 456 * 4,
    disabledReason: null,
    contextLost: false,
    destroyed: false,
  });
});

test('key changes release the old raster and capture the new underlay', () => {
  const renderer = fakeRenderer();
  const cache = createHomeUnderlayCache(renderer);
  let draws = 0;
  const draw = () => {
    draws++;
  };

  cache.draw(['grid', 0], draw);
  cache.draw(['grid', 1], draw);

  assert.equal(draws, 2);
  assert.equal(cache.status().captures, 2);
  assert.equal(cache.status().releases, 1);
});

test('budget and context failures disable retries until reset', () => {
  const renderer = fakeRenderer();
  const cache = createHomeUnderlayCache(renderer, { maxBytes: 0 });
  let draws = 0;
  const draw = () => {
    draws++;
  };

  cache.draw(['grid', 0], draw);
  cache.draw(['grid', 0], draw);
  assert.equal(draws, 2);
  assert.match(cache.status().disabledReason, /budget/);

  cache.reset();
  cache.draw(['grid', 0], draw);
  assert.equal(draws, 3);

  renderer.canvas.dispatch('webglcontextlost');
  assert.equal(cache.status().contextLost, true);
  cache.draw(['grid', 0], draw);
  assert.equal(draws, 4);
});
