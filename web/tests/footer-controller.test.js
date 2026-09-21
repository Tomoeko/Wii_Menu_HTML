import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFooterBalloons, createFooterController } from '../src/footer-controller.js';
import { indexLayout, poseLayout } from '../src/animation.js';
import { createDisplay } from '../src/display.js';
import {
  pointerRemainsInPersistentControl,
  resolvePointerHover,
  shouldActivateArrowPointerDown,
} from '../src/arrow-interaction.js';
import { Renderer } from '../src/renderer.js';
const read = (name) => {
  const path = new URL(`../public/assets/layouts/${name}.json`, import.meta.url);
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : null;
};
const source = read('cmnBtn/my_IplTop_e'),
  balloonSource = read('balloon/my_IplTopBalloon_a');
const sourceTest = {
  skip: (!source || !balloonSource) && 'Prepare a local menu WAD to test its original resources.',
};
const measure = (text) => text.length * 10;
test('primary arrow pointer presses activate before native focus and suppress duplicates', () => {
  assert.equal(shouldActivateArrowPointerDown({ id: 'next' }), true);
  assert.equal(shouldActivateArrowPointerDown({ id: 'scene-next' }), true);
  assert.equal(shouldActivateArrowPointerDown({ id: 'next', button: 2 }), false);
  assert.equal(shouldActivateArrowPointerDown({ id: 'next', disabled: true }), false);
  assert.equal(shouldActivateArrowPointerDown({ id: 'next', suppressed: 'next' }), false);
  assert.equal(shouldActivateArrowPointerDown({ id: 'channel-4' }), false);
});
test('reboot resets footer clocks and press state to a newly created footer', sourceTest, () => {
  const footer = createFooterController(source, balloonSource, measure);
  const fresh = createFooterController(source, balloonSource, measure);
  footer.hover('next');
  footer.press('next');
  footer.pose({ messageCount: 2, newMail: true });
  footer.advance(70);
  footer.reset();
  assert.deepEqual(footer.pose(), fresh.pose());
  footer.advance(13);
  fresh.advance(13);
  assert.deepEqual(footer.pose(), fresh.pose());
});
test('footer tooltip waits the native seventeen updates and reverses on leave', sourceTest, () => {
  const sounds = [],
    balloons = createFooterBalloons(balloonSource, measure, {
      onSound: (s) => sounds.push(s),
    });
  const anchors = { settings: { x: -248, y: -170 } };
  balloons.target('settings');
  balloons.advance(16);
  assert.equal(balloons.poses(anchors).length, 0);
  balloons.advance(1);
  assert.deepEqual(sounds, ['balloon']);
  assert.equal(balloons.poses(anchors)[0].title, 'Wii Options');
  balloons.advance(3);
  balloons.target(null);
  balloons.advance(2);
  assert.equal(balloons.poses(anchors).length, 1);
  balloons.advance(1);
  assert.equal(balloons.poses(anchors).length, 0);
});
test('footer tooltips cancel before appearance and apply native widescreen margins', sourceTest, () => {
  const display = createDisplay(),
    balloons = createFooterBalloons(balloonSource, measure, { display });
  balloons.target('settings');
  balloons.advance(10);
  balloons.target(null);
  balloons.advance(20);
  assert.equal(balloons.poses({}).length, 0);
  balloons.target('sd');
  balloons.advance(23);
  const [{ layout }] = balloons.poses({ sd: { x: -245, y: -172 } }),
    panes = indexLayout(layout).panes;
  const width = 160 * display.rootScaleX;
  assert.equal(panes.get('W_Base').size[0], width);
  assert.deepEqual(panes.get('N_Balloon').translation, [
    -display.halfWidth + 200 + width / 2,
    -122,
    0,
  ]);
  assert.deepEqual(balloonSource.root.translation, [0, 0, 0]);
});
test('Message Board hover retains native six-frame endpoint then eight-frame rollout', sourceTest, () => {
  const footer = createFooterController(source, balloonSource, measure);
  footer.hover('board');
  footer.advance(60);
  const selected = footer.pose(),
    expected = poseLayout(source, [
      {
        animation: source.animations.my_IplTop_e,
        frame: 0,
        group: 'G_SeenChange',
        loop: false,
      },
      {
        animation: source.animations.my_IplTop_e,
        frame: 906,
        group: 'G_Bbs',
        loop: false,
      },
      {
        animation: source.animations.my_IplTop_e,
        frame: 0,
        group: 'G_BbsSignal',
        loop: false,
      },
    ]);
  for (const name of source.groups.G_Bbs)
    assert.deepEqual(indexLayout(selected).panes.get(name), indexLayout(expected).panes.get(name));
  footer.hover(null);
  footer.advance(8);
  const out = footer.pose(),
    outExpected = poseLayout(source, [
      {
        animation: source.animations.my_IplTop_e,
        frame: 938,
        group: 'G_Bbs',
        loop: false,
      },
      {
        animation: source.animations.my_IplTop_e,
        frame: 0,
        group: 'G_BbsSignal',
        loop: false,
      },
    ]);
  for (const name of source.groups.G_Bbs)
    assert.equal(
      indexLayout(out).panes.get(name).alpha,
      indexLayout(outExpected).panes.get(name).alpha,
    );
});

