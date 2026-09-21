import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoEraseDialog } from '../src/board-memo-dialog.js';

function source() {
  return {
    root: { name: 'Root', children: ['T_Dialog', 'T_BtnA', 'T_BtnB'].map(name => ({ name })) },
    materials: [],
    groups: {},
    animations: Object.fromEntries(Object.entries({
      DialogIn: 3, SelectBtn_Ac: 2, DialogOut: 4,
    }).map(([suffix, frames]) => [`my_DialogWindow_b_${suffix}`, { frames, targets: [] }])),
  };
}

test('Memo erase interaction lock follows its full lifecycle without posing for status', (t) => {
  const outcomes = [];
  const dialog = createMemoEraseDialog(source(), { onDone: accepted => outcomes.push(accepted) });
  const clone = globalThis.structuredClone;
  let clones = 0;
  t.mock.method(globalThis, 'structuredClone', (...args) => {
    clones += 1;
    return clone(...args);
  });
  const check = (phase, expectedLock) => {
    clones = 0;
    assert.equal(dialog.snapshot().phase, phase);
    assert.equal(dialog.locked, expectedLock);
    assert.equal(clones, 0, 'reading interaction state must not construct a layout');
    const view = dialog.presentation();
    assert.equal(view.locked, expectedLock);
    assert.ok(view.controls.every(control => control.disabled === expectedLock));
    if (phase === 'done') assert.deepEqual(view, { layers: [], controls: [], locked: false });
  };
  check('enter', true);
  assert.equal(dialog.activate('memo-erase-no'), false);
  dialog.advance(2.5);
  check('enter', true);
  dialog.advance(0.5);
  check('idle', false);
  assert.equal(dialog.activate('memo-erase-no'), true);
  check('select', true);
  assert.equal(dialog.activate('memo-erase-yes'), false);
  dialog.advance(2);
  check('exit', true);
  dialog.advance(3.5);
  check('exit', true);
  assert.deepEqual(outcomes, []);
  dialog.advance(0.5);
  check('done', false);
  assert.deepEqual(outcomes, [false]);
  assert.equal(dialog.activate('memo-erase-yes'), false);
});
