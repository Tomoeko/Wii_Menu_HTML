import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MENU_SCENE_LAYOUTS } from '../src/menu-scenes.js';
import { createInspectionSequence } from '../src/create-inspection-sequence.js';
import { createDisplay } from '../src/display.js';
import { indexLayout } from '../src/animation.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const names = [...new Set(MENU_SCENE_LAYOUTS)];
const available = manifest && names.every((name) => manifest.layouts[name]);
const layouts = available
  ? Object.fromEntries(
      names.map((name) => [
        name,
        JSON.parse(readFileSync(new URL(manifest.layouts[name].url, manifestUrl))),
      ]),
    )
  : {};
const options = { display: createDisplay('16:9'), date: new Date(2026, 8, 17, 12) };

test(
  'sequence inspection retains board, mask, selector, book and footer in native draw order',
  { skip: !available },
  () => {
    const sequence = createInspectionSequence(layouts, options);
    const first = sequence.sample(0);
    assert.deepEqual(
      first.presentation.layers.map((layer) => layer.prefix),
      [
        'scene-board:',
        'scene-board-mask:',
        'scene-create:',
        'address-book:',
        'scene-create-footer:',
      ],
    );
    const board = first.presentation.layers[0].layout;
    assert.equal(indexLayout(board).panes.get('T_Day_b').text, 'Thu 9/17');
    assert.equal(first.presentation.locked, true);
    assert.equal(sequence.sample(27).presentation.locked, true);
    assert.equal(sequence.sample(28).presentation.locked, false);
  },
);

test(
  'scrubbing backward reproduces the same complete pose without mutating resources',
  { skip: !available },
  () => {
    const original = JSON.stringify(layouts);
    for (const flow of ['enter', 'exit-cover', 'exit-page']) {
      const sequence = createInspectionSequence(layouts, { ...options, flow });
      const early = sequence.sample(7);
      sequence.sample(sequence.duration);
      assert.deepEqual(sequence.sample(7), early);
      const fresh = createInspectionSequence(layouts, { ...options, flow });
      for (let frame = 0; frame <= 7; frame++) fresh.sample(frame);
      assert.deepEqual(fresh.sample(7), early);
    }
    assert.equal(JSON.stringify(layouts), original);
  },
);

test(
  'cover and next-page exits preserve their selected book pose through the complete parent exit',
  { skip: !available },
  () => {
    const poses = [];
    for (const flow of ['exit-cover', 'exit-page']) {
      const sequence = createInspectionSequence(layouts, { ...options, flow });
      const first = sequence.sample(0);
      poses.push(
        first.presentation.layers.find((layer) => layer.prefix === 'address-book:').layout,
      );
      assert.equal(first.metadata.actions.includes('address-next'), flow === 'exit-page');
      assert.equal(first.metadata.actions.at(-1), 'back');
      assert.equal(sequence.sample(47).metadata.state.childPage, 'address');
      const last = sequence.sample(48);
      assert.equal(last.metadata.state.childPage, 'selector');
      assert.equal(last.presentation.locked, false);
      assert.equal(
        last.presentation.layers.some((layer) => layer.prefix === 'address-book:'),
        false,
      );
    }
    assert.notDeepEqual(poses[0], poses[1]);
  },
);

test(
  'inspection rejects frames and setup values outside the deterministic domain',
  { skip: !available },
  () => {
    assert.throws(() => createInspectionSequence(layouts, { flow: 'unknown' }), RangeError);
    assert.throws(() => createInspectionSequence(layouts, { focusFrames: -1 }), RangeError);
    const sequence = createInspectionSequence(layouts, options);
    for (const frame of [-1, 29, 1.5, NaN]) assert.throws(() => sequence.sample(frame), RangeError);
  },
);
