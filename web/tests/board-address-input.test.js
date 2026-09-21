import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { indexLayout, transform } from '../src/animation.js';
import { CREATE_LAYOUTS, createBoardCreate } from '../src/board-create.js';
import { createDisplay } from '../src/display.js';
import { BitmapFont } from '../src/font.js';
import { Renderer } from '../src/renderer.js';
import { isPersistentArrowControl } from '../src/arrow-interaction.js';
import { routeKeyboardTextPointer } from '../src/keyboard-text-hit.js';

const manifestUrl = new URL('../public/assets/manifest.json', import.meta.url);
const manifest = existsSync(manifestUrl) ? JSON.parse(readFileSync(manifestUrl)) : null;
const available = manifest && CREATE_LAYOUTS.every((key) => manifest.layouts[key]) &&
  manifest.fonts?.['WiiBitmapFontType1.brfnt'];
const layouts = available ? Object.fromEntries(CREATE_LAYOUTS.map((key) => [
  key, JSON.parse(readFileSync(new URL(manifest.layouts[key].url, manifestUrl))),
])) : {};

function fixture(aspect) {
  const display = createDisplay(aspect);
  const font = new BitmapFont(JSON.parse(readFileSync(new URL(
    manifest.fonts['WiiBitmapFontType1.brfnt'].url, manifestUrl,
  ))), {});
  const sounds = [];
  const create = createBoardCreate(layouts, {
    display, localRegistration: true,
    measureTextLayout: (text, pane) => font.layoutPaneText(text, pane),
    onSound: (sound) => sounds.push(sound),
  });
  create.advance(39);
  create.activate('address');
  create.advance(29);
  create.activate('submit');
  create.advance(21);
  create.advance(36);
  create.activate('address-email');
  create.advance(61);
  create.activate('address-edit');
  for (const character of 'W'.repeat(82)) create.keyInput(character);
  create.advance(30);
  create.advance(1);
  const rendered = () => {
    const view = create.presentation();
    const renderer = Object.create(Renderer.prototype);
    renderer.display = display;
    renderer.bounds = new Map();
    renderer.quad = () => {};
    renderer.window = () => {};
    for (const layer of view.layers) renderer.draw(layer.layout, { ...layer });
    return {
      view, renderer,
      controls: view.controls.map((control) => ({
        ...control, id: `scene-${control.id}`, rect: renderer.rect(control.prefix + control.pane),
      })),
    };
  };
  const field = () => {
    const layer = create.presentation().layers.findLast((entry) => entry.prefix === 'keyboard-text:');
    return indexLayout(layer.layout).panes.get('T_2l_TextBox');
  };
  return { create, font, display, sounds, rendered, field };
}

for (const aspect of ['4:3', '16:9']) {
  test(`Address caret uses the rendered field after manual scrolling (${aspect})`,
    { skip: !available }, () => {
      const { create, font, display, rendered, field } = fixture(aspect);
      assert.equal(field().text.length, 82);
      const oldScroll = field().translation[1];
      assert.equal(create.activate('key-text-up'), true);
      create.advance(15);
      assert.ok(field().translation[1] < oldScroll);
      const { view, renderer, controls } = rendered();
      const bound = renderer.bounds.get('keyboard-text:T_2l_TextBox');
      const layer = view.layers.findLast((entry) => entry.prefix === 'keyboard-text:');
      const candidates = font.layoutPaneText(bound.pane.text, bound.pane).lines.map((line) => {
        const caret = line.carets[Math.min(3, line.carets.length - 1)];
        const [x, y] = transform(bound.matrix, caret.x, line.y - 12);
        return { index: caret.index, point: { x: display.halfWidth + x, y: display.halfHeight - y } };
      });
      const target = candidates.find(({ point }) => point.y > layer.clip.y + 2 &&
        point.y < layer.clip.y + layer.clip.h - 2);
      assert.ok(target, 'a source glyph caret is inside the current text clip');
      assert.ok(target.index > 0 && target.index < 72);
      const routed = routeKeyboardTextPointer(target.point, controls,
        (point) => create.selectTextAt(point));
      assert.equal(routed.selected, true);
      create.keyInput('X');
      assert.equal(field().text, `${'W'.repeat(target.index)}X${'W'.repeat(82 - target.index)}`);
      assert.equal(create.selectTextAt({ x: 0, y: 0 }), false);
      create.activate('key-ok');
      assert.equal(create.selectTextAt(target.point), false, 'a closed field cannot reopen from the stale hit');
      assert.equal(create.holdControl('key-text-up'), false);
      create.dispose();
    });

  test(`Address held field scrolling releases on pointer release, blur and disposal (${aspect})`,
    { skip: !available }, () => {
      for (const release of ['pointer', 'blur', 'dispose']) {
        const { create, sounds, rendered, field } = fixture(aspect);
        const control = rendered().controls.find((item) => item.id === 'scene-key-text-up');
        assert.ok(control?.rect);
        assert.equal(isPersistentArrowControl(control.id), true);
        assert.equal(isPersistentArrowControl('scene-key-text-down'), true);
        const point = {
          x: control.rect.x + control.rect.w / 2,
          y: control.rect.y + control.rect.h / 2,
        };
        const hit = routeKeyboardTextPointer(point, rendered().controls,
          (location) => create.selectTextAt(location));
        assert.equal(hit.control.id, control.id);
        assert.equal(hit.selected, false, 'field arrows occlude the text underneath');
        create.hover('key-text-up');
        create.advance(6);
        assert.equal(create.holdControl('key-text-up'), true);
        create.advance(15);
        const scrollAfterPress = field().translation[1];
        const scrollCues = () => sounds.filter((sound) => sound === 'WIPL_SE_LINE_SCROLL').length;
        const before = scrollCues();
        create.advance(44);
        assert.equal(scrollCues(), before, 'repeat waits sixty native updates');
        create.advance(1);
        assert.equal(scrollCues(), before + 1);
        create.advance(15);
        assert.ok(field().translation[1] < scrollAfterPress);
        if (release === 'pointer') create.releaseControl();
        else if (release === 'blur') create.keyInput('', { type: 'blur' });
        else create.dispose();
        const released = scrollCues();
        create.advance(80);
        assert.equal(scrollCues(), released, release);
        if (release !== 'dispose') {
          assert.equal(create.holdControl('key-text-up'), true, 'a released live editor can be held again');
          create.releaseControl();
          create.activate('key-ok');
        }
        assert.equal(create.holdControl('key-text-up'), false, 'only the active child owns field input');
        create.dispose();
      }
    });
}
