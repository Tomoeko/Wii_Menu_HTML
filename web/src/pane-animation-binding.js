import { indexLayout } from './animation.js';

/** NW4R forceAddAnimation binds each key's pane and material independently. */
export function createPaneAnimationBinding(layout) {
  const panes = indexLayout(layout).panes;
  return (animation, paneName, prototype = paneName) => {
    if (!animation) return null;
    const material = layout.materials[panes.get(paneName)?.material]?.name;
    const originalMaterial = layout.materials[panes.get(prototype)?.material]?.name;
    return {
      ...animation,
      targets: animation.targets
        .filter((target) => target.name === (target.type ? originalMaterial : prototype))
        .map((target) => ({ ...target, name: target.type ? material : paneName })),
    };
  };
}