test('empty Message Board keeps the native mail notification hidden during hover and scene changes', sourceTest, () => {
  const footer = createFooterController(source, balloonSource, measure);
  footer.hover('board');
  for (const frame of [0, 3, 6, 60]) {
    footer.advance(frame);
    for (const sceneFrame of [0, 12, 30, 6000, 6012, 6030]) {
      const panes = indexLayout(footer.pose({ sceneFrame })).panes;
      assert.equal(panes.get('Picture_00').alpha, 0);
      assert.equal(panes.get('T_BbsMark1').alpha, 0);
      assert.equal(panes.get('BtnR_a0_BbsSig1').alpha, 0);
      assert.equal(panes.get('BbsMark0').alpha, 180);
    }
  }
});

test('arrow vicinity bubble holds indefinitely and original click highlight remains independent', sourceTest, () => {
  const footer = createFooterController(source, balloonSource, measure);
  footer.hover('next');
  footer.advance(15);
  const baseline = indexLayout(footer.pose());
  assert.equal(baseline.materials.get('ArwBtnR').colors[1][3], 255);
  assert.ok(baseline.panes.get('B_ArwR').scale[0] > 2);
  footer.advance(1000);
  assert.deepEqual(
    indexLayout(footer.pose()).panes.get('N_ArwBtnR'),
    baseline.panes.get('N_ArwBtnR'),
  );
  footer.press('next');
  footer.advance(3);
  assert.equal(indexLayout(footer.pose()).materials.get('ArwBtnR_Ac').colors[1][3], 235);
  footer.advance(30);
  assert.equal(indexLayout(footer.pose()).materials.get('ArwBtnR').colors[1][3], 255);
  footer.hover(null);
  footer.advance(15);
  assert.equal(indexLayout(footer.pose()).materials.get('ArwBtnR').colors[1][3], 0);
});

test('animated arrow hover survives sibling DOM boundary events without repeated entrance cues', sourceTest, () => {
  for (const aspect of ['4:3', '16:9']) {
    for (const direction of ['prev', 'next']) {
      const footer = createFooterController(source, balloonSource, measure);
      const renderer = Object.create(Renderer.prototype);
      renderer.display = createDisplay(aspect);
      renderer.bounds = new Map();
      renderer.quad = () => {};
      renderer.window = () => {};
      const side = direction === 'prev' ? 'L' : 'R';
      const arrow = () => {
        renderer.draw(footer.pose());
        return { id: direction, rect: renderer.rect(`B_Arw${side}`) };
      };
      const idle = arrow().rect;
      const point = { x: idle.x + idle.w / 2, y: idle.y + idle.h / 2, visible: true };
      let hovered = null;
      let entrances = 0;
      const notify = (requested) => {
        const controls = [arrow(), { id: 'neighbor', rect: { x: 0, y: 0, w: 832, h: 456 } }];
        const target = resolvePointerHover(controls, point, requested);
        if (target !== hovered && target === direction) entrances++;
        footer.hover(target);
        hovered = target;
      };
      notify(direction);
      for (let frame = 0; frame <= 20; frame++) {
        // As the original bubble grows toward the grid, approach its inner
        // edge diagonally. Current geometry still owns this same arrow.
        const rect = arrow().rect;
        point.x = direction === 'next' ? rect.x + 1 : rect.x + rect.w - 1;
        point.y = rect.y + 1;
        notify('neighbor');
        notify(null);
        notify(null); // per-frame reconciliation uses the same resolver
        assert.equal(hovered, direction);
        footer.advance(1);
      }
      assert.equal(entrances, 1, `${aspect} ${direction}: one uninterrupted focus cue`);
      assert.equal(indexLayout(footer.pose()).materials.get(`ArwBtn${side}`).colors[1][3], 255);
      point.x = renderer.display.width / 2;
      point.y = renderer.display.height / 2;
      notify(null);
      assert.equal(hovered, null, 'actual departure still clears focus');
      footer.advance(15);
      assert.equal(indexLayout(footer.pose()).materials.get(`ArwBtn${side}`).colors[1][3], 0);
      point.visible = false;
      assert.equal(resolvePointerHover([arrow()], point, 'neighbor'), 'neighbor');
      assert.equal(resolvePointerHover([], { ...point, visible: true }), null,
        'a removed arrow cannot retain hover');
    }
  }
});

