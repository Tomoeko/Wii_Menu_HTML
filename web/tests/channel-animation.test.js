import test from 'node:test';
import assert from 'node:assert/strict';
import { channelClips, channelFrame, poseChannel } from '../src/channel-animation.js';

const anim = (frames, loop = false, targets = []) => ({ frames, loop, targets });
const pane = (name) => ({
  name,
  flags: 1,
  translation: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1],
  size: [10, 10],
  children: [],
});
const layout = (animations) => ({ root: pane('root'), materials: [], groups: {}, animations });

test('controller allows the intro below loop min and preserves script-extended holds', () => {
  const timing = { min: 40, max: 190, initial: 0, loop: true };
  assert.equal(channelFrame(0, timing), 0);
  assert.equal(channelFrame(189, timing), 189);
  assert.equal(channelFrame(190, timing), 40);
  assert.equal(channelFrame(340, timing), 40);
  assert.equal(channelFrame(0, { min: 0, max: 470, initial: 530, loop: true }), 60);
});

test('banner Start is one-shot even when its BRLAN flag says loop; Loop begins afterward', () => {
  const channel = {
    shortId: 'HACA',
    banner: layout({ banner_Start: anim(60, true), banner_Loop: anim(140, true) }),
  };
  assert.equal(channelClips(channel, 'banner', 59).length, 1);
  assert.deepEqual(
    channelClips(channel, 'banner', 65).map((c) => c.frame),
    [60, 5],
  );
  assert.deepEqual(
    channelClips(channel, 'banner', 205).map((c) => c.frame),
    [60, 5],
  );
});

test('custom banner sway is posed during the intro instead of starting abruptly afterward', () => {
  const mark = pane('Mark');
  const source = layout({
    banner_Start: anim(31),
    banner_Loop: anim(180, true, [
      {
        name: 'Mark',
        type: 0,
        tracks: [
          {
            kind: 'RLPA',
            target: 5,
            curveType: 2,
            keys: [
              { frame: 0, value: -6, slope: 0 },
              { frame: 90, value: 6, slope: 0 },
              { frame: 180, value: -6, slope: 0 },
            ],
          },
        ],
      },
    ]),
  });
  source.artwork = { kind: 'banner', width: 239, height: 100 };
  source.root.children = [mark];
  const opening = channelClips({ shortId: 'custom-example', banner: source }, 'banner', 0);
  assert.deepEqual(opening.map((clip) => clip.frame), [0, 0]);
  assert.equal(poseChannel({ shortId: 'custom-example', banner: source }, 'banner', 0).root.children[0].rotation[2], -6);
});

test('Photo icon selects the original default track and banner repeats after its intro', () => {
  const channel = {
    shortId: 'HAYA',
    icon: layout({ icon_Rso0: anim(760, true), icon_Rso1: anim(800, true) }),
    banner: layout({ banner_Rso0: anim(1240, true), banner_Rso1: anim(499, true) }),
  };
  assert.equal(channelClips(channel, 'icon', 765)[0].frame, 5);
  assert.equal(channelClips(channel, 'icon', 765).length, 1);
  assert.equal(channelClips(channel, 'banner', 1245)[0].frame, 45);
});

test('base banner intro waits through ChangeOut while an initialized native module advances', () => {
  const channel = {
    shortId: 'HAYA',
    banner: layout({ banner_Start: anim(101), banner_Rso0: anim(1240, true) }),
  };
  assert.deepEqual(
    channelClips(channel, 'banner', 6, { baseFrame: 0 }).map((c) => c.frame),
    [0, 6],
  );
  assert.deepEqual(
    channelClips(channel, 'banner', 13, { baseFrame: 3 }).map((c) => c.frame),
    [3, 13],
  );
});

test('Shop loops only its 630-frame source default and initializes donor groups', () => {
  const channel = {
    shortId: 'HABA',
    icon: layout(
      Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`icon_Rso${i}`, anim(5000, true)])),
    ),
  };
  const clips = channelClips(channel, 'icon', 635);
  assert.equal(clips.length, 16);
  assert.deepEqual(
    clips.map((c) => c.frame),
    [5, ...Array(15).fill(0)],
  );
});

test('Shop banner initializes its original localized title before and after the intro', () => {
  const source = layout({ banner_Start: anim(790), banner_Loop: anim(2430, true) });
  source.root.children = ['j', 'e', 'g', 'f', 's', 'i', 'n'].map((code) => ({
    ...pane(`font_${code}`),
    flags: 4,
  }));
  for (const frame of [0, 788, 789, 800, 3219]) {
    const output = poseChannel({ shortId: 'HABA', banner: source }, 'banner', frame, {
      language: 'ENG',
    });
    assert.deepEqual(
      output.root.children.map((p) => p.flags),
      [4, 5, 4, 4, 4, 4, 4],
    );
  }
  const spanish = poseChannel({ shortId: 'HABA', banner: source }, 'banner', 800, {
    language: 'SPA',
  });
  assert.deepEqual(
    spanish.root.children.map((p) => p.flags),
    [4, 4, 4, 4, 5, 4, 4],
  );
  assert.ok(source.root.children.every((p) => p.flags === 4));
});

test('Rso binding cannot animate panes outside the source group', () => {
  const target = (name) => ({
    name,
    type: 0,
    tracks: [{ kind: 'RLPA', target: 0, curveType: 1, keys: [{ frame: 0, value: 99 }] }],
  });
  const source = layout({ icon_Rso0: anim(760, true, [target('selected'), target('unrelated')]) });
  source.root.children = [pane('selected'), pane('unrelated')];
  source.groups.Rso0 = ['selected'];
  const output = poseChannel({ shortId: 'HAYA', icon: source }, 'icon', 0);
  assert.equal(output.root.children[0].translation[0], 99);
  assert.equal(output.root.children[1].translation[0], 0);
  assert.equal(source.root.children[0].translation[0], 0);
});

test('seat-holder loops follow source phase offsets beyond BRLAN key lengths', () => {
  const source = layout(
    Object.fromEntries([181, 5891, 151, 1025].map((n, i) => [`icon_Rso${i}`, anim(n)])),
  );
  const clips = channelClips({ shortId: 'HADE', icon: source }, 'icon', 100);
  assert.deepEqual(
    clips.slice(0, 3).map((c) => c.frame),
    [280, 160, 340],
  );
  assert.ok(Math.abs(clips[3].frame - (100 * 1024) / 290) < 1e-10);
  assert.ok(clips[2].animation.frames >= 340);
});

test('Forecast native no-data branch shows the setup message and stops after frame 16', () => {
  const source = layout({ banner_Rso0: anim(17) });
  source.root.children = ['all', 'weather', 'textB0', 'textT0', 'textT1', 'textT2'].map(pane);
  const channel = { shortId: 'HAFE', banner: source },
    output = poseChannel(channel, 'banner', 100);
  assert.deepEqual(
    output.root.children.map((p) => p.flags & 1),
    [1, 0, 1, 1, 0, 0],
  );
  assert.equal(channelClips(channel, 'banner', 100)[0].frame, 16);
});

test('Connection video uses the source no-network range and banner ends on its last frame', () => {
  const channel = {
    shortId: 'HCGE',
    icon: layout({ icon_Rso0: anim(2085) }),
    banner: layout({ banner_Rso0: anim(331) }),
  };
  assert.equal(channelClips(channel, 'icon', 0)[0].frame, 1000);
  assert.equal(channelClips(channel, 'icon', 1084)[0].frame, 1000);
  assert.equal(channelClips(channel, 'banner', 1000)[0].frame, 330);
});
