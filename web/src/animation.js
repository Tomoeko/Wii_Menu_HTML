/** NW4R uses key slopes in values/frame, not normalized tangent vectors. */
export function sampleTrack(track, frame) {
  const keys = track.keys;
  if (!keys?.length) return undefined;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys.at(-1).frame) return keys.at(-1).value;
  let i = 1;
  while (keys[i].frame <= frame) i++;
  const a = keys[i - 1],
    b = keys[i];
  if (track.curveType === 1 || track.curve === 'step') return a.value;
  const span = b.frame - a.frame,
    t = (frame - a.frame) / span;
  return (
    (2 * t * t * t - 3 * t * t + 1) * a.value +
    (t * t * t - 2 * t * t + t) * span * (a.slope || 0) +
    (-2 * t * t * t + 3 * t * t) * b.value +
    (t * t * t - t * t) * span * (b.slope || 0)
  );
}

export function walkPanes(pane, visit) {
  visit(pane);
  for (const child of pane.children || []) walkPanes(child, visit);
}

export function indexLayout(layout) {
  const panes = new Map();
  walkPanes(layout.root, (pane) => panes.set(pane.name, pane));
  return {
    panes,
    materials: new Map(layout.materials.map((material) => [material.name, material])),
  };
}

/** Apply source curves to a fresh working layout, leaving the imported resource immutable. */
export function poseLayout(source, clips = []) {
  const layout = {
    ...source,
    root: structuredClone(source.root),
    materials: structuredClone(source.materials),
  };
  const { panes, materials } = indexLayout(layout);
  for (const { animation, frame, group, recursive = false, loop } of clips) {
    if (!animation) continue;
    let allowedPanes, allowedMaterials;
    if (group) {
      allowedPanes = new Set();
      allowedMaterials = new Set();
      const include = (pane) => {
        allowedPanes.add(pane.name);
        if (pane.material !== undefined)
          allowedMaterials.add(layout.materials[pane.material]?.name);
        for (const frame of pane.frames || [])
          allowedMaterials.add(layout.materials[frame.material]?.name);
      };
      for (const name of source.groups[group] || []) {
        const pane = panes.get(name);
        // Group membership and recursive binding are separate in NW4R. The
        // menu's common-button groups deliberately bind nonrecursively.
        if (pane) recursive ? walkPanes(pane, include) : include(pane);
      }
    }
    // Resource loop bits are authoring defaults. Scene controllers can explicitly
    // play forward and hold the endpoint (notably the five-frame focus outline).
    const repeating = loop ?? animation.loop;
    const f =
      repeating && animation.frames > 0
        ? frame % animation.frames
        : Math.min(frame, animation.frames);
    for (const content of animation.targets || []) {
      const allowed = content.type === 1 ? allowedMaterials : allowedPanes;
      if (allowed && !allowed.has(content.name)) continue;
      const target = (content.type === 1 ? materials : panes).get(content.name);
      if (!target) continue;
      for (const track of content.tracks || []) {
        const value = sampleTrack(track, f);
        if (value === undefined) continue;
        const property = track.target;
        switch (track.kind) {
          case 'RLPA':
            if (property < 3) target.translation[property] = value;
            else if (property < 6) target.rotation[property - 3] = value;
            else if (property < 8) target.scale[property - 6] = value;
            else if (property < 10) target.size[property - 8] = value;
            break;
          case 'RLVI':
            target.flags = value ? target.flags | 1 : target.flags & ~1;
            break;
          case 'RLVC':
            if (property === 16) target.alpha = value;
            // NW4R TextBox::SetVtxColorElement maps the two top vertices to
            // text color 0 and the two bottom vertices to text color 1.
            else if (target.textColors)
              target.textColors[Math.floor(property / 8)][property % 4] = value;
            else if (target.vertexColors)
              target.vertexColors[Math.floor(property / 4)][property % 4] = value;
            break;
          case 'RLMC':
            if (property < 4 && target.materialColor) target.materialColor[property] = value;
            else if (property < 16 && property >= 4)
              target.colors[Math.floor((property - 4) / 4)][property % 4] = value;
            else if (property >= 16 && target.konstColors)
              target.konstColors[Math.floor((property - 16) / 4)][property % 4] = value;
            break;
          case 'RLTS': {
            const srt = target.textureSRTs[track.id];
            if (!srt) break;
            if (property < 2) srt.translate[property] = value;
            else if (property === 2) srt.rotation = value;
            else if (property < 5) srt.scale[property - 3] = value;
            break;
          }
          case 'RLTP': {
            const mapping = target.textureMaps?.[track.id];
            const name = animation.textures?.[value];
            // SetTextureNoWrap changes the image but preserves the material's
            // wrap modes. Do not reorder the original texture-index table.
            if (property === 0 && mapping && name) mapping.textureName = name;
            break;
          }
        }
      }
    }
  }
  return layout;
}

export const identity = [1, 0, 0, 1, 0, 0];
/** Existing six-value 2D matrices and row-major NW4R 3x4 matrices interoperate. */
function matrix3D(matrix) {
  return matrix.length === 12
    ? matrix
    : [matrix[0], matrix[2], 0, matrix[4], matrix[1], matrix[3], 0, matrix[5], 0, 0, 1, 0];
}
export function multiply(a, b) {
  if (a.length === 12 || b.length === 12) {
    a = matrix3D(a);
    b = matrix3D(b);
    const result = Array(12);
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 4; column++)
        result[row * 4 + column] =
          (column === 3 ? a[row * 4 + 3] : 0) +
          a[row * 4] * b[column] +
          a[row * 4 + 1] * b[4 + column] +
          a[row * 4 + 2] * b[8 + column];
    return result;
  }
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function paneMatrix(pane) {
  const r = (pane.rotation[2] * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  if (pane.rotation[0] || pane.rotation[1] || pane.translation[2]) {
    const x = (pane.rotation[0] * Math.PI) / 180,
      y = (pane.rotation[1] * Math.PI) / 180;
    const cx = Math.cos(x),
      sx = Math.sin(x),
      cy = Math.cos(y),
      sy = Math.sin(y),
      [scaleX, scaleY] = pane.scale;
    // Pane::CalculateMtx: T * Rz * Ry * Rx * S. Keep Z until final projection;
    // a parent's X/Y rotation can bring a child's Z translation into view.
    return [
      c * cy * scaleX,
      (c * sy * sx - s * cx) * scaleY,
      c * sy * cx + s * sx,
      pane.translation[0],
      s * cy * scaleX,
      (s * sy * sx + c * cx) * scaleY,
      s * sy * cx - c * sx,
      pane.translation[1],
      -sy * scaleX,
      cy * sx * scaleY,
      cy * cx,
      pane.translation[2],
    ];
  }
  return [
    c * pane.scale[0],
    s * pane.scale[0],
    -s * pane.scale[1],
    c * pane.scale[1],
    pane.translation[0],
    pane.translation[1],
  ];
}
export function transform3D(m, x, y, z = 0) {
  if (m.length !== 12) return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], z];
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}
export function transform(m, x, y) {
  return transform3D(m, x, y).slice(0, 2);
}
export function paneVertices(pane, matrix) {
  const [w, h] = pane.size,
    left = (-(pane.origin % 3) * w) / 2,
    top = (Math.floor(pane.origin / 3) * h) / 2;
  return [
    [left, top],
    [left + w, top],
    [left, top - h],
    [left + w, top - h],
  ].map(([x, y]) => transform3D(matrix, x, y));
}
export function paneCorners(pane, matrix) {
  return paneVertices(pane, matrix).map((point) => point.slice(0, 2));
}
