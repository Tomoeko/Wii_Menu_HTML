/**
 * Retain the current scene raster without sampling or modifying its RGBA bytes.
 * The snapshot is deliberately limited to the renderer's active framebuffer;
 * it is not a general arbitrary-GL-state copy operation.
 */
export function createFramebufferSnapshot(renderer) {
  const gl = renderer.gl;
  const width = renderer.rasterWidth;
  const height = renderer.rasterHeight;
  const framebuffer = gl.createFramebuffer();
  const renderbuffer = gl.createRenderbuffer();
  const previous = {
    read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
    draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    renderbuffer: gl.getParameter(gl.RENDERBUFFER_BINDING),
    viewport: gl.getParameter(gl.VIEWPORT),
    scissor: gl.isEnabled(gl.SCISSOR_TEST),
    scissorBox: gl.getParameter(gl.SCISSOR_BOX),
  };
  let released = false;

  function restoreSceneState() {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previous.draw);
    gl.viewport(...previous.viewport);
    gl.scissor(...previous.scissorBox);
    if (previous.scissor) gl.enable(gl.SCISSOR_TEST);
    else gl.disable(gl.SCISSOR_TEST);
  }

  function release() {
    if (released) return;
    released = true;
    gl.deleteFramebuffer(framebuffer);
    gl.deleteRenderbuffer(renderbuffer);
  }

  function blit(source, destination) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
    gl.blitFramebuffer(
      0,
      0,
      width,
      height,
      0,
      0,
      width,
      height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }

  try {
    if (!framebuffer || !renderbuffer) throw new Error('Snapshot resources unavailable.');
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Snapshot allocation failed.');
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.framebufferRenderbuffer(
      gl.DRAW_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.RENDERBUFFER,
      renderbuffer,
    );
    if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Snapshot framebuffer is incomplete.');
    gl.disable(gl.SCISSOR_TEST);
    blit(previous.draw, framebuffer);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Snapshot copy failed.');
  } catch (error) {
    release();
    throw error;
  } finally {
    gl.bindRenderbuffer(gl.RENDERBUFFER, previous.renderbuffer);
    restoreSceneState();
  }

  return {
    width,
    height,
    restore() {
      if (released) throw new Error('Snapshot has been released.');
      if (renderer.rasterWidth !== width || renderer.rasterHeight !== height)
        throw new Error('Snapshot dimensions changed.');
      gl.disable(gl.SCISSOR_TEST);
      blit(framebuffer, previous.draw);
      restoreSceneState();
    },
    release,
  };
}
