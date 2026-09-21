import { supersampleScale, usesPresentationPass } from './graphics.js';

const vertexSource = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// This bounded directional filter is independently implemented. It uses local
// contrast and the edge tangent, the same general class of approach described
// in NVIDIA's FXAA paper, without claiming to implement an FXAA quality preset.
const edgeFilterSource = `
float brightness(vec4 color) {
  return dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
}

vec4 smoothEdges(vec2 uv) {
  vec2 pixel = 1.0 / vec2(textureSize(scene, 0));
  vec4 center = compositeAt(uv);
  vec4 northwest = compositeAt(uv + vec2(-pixel.x, pixel.y));
  vec4 northeast = compositeAt(uv + pixel);
  vec4 southwest = compositeAt(uv - pixel);
  vec4 southeast = compositeAt(uv + vec2(pixel.x, -pixel.y));
  float nw = brightness(northwest);
  float ne = brightness(northeast);
  float sw = brightness(southwest);
  float se = brightness(southeast);
  float middle = brightness(center);
  float darkest = min(middle, min(min(nw, ne), min(sw, se)));
  float lightest = max(middle, max(max(nw, ne), max(sw, se)));
  float contrast = lightest - darkest;
  if (contrast < max(0.05, lightest * 0.125)) return center;

  // Smooth along the edge, preserving flat horizontal and vertical strokes.
  vec2 tangent = vec2(sw + se - nw - ne, sw + nw - se - ne);
  float magnitude = max(abs(tangent.x), abs(tangent.y));
  vec4 filtered = center;
  if (magnitude > 0.001) {
    vec2 direction = tangent / magnitude * pixel;
    vec4 inner = (compositeAt(uv - direction * 0.5) +
      compositeAt(uv + direction * 0.5)) * 0.5;
    vec4 outer = (compositeAt(uv - direction * 1.5) +
      compositeAt(uv + direction * 1.5)) * 0.5;
    vec4 wider = (inner + outer) * 0.5;
    float candidate = brightness(wider);
    filtered = candidate < darkest || candidate > lightest ? inner : wider;
  }
  // A small bounded blend catches isolated one-pixel details while retaining
  // their contrast. This option can soften fine text; SSAA remains available.
  vec4 neighbors = (northwest + northeast + southwest + southeast) * 0.25;
  float isolated = abs(brightness(neighbors) - middle) / contrast;
  return mix(filtered, neighbors, clamp((isolated - 0.75) * 0.5, 0.0, 0.125));
}`;

// Dolphin's sharp-bilinear family keeps a fullscreen upscale inexpensive while
// avoiding the wide blur introduced by a generic edge filter. The fractional
// scale also improves common browser-window sizes between native and 2× output;
// downscaled output naturally falls back to ordinary bilinear.
const sharpSamplingSource = `
vec4 sharpSample(sampler2D source, vec2 uv, vec2 sourceSize) {
  vec2 texel = clamp(uv, 0.0, 1.0) * sourceSize;
  vec2 base = floor(texel);
  vec2 fraction = fract(texel);
  float scale = max(max(outputSize.x / sourceSize.x,
    outputSize.y / sourceSize.y), 1.0);
  float range = 0.5 - 0.5 / scale;
  vec2 distanceFromCenter = fraction - 0.5;
  vec2 adjustedFraction = (distanceFromCenter -
    clamp(distanceFromCenter, vec2(-range), vec2(range))) * scale + 0.5;
  return texture(source, (base + adjustedFraction) / sourceSize);
}`;

/**
 * Resolve every supersample, including texture/glyph coverage. Color conversion
 * follows composition so transparent HOME and pointer pixels share one output
 * transform with the Settings page beneath them.
 *
 * The optional NTSC-M matrix follows the SMPTE-C and BT.709 primaries with D65
 * white. Gamma 2.35 is the conventional source assumption used by Dolphin's
 * color-correction option, not a measurement of a particular Wii or monitor.
 */
