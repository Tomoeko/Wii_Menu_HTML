import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuPointer } from '../src/menu-pointer.js';
import { createDisplay } from '../src/display.js';

function fixture() {
  const surface = new EventTarget();
  const windowTarget = new EventTarget();
  let display;
  let bounds = { left: 100, top: 50, width: 1600, height: 900 };
  let capture = false;
  surface.getBoundingClientRect = () => bounds;
  surface.hasPointerCapture = () => capture;
  const controller = createMenuPointer({ surface, getDisplay: () => display, windowTarget });
  function send(type, x = 900, y = 500) {
    const event = new Event(type);
    Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
    surface.dispatchEvent(event);
  }
  return {
    ...controller, surface, windowTarget, send,
    display(value) { display = value; },
    bounds(value) { bounds = value; },
    capture(value) { capture = value; },
  };
}

test('physical position survives loading and scene locks before the next scene draws P1', () => {
  const input = fixture();
  input.send('pointerenter', 500, 275);
  assert.equal(input.pointer.visible, false);
  input.display(createDisplay());
  input.refresh();
  assert.deepEqual(input.pointer, { x: 208, y: 114, visible: true });
  input.surface.addEventListener('pointermove', () => { /* Scene action remains locked. */ });
  input.send('pointermove', 1300, 725);
  assert.deepEqual(input.pointer, { x: 624, y: 342, visible: true });
  input.destroy();
});

test('pointerdown updates the hotspot when a DOM control is activated without a preceding move', () => {
  const input = fixture();
  input.display(createDisplay());
  input.send('pointerdown', 1700, 950);
  assert.deepEqual(input.pointer, { x: 832, y: 456, visible: true });
  input.send('pointerdown', 100, 50);
  assert.deepEqual(input.pointer, { x: 0, y: 0, visible: true });
  input.destroy();
});

test('viewport changes reproject the last physical point and hide it in the letterbox', () => {
  const input = fixture();
  input.display(createDisplay('4:3'));
  input.send('pointermove', 500, 275);
  input.bounds({ left: 100, top: 50, width: 800, height: 450 });
  input.windowTarget.dispatchEvent(new Event('resize'));
  assert.deepEqual(input.pointer, { x: 304, y: 228, visible: true });
  input.bounds({ left: 600, top: 50, width: 800, height: 450 });
  input.windowTarget.dispatchEvent(new Event('resize'));
  assert.equal(input.pointer.visible, false);
  input.destroy();
});

test('captured drags retain off-screen coordinates until capture is released', () => {
  const input = fixture();
  input.display(createDisplay());
  input.capture(true);
  input.send('pointermove', 1800, 1000);
  input.send('pointerleave');
  assert.equal(input.pointer.visible, true);
  assert.ok(input.pointer.x > 832);
  input.capture(false);
  input.send('lostpointercapture');
  assert.equal(input.pointer.visible, false);
  input.destroy();
});

test('cancel and focus loss do not revive a stale pointer on resize', () => {
  const input = fixture();
  input.display(createDisplay());
  input.send('pointermove');
  input.windowTarget.dispatchEvent(new Event('blur'));
  input.windowTarget.dispatchEvent(new Event('resize'));
  assert.equal(input.pointer.visible, false);
  input.send('pointerdown');
  assert.equal(input.pointer.visible, true);
  input.send('pointercancel');
  assert.equal(input.pointer.visible, false);
  input.destroy();
  input.send('pointermove');
  assert.equal(input.pointer.visible, false);
});
