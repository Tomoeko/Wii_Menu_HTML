import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleTrack,
  multiply,
  paneMatrix,
  paneCorners,
  transform3D,
  poseLayout,
} from '../src/animation.js';

test('text vertex color tracks share top and bottom pairs and keep pane alpha separate', () => {
  const source = {
    root: {
      name: 'label',
      type: 'txt1',
      alpha: 255,
      textColors: [
        [1, 2, 3, 0],
        [4, 5, 6, 0],
      ],
      children: [],
    },
    materials: [],
  };
  const animation = {
    frames: 10,
    targets: [
      {
        name: 'label',
        type: 0,
        tracks: [
          [3, 255],
          [4, 42],
          [11, 128],
          [13, 84],
          [16, 200],
        ].map(([target, value]) => ({
          kind: 'RLVC',
          target,
          curveType: 1,
          keys: [{ frame: 0, value }],
        })),
      },
    ],
  };
  const result = poseLayout(source, [{ animation, frame: 0, loop: false }]);
  assert.deepEqual(result.root.textColors, [
    [42, 2, 3, 255],
    [4, 84, 6, 128],
  ]);
  assert.equal(result.root.alpha, 200);
  assert.deepEqual(source.root.textColors, [
    [1, 2, 3, 0],
    [4, 5, 6, 0],
  ]);
});

test('Hermite key slopes use the source frame interval', () => {
  const track = {
    keys: [
      { frame: 0, value: 10, slope: 2 },
      { frame: 10, value: 30, slope: 2 },
    ],
  };
  assert.equal(sampleTrack(track, 5), 20);
  assert.equal(sampleTrack(track, -1), 10);
  assert.equal(sampleTrack(track, 50), 30);
});
test('step visibility switches on its exact key frame', () => {
  const track = {
    curveType: 1,
    keys: [
      { frame: 0, value: 0 },
      { frame: 12, value: 1 },
      { frame: 20, value: 0 },
    ],
  };
  assert.equal(sampleTrack(track, 11.999), 0);
  assert.equal(sampleTrack(track, 12), 1);
});
test('pane origins and parent transforms preserve centered y-up coordinates', () => {
  const pane = {
    origin: 4,
    size: [128, 96],
    translation: [-200, 120, 0],
    rotation: [0, 0, 0],
    scale: [1, 1],
  };
  const matrix = multiply([2, 0, 0, 2, 0, 0], paneMatrix(pane));
  assert.deepEqual(paneCorners(pane, matrix), [
    [-528, 336],
    [-272, 336],
    [-528, 144],
    [-272, 144],
  ]);
});

const rounded = (values) => values.map((value) => Math.round(value * 1e9) / 1e9);
test('NW4R applies scale, X rotation, Y rotation, Z rotation, then translation', () => {
  const pane = { translation: [10, 20, 30], rotation: [90, 90, 90], scale: [2, 3] };
  assert.deepEqual(rounded(transform3D(paneMatrix(pane), 1, 2)), [10, 26, 28]);
});

test('parent rotations retain child Z and cancelling rotations preserve the complete plane', () => {
  const parent = paneMatrix({ translation: [0, 0, 0], rotation: [0, 90, 0], scale: [1, 1] });
  const child = paneMatrix({ translation: [0, 0, 20], rotation: [0, -90, 0], scale: [1, 1] });
  const combined = multiply(parent, child);
  assert.deepEqual(rounded(transform3D(combined, 7, 9)), [27, 9, 0]);
  assert.deepEqual(rounded(transform3D(multiply([2, 0, 0, 3, 4, 5], combined), 7, 9)), [58, 32, 0]);
  assert.deepEqual(rounded(transform3D(multiply(combined, [2, 0, 0, 3, 4, 5]), 7, 9)), [38, 32, 0]);
});
