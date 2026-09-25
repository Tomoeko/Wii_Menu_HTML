const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function relativeAssetPath(path) {
  if (
    typeof path !== 'string' ||
    !path.length ||
    !/^[A-Za-z0-9_./+-]+$/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('The update preview contains an invalid asset path.');
  }
  return path;
}

export function candidateAssetBase(sessionId) {
  if (!sessionPattern.test(sessionId)) {
    throw new Error('The update preview session is invalid. Scan the NAND again.');
  }
  return `/assets/channel-updates/${sessionId}/`;
}

export function candidateAssetUrl(sessionId, path) {
  return candidateAssetBase(sessionId) + relativeAssetPath(path);
}

export function rebaseCandidateLayout(layout, sessionId) {
  const prefix = candidateAssetBase(sessionId).slice('/assets/'.length);
  const rebase = (descriptor) => {
    if (!descriptor.url) return descriptor;
    return { ...descriptor, url: prefix + relativeAssetPath(descriptor.url) };
  };
  return {
    ...layout,
    textures: layout.textures.map(rebase),
    resourceTextures: Object.fromEntries(
      Object.entries(layout.resourceTextures || {}).map(([name, descriptor]) => [
        name,
        rebase(descriptor),
      ]),
    ),
  };
}
