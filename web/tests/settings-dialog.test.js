import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { indexLayout } from '../src/animation.js';
import { createSettingsDialog, SETTINGS_DIALOG_LAYOUTS } from '../src/settings-dialog.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && SETTINGS_DIALOG_LAYOUTS.every((key) => manifest.layouts[key]);
const layouts = available
  ? Object.fromEntries(
      SETTINGS_DIALOG_LAYOUTS.map((key) => [
        key,
        JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
      ]),
    )
  : {};

test(
  'native validation retains a buttonless dialog for 181 idle updates and releases only after exit',
  {
    skip: !available,
  },
  () => {
    const completions = [];
    const sounds = [];
    const controller = createSettingsDialog(layouts, {
      messages: { 448: 'Original localized message' },
      onSound: (sound) => sounds.push(sound),
      onComplete: (id) => completions.push(id),
    });
    const before = JSON.stringify(layouts);
    assert.equal(controller.open({ requestId: 9, messageId: 448 }), true);
    assert.equal(controller.open({ requestId: 10, messageId: 448 }), false);
    assert.equal(controller.presentation().controls.length, 0);
    assert.equal(controller.activate('ok'), false);
    assert.equal(controller.back(), false);
    controller.advance(25);
    assert.equal(controller.getSnapshot().phase, 'hold');
    const panes = indexLayout(controller.presentation().layers[0].layout).panes;
    assert.equal(panes.get('T_Dialog').text, 'Original localized message');
    assert.equal(panes.get('Wait_00').flags & 1, 0);
    assert.equal(panes.get('N_Prog').flags & 1, 0);
    assert.equal(panes.get('Shade').flags & 1, 1);
    controller.advance(180);
    assert.equal(controller.getSnapshot().phase, 'hold');
    controller.advance(1);
    assert.equal(controller.getSnapshot().phase, 'exit');
    controller.advance(20);
    assert.equal(controller.active, true);
    assert.deepEqual(completions, []);
    controller.advance(1);
    assert.equal(controller.active, false);
    assert.deepEqual(completions, [9]);
    assert.deepEqual(sounds, ['WIPL_SE_INFO_WINDOW']);
    assert.equal(JSON.stringify(layouts), before);
  },
);

test(
  'global exit cancels validation completion and allows a later independent dialog',
  {
    skip: !available,
  },
  () => {
    const completions = [];
    const controller = createSettingsDialog(layouts, { onComplete: (id) => completions.push(id) });
    controller.open({ requestId: 2, messageId: 446 });
    controller.advance(200);
    controller.reset();
    controller.advance(200);
    assert.deepEqual(completions, []);
    assert.equal(controller.presentation().layers.length, 0);
    controller.open({ requestId: 3, messageId: 446 });
    controller.advance(227);
    assert.deepEqual(completions, [3]);
  },
);
