import { Renderer } from '../../src/renderer.js';
import { createDisplay } from '../../src/display.js';

/** Sample effective arrow visibility through the actual renderer hierarchy. */
export function renderedArrow(layout, side = 'R') {
  const renderer = Object.create(Renderer.prototype);
  renderer.display = createDisplay();
  renderer.bounds = new Map();
  const drawn = new Map();
  renderer.window = () => {};
  renderer.quad = (source, pane, _matrix, alpha) => {
    const material = source.materials[pane.material];
    drawn.set(pane.name, alpha * material.colors[1][3]);
  };
  renderer.draw(layout);
  return {
    bubble: drawn.get(`ArwBtn${side}`) ?? 0,
    pressed: drawn.get(`ArwBtn${side}_Ac`) ?? 0,
    hit: renderer.rect(`B_Arw${side}`),
  };
}
