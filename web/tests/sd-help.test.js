import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSDHelp } from '../src/sd-help.js';
import { indexLayout } from '../src/animation.js';
const read = (name) => {
  const path = new URL('../public/assets/' + name, import.meta.url);
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : null;
};
const layouts = {
  my_DialogWindow_a2: read('layouts/dlgWdw/my_DialogWindow_a2.json'),
  wait_icon: read('layouts/sdChanSel/wait_icon.json'),
  help_Btn: read('layouts/sdChanSel/help_Btn.json'),
};
const messages = read('messages/eng/ipl_common.json');
const sourceTest = {
  skip: (!messages || !Object.values(layouts).every(Boolean)) && 'Prepare a local menu WAD to test its original resources.',
};
test('SD Help changes page only after select and original ten-update text fade', sourceTest, () => {
  const help = createSDHelp(layouts, { messages });
  help.advance(25);
  const before = indexLayout(help.presentation().layers[0].layout).panes;
  assert.match(before.get('T_Dialog').text, /About the SD Card Menu/);
  const position = [...before.get('N_Dialog').translation];
  help.activate('help-next');
  help.advance(21);
  help.advance(5);
  let panes = indexLayout(help.presentation().layers[0].layout).panes;
  assert.equal(panes.get('T_Dialog').alpha, 125);
  assert.deepEqual(panes.get('N_Dialog').translation, position);
  assert.match(panes.get('T_Dialog').text, /About the SD Card Menu/);
  help.advance(5);
  panes = indexLayout(help.presentation().layers[0].layout).panes;
  assert.equal(panes.get('T_Dialog').alpha, 0);
  assert.match(panes.get('T_Dialog').text, /About Save Data/);
  help.advance(10);
  assert.equal(help.presentation().locked, false);
});
test('SD Help last page presents original animated wait icon and Close label', sourceTest, () => {
  const help = createSDHelp(layouts, { messages });
  help.advance(25);
  help.activate('help-next');
  help.advance(41);
  help.activate('help-next');
  help.advance(41);
  const view = help.presentation(),
    icon = view.layers.find((x) => x.prefix === 'sd-help-wait:');
  assert.ok(icon);
  assert.equal(icon.layout.root.translation[1], 74);
  assert.equal(view.controls[1].label, 'Close');
  help.activate('help-next');
  help.advance(21);
  assert.equal(help.getState().phase, 'exit');
  help.advance(21);
  assert.equal(help.active, false);
});
test('first SD visit uses its distinct four-page welcome with hidden initial Back', sourceTest, () => {
  const help = createSDHelp(layouts, { messages, firstVisit: true });
  help.advance(25);
  let view = help.presentation();
  assert.match(
    indexLayout(view.layers[0].layout).panes.get('T_Dialog').text,
    /Welcome to the SD Card Menu/,
  );
  assert.deepEqual(
    view.controls.map((control) => control.id),
    ['help-next'],
  );
  assert.equal(help.activate('help-back'), false);
  for (let page = 1; page <= 3; page++) {
    help.activate('help-next');
    help.advance(41);
  }
  view = help.presentation();
  assert.equal(
    view.layers.find((layer) => layer.prefix === 'sd-help-button:').layout.root.translation[1],
    108,
  );
  assert.equal(view.controls[1].label, 'Close');
});

test('pointed Help button recovers while the page text fades out', sourceTest, () => {
  const help = createSDHelp(layouts, { messages });
  help.advance(25);
  help.hover('help-next');
  help.advance(6);
  help.activate('help-next');
  help.advance(21);
  let panes = indexLayout(help.presentation().layers[0].layout).panes;
  assert.ok(Math.abs(panes.get('N_BtnB').scale[0] - 0.9) < 0.000001);
  help.advance(6);
  panes = indexLayout(help.presentation().layers[0].layout).panes;
  assert.equal(panes.get('N_BtnB').scale[0], 1);
  assert.equal(panes.get('T_Dialog').alpha, 99);
  assert.match(panes.get('T_Dialog').text, /About the SD Card Menu/);
});
