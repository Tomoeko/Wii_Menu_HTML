import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSDLoading } from '../src/sd-loading.js';
import { indexLayout } from '../src/animation.js';

const sourcePath = new URL('../public/assets/layouts/sdChanSel/mn_Nocard.json', import.meta.url);
const source = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath)) : null;
const sourceTest = {
  skip: !source && 'Prepare a local menu WAD to test its original resources.',
};
const layouts = { mn_Nocard: source };
const panes = (loading) => indexLayout(loading.presentation().layers[0].layout).panes;

test('original SD loading panel completes entrance before the one-second minimum begins', sourceTest, () => {
  const loading = createSDLoading(layouts, {
    messages: { 170: 'Loading from the SD Card...' },
    hasChannels: true,
  });
  assert.equal(panes(loading).get('T_TimerMes_01').text, 'Loading from the SD Card...');
  assert.equal(panes(loading).get('W_TimerMes').alpha, 0);
  loading.advance(32);
  assert.equal(loading.getState().phase, 'enter');
  assert.equal(panes(loading).get('T_TimerMes_01').alpha, 255);
  loading.advance(1);
  assert.deepEqual(loading.getState(), { phase: 'wait', frame: 0 });
  loading.advance(59);
  assert.equal(loading.getState().phase, 'wait');
  loading.advance(1);
  assert.deepEqual(loading.getState(), { phase: 'exit', frame: 0 });
  loading.advance(4);
  assert.equal(panes(loading).get('T_TimerMes_01').alpha, 0);
  assert.ok(panes(loading).get('W_TimerMes').alpha > 0);
  loading.advance(11);
  assert.equal(panes(loading).get('W_TimerMes').alpha, 0);
  assert.equal(loading.active, true);
  loading.advance(1);
  assert.equal(loading.active, false);
  assert.deepEqual(loading.presentation(), { layers: [], controls: [], locked: false });
});

test('a busy card extends the spinner without hiding the message or skipping its eventual exit', sourceTest, () => {
  let ready = false;
  const loading = createSDLoading(layouts, { isReady: () => ready });
  loading.advance(33 + 60 + 400);
  assert.equal(loading.getState().phase, 'wait');
  const layout = loading.presentation().layers[0].layout;
  const index = indexLayout(layout);
  assert.equal(index.panes.get('W_TimerMes').alpha, 215);
  assert.equal(index.panes.get('T_TimerMes_01').alpha, 255);
  assert.equal(index.panes.get('Wait').alpha, 255);
  const waitingMaterial = layout.materials[index.panes.get('Wait').material];
  assert.equal(waitingMaterial.textureMaps[0].textureName, 'it_Waiting_d.tpl');
  ready = true;
  loading.advance(1);
  assert.deepEqual(loading.getState(), { phase: 'exit', frame: 0 });
  loading.advance(15);
  assert.equal(loading.active, true);
  loading.advance(1);
  assert.equal(loading.active, false);
});

test('batched updates retain the same ready-card phase and source data remains immutable', sourceTest, () => {
  const original = structuredClone(source);
  const single = createSDLoading(layouts, { hasChannels: true });
  const batch = createSDLoading(layouts, { hasChannels: true });
  for (let frame = 0; frame < 108; frame++) single.advance(1);
  batch.advance(108);
  assert.deepEqual(batch.getState(), single.getState());
  assert.deepEqual(batch.presentation(), single.presentation());
  batch.advance(1);
  assert.equal(batch.active, false);
  assert.deepEqual(source, original);
});

test('empty-card branch exits immediately after entry instead of inheriting the populated-card minimum', sourceTest, () => {
  const loading = createSDLoading(layouts);
  loading.advance(32);
  assert.equal(loading.getState().phase, 'enter');
  loading.advance(1);
  assert.deepEqual(loading.getState(), { phase: 'exit', frame: 0 });
  loading.advance(15);
  assert.equal(panes(loading).get('W_TimerMes').alpha, 0);
  loading.advance(1);
  assert.equal(loading.active, false);
});