test('disabled persistent arrows cannot reacquire hover from stale DOM events', () => {
  const point = { x: 10, y: 10, visible: true };
  const controls = [{ id: 'scene-storage-prev', rect: { x: 0, y: 0, w: 20, h: 20 },
    disabled: true }];
  assert.equal(resolvePointerHover(controls, point, null), null);
  assert.equal(resolvePointerHover(controls, point, 'scene-storage-prev'), null);
});

test('a held arrow keeps its bubble while a page click temporarily disables its region', () => {
  const controls = [{
    id: 'scene-next', disabled: true, rect: { x: 720, y: 170, w: 80, h: 100 },
  }];
  const point = { x: 760, y: 220, visible: true };
  assert.equal(pointerRemainsInPersistentControl(controls, point, 'scene-next'), true);
  assert.equal(resolvePointerHover(controls, point), null,
    'a fresh disabled DOM event still cannot acquire focus');
  assert.equal(pointerRemainsInPersistentControl(controls, { x: 600, y: 220, visible: true },
    'scene-next'), false);
});

test('arrow visibility plays the original endpoints without toggling pane visibility', sourceTest, () => {
  const footer = createFooterController(source, balloonSource, measure);
  footer.setArrows({ prev: false, next: true });
  assert.deepEqual(footer.arrowClips().map((clip) => clip.frame), [10110, 10160]);
  footer.setArrows({ prev: false, next: false });
  const samples = [];
  for (let frame = 0; frame <= 10; frame++) {
    footer.setArrows({ prev: false, next: false });
    samples.push(footer.arrowClips()[1].frame);
    footer.advance(1);
  }
  assert.deepEqual(samples, Array.from({ length: 11 }, (_, index) => 10100 + index));
  footer.setArrows({ prev: true, next: true });
  assert.deepEqual(footer.arrowClips().map((clip) => clip.frame), [10150, 10150]);
  footer.advance(5);
  assert.deepEqual(footer.arrowClips().map((clip) => clip.frame), [10155, 10155]);
  footer.advance(100);
  assert.deepEqual(footer.arrowClips().map((clip) => clip.frame), [10160, 10160]);
});

test('today message badge clamps at99, persists through hover and runs original arrival animation', sourceTest, () => {
  const sounds = [];
  const footer = createFooterController(source, balloonSource, measure, {
    onSound: (id) => sounds.push(id),
  });
  footer.hover('board');
  footer.advance(6);
  const layout = footer.pose({ messageCount: 123, newMail: true });
  assert.equal(indexLayout(layout).panes.get('T_BbsMark1').text, '99');
  assert.ok(sounds.includes('WIPL_SE_NEW_ARRIVAL'));
  footer.advance(180);
  footer.pose({ messageCount: 2, newMail: true });
  assert.equal(sounds.filter((id) => id === 'WIPL_SE_NEW_ARRIVAL').length, 2);
  footer.pose({ messageCount: 2, newMail: false });
  footer.advance(1000);
  assert.equal(sounds.filter((id) => id === 'WIPL_SE_NEW_ARRIVAL').length, 2);
});