export function presentationFragmentSource(graphics) {
  const samples = supersampleScale(graphics);
  const convert = graphics.colorCorrection !== 'none';
  const postProcess = graphics.antiAliasing === 'post-process';
  const sourceGamma = Number(graphics.sourceGamma ?? 2.35).toFixed(8);
  const matrix = graphics.colorCorrection === 'ntsc-m' ? `
  linearColor = mat3(
    0.939497226, 0.017755864, -0.001621632,
    0.050226845, 0.965824606, -0.004374006,
    0.010275929, 0.016419530, 1.005995638
  ) * linearColor;` : '';
  return `#version 300 es
precision highp float;
uniform sampler2D scene;
uniform sampler2D background;
uniform bool hasBackground;
uniform vec2 outputSize;
uniform vec2 backgroundSize;
uniform vec2 sceneOutputSize;
out vec4 result;

${sharpSamplingSource}

vec4 composite(ivec2 position) {
  vec4 foreground = texelFetch(scene, position, 0);
  if (!hasBackground) return foreground;
  vec2 uv = (vec2(position) + 0.5) / vec2(textureSize(scene, 0));
  // Uploaded HTML canvases have their first image row at texture v = 0.
  vec4 underneath = sharpSample(background, vec2(uv.x, 1.0 - uv.y), backgroundSize);
  return foreground + underneath * (1.0 - foreground.a);
}
vec4 compositeAt(vec2 uv) {
  vec4 foreground = sharpSample(scene, uv, vec2(textureSize(scene, 0)));
  if (!hasBackground) return foreground;
  vec4 underneath = sharpSample(background, vec2(uv.x, 1.0 - uv.y), backgroundSize);
  return foreground + underneath * (1.0 - foreground.a);
}
${postProcess ? edgeFilterSource : ''}

void main() {
  ${postProcess ? `result = smoothEdges((gl_FragCoord.xy - vec2(0.5)) / outputSize);
  ${convert ? `if (result.a > 0.0) {
    vec3 straightColor = clamp(result.rgb / result.a, 0.0, 1.0);
    result.rgb = pow(straightColor, vec3(${sourceGamma})) * result.a;
  }` : ''}` : `
  if (outputSize.x > sceneOutputSize.x || outputSize.y > sceneOutputSize.y) {
    result = compositeAt((gl_FragCoord.xy - vec2(0.5)) / outputSize);
    ${convert ? `if (result.a > 0.0) {
      vec3 straightColor = clamp(result.rgb / result.a, 0.0, 1.0);
      result.rgb = pow(straightColor, vec3(${sourceGamma})) * result.a;
    }` : ''}
  } else {
    ivec2 origin = ivec2(floor((gl_FragCoord.xy - vec2(0.5)) *
      vec2(textureSize(scene, 0)) / sceneOutputSize));
    vec4 sum = vec4(0.0);
    for (int y = 0; y < ${samples}; y++) {
      for (int x = 0; x < ${samples}; x++) {
        vec4 sampleColor = composite(origin + ivec2(x, y));
        ${convert ? `if (sampleColor.a > 0.0) {
          vec3 straightColor = clamp(sampleColor.rgb / sampleColor.a, 0.0, 1.0);
          sampleColor.rgb = pow(straightColor, vec3(${sourceGamma})) * sampleColor.a;
        }` : ''}
        sum += sampleColor;
      }
    }
    result = sum / ${Number(samples * samples).toFixed(1)};
  }`}
  ${convert ? `if (result.a > 0.0) {
    vec3 linearColor = result.rgb / result.a;${matrix}
    linearColor = clamp(linearColor, 0.0, 1.0);
    vec3 low = 12.92 * linearColor;
    vec3 high = 1.055 * pow(linearColor, vec3(1.0 / 2.4)) - 0.055;
    vec3 encoded = mix(high, low, lessThanEqual(linearColor, vec3(0.0031308)));
    result.rgb = encoded * result.a;
  }` : ''}
}`;
}

function program(gl, fragmentSource) {
  const result = gl.createProgram();
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ]) {
      const shader = gl.createShader(type);
      try {
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(`Graphics presentation shader: ${gl.getShaderInfoLog(shader)}`);
        }
        gl.attachShader(result, shader);
      } finally {
        gl.deleteShader(shader);
      }
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
      throw new Error(`Graphics presentation program: ${gl.getProgramInfoLog(result)}`);
    }
    return result;
  } catch (error) {
    gl.deleteProgram(result);
    throw error;
  }
}

