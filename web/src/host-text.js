const WHITE = [255, 255, 255, 255];

/** Placeholder messages must not use an IPL font subset with missing letters. */
export function selectHostTextFont(fonts, text) {
  const preferred = [
    fonts.get('wbf1.brfna'),
    fonts.get('WiiBitmapFontType1.brfnt'),
    ...fonts.values(),
  ];
  return [...new Set(preferred)].find(
    (face) =>
      face &&
      [...text].every((character) => Object.hasOwn(face.font.characters, character.codePointAt(0))),
  );
}

/** Native panes keep their BRFNT binding; only host-authored notices use this path. */
export function createHostText(renderer, display, fonts) {
  const cache = new Map();

  function rasterize(text, size, color) {
    const key = JSON.stringify([text, size, color]);
    if (cache.has(key)) return cache.get(key);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const scale = 2;
    const font = `${size * scale}px system-ui, sans-serif`;
    context.font = font;
    const width = Math.ceil(context.measureText(text).width) + 4;
    canvas.width = Math.min(8192, Math.max(1, width));
    canvas.height = Math.ceil(size * scale * 1.5);
    context.font = font;
    context.textBaseline = 'top';
    context.fillStyle = `rgba(${color.slice(0, 3).join(',')},${color[3] / 255})`;
    context.fillText(text, 2, 0);
    const gl = renderer.gl;
    const texture = gl.createTexture();
    renderer.invalidateGpuState?.();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const resource = Symbol('host notice text');
    renderer.textures.set(resource, texture);
    const result = {
      width: canvas.width / scale,
      height: canvas.height / scale,
      texture,
      resource,
      layout: {
        textures: [{ url: resource }],
        materials: [
          {
            name: 'host notice text',
            colors: [[0, 0, 0, 0], WHITE, WHITE],
            textureMaps: [{ texture: 0, wrapS: 0, wrapT: 0 }],
          },
        ],
      },
    };
    cache.set(key, result);
    if (cache.size > 32) {
      const oldest = cache.keys().next().value;
      const entry = cache.get(oldest);
      gl.deleteTexture(entry.texture);
      renderer.textures.delete(entry.resource);
      cache.delete(oldest);
    }
    return result;
  }

  return {
    draw(text, x, y, size = 22, color = [100, 100, 100, 255], align = 'center') {
      const face = selectHostTextFont(fonts, text);
      if (face) {
        face.draw(text, x - display.halfWidth, display.halfHeight - y, size, { color, align });
        return;
      }
      // A WAD-only setup may have no complete shared font. Use the browser's
      // local system font for this dummy UI, without altering native text panes.
      const entry = rasterize(text, size, color);
      const offset = align === 'center' ? entry.width / 2 : align === 'right' ? entry.width : 0;
      renderer.quad(
        entry.layout,
        {
          origin: 0,
          size: [entry.width, entry.height],
          material: 0,
          vertexColors: [WHITE, WHITE, WHITE, WHITE],
          texCoords: [
            [
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
            ],
          ],
        },
        [1, 0, 0, 1, x - offset - display.halfWidth, display.halfHeight - y],
        1,
      );
    },
  };
}
