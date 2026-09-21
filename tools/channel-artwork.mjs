/** Attach independent artwork without inheriting the sample squares' movement. */
export function placeChannelArtwork(layout, { kind, width, height, material, accent }) {
  layout.root.children.find((pane) => pane.name === 'Content').flags &= ~1;
  const picture = (name, color, mapping) => ({
    name,
    type: 'pic1',
    flags: 5,
    origin: 4,
    alpha: 255,
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1],
    size: [width, height],
    children: [],
    material: mapping ? material : 0,
    vertexColors: Array.from({ length: 4 }, () => [...color, 255]),
    texCoords: mapping
      ? [
          [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ],
        ]
      : [],
  });
  layout.root.children.push(picture('ArtworkBorder', accent, false));
  layout.root.children.push(picture('Artwork', [255, 255, 255], true));
  layout.artwork = { kind, width, height };
}