function configureTexture(gl, texture) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createRenderPresentation(gl, graphics) {
  if (!usesPresentationPass(graphics)) return null;
  const presentationProgram = program(gl, presentationFragmentSource(graphics));
  const sceneTexture = gl.createTexture();
  const backgroundTexture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  const vertexArray = gl.createVertexArray();
  if (!sceneTexture || !backgroundTexture || !framebuffer || !vertexArray) {
    gl.deleteTexture(sceneTexture);
    gl.deleteTexture(backgroundTexture);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteVertexArray(vertexArray);
    gl.deleteProgram(presentationProgram);
    throw new Error('This GPU could not allocate the graphics presentation resources.');
  }
  const uniforms = Object.fromEntries([
    'scene', 'background', 'hasBackground', 'outputSize', 'backgroundSize', 'sceneOutputSize',
  ].map((name) => [
    name, gl.getUniformLocation(presentationProgram, name),
  ]));
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  let width = 0;
  let height = 0;
  let backgroundCanvas = null;
  let backgroundRevision = null;
  let backgroundWidth = 1;
  let backgroundHeight = 1;
  let destroyed = false;
  const sceneVertexArray = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  const statistics = { frames: 0, sceneAllocations: 0, backgroundAllocations: 0, backgroundUploads: 0 };

  configureTexture(gl, sceneTexture);
  configureTexture(gl, backgroundTexture);
  // Keep both shader samplers complete, including frames without Settings.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(4));

  return {
    begin(outputWidth, outputHeight) {
      if (destroyed) throw new Error('Graphics presentation has been destroyed.');
      const nextWidth = outputWidth * supersampleScale(graphics);
      const nextHeight = outputHeight * supersampleScale(graphics);
      if (nextWidth > maxSize || nextHeight > maxSize || nextWidth > maxViewport[0] ||
          nextHeight > maxViewport[1]) {
        throw new Error(`Graphics require a ${nextWidth}×${nextHeight} texture, but this GPU ` +
          `supports ${maxSize}×${maxSize} textures and ` +
          `${maxViewport[0]}×${maxViewport[1]} viewports. ` +
          'Reduce graphics resolution or anti-aliasing.');
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (nextWidth !== width || nextHeight !== height) {
        gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, nextWidth, nextHeight, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, null);
        if (gl.getError() !== gl.NO_ERROR) {
          throw new Error(`This GPU could not allocate the ${nextWidth}×${nextHeight} ` +
            'graphics raster. Reduce graphics resolution or anti-aliasing.');
        }
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
          sceneTexture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('The graphics presentation framebuffer is incomplete.');
        }
        width = nextWidth;
        height = nextHeight;
        statistics.sceneAllocations++;
      }
      gl.viewport(0, 0, width, height);
    },
    present(outputWidth, outputHeight, background) {
      if (destroyed || !width || !height) return;
      if (background?.canvas && (backgroundCanvas !== background.canvas ||
          backgroundRevision !== background.revision || background.revision === undefined)) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
        // Renderer output is premultiplied. Preserve it when composing canvases.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        if (backgroundWidth === background.canvas.width &&
            backgroundHeight === background.canvas.height) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, background.canvas);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, background.canvas);
          backgroundWidth = background.canvas.width;
          backgroundHeight = background.canvas.height;
          statistics.backgroundAllocations++;
        }
        // Renderer and Settings upload unpremultiplied source images elsewhere.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        backgroundCanvas = background.canvas;
        backgroundRevision = background.revision;
        statistics.backgroundUploads++;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, outputWidth, outputHeight);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.useProgram(presentationProgram);
      gl.bindVertexArray(vertexArray);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindSampler(0, null);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.uniform1i(uniforms.scene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindSampler(1, null);
      gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
      gl.uniform1i(uniforms.background, 1);
      gl.uniform1i(uniforms.hasBackground, Boolean(background?.canvas));
      gl.uniform2f(uniforms.outputSize, outputWidth, outputHeight);
      gl.uniform2f(uniforms.backgroundSize, backgroundWidth, backgroundHeight);
      gl.uniform2f(uniforms.sceneOutputSize, width / supersampleScale(graphics),
        height / supersampleScale(graphics));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(sceneVertexArray);
      statistics.frames++;
    },
    getStatus: () => ({ ...statistics, maxTextureSize: maxSize, maxViewport: [...maxViewport] }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      gl.deleteTexture(sceneTexture);
      gl.deleteTexture(backgroundTexture);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteVertexArray(vertexArray);
      gl.deleteProgram(presentationProgram);
    },
  };
}
