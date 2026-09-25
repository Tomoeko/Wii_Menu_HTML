/** Read locally prepared sequence resources without host-rate audio decoding. */
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { decodeSequenceWave } from '../../web/src/sequence-resources.js';

export async function readLocalSequenceResources(definitionPath, assets) {
  const definition = JSON.parse(await readFile(definitionPath, 'utf8'));
  if (!Array.isArray(definition.waves) || definition.waves.length > 256) {
    throw new Error('Invalid original sequence instrument resource list.');
  }
  const root = await realpath(assets);
  const waves = await Promise.all(definition.waves.map(async (descriptor) => {
    if (!descriptor.src?.startsWith('/assets/')) throw new Error('Invalid original wave path.');
    const candidate = resolve(root, descriptor.src.slice('/assets/'.length));
    if (!candidate.startsWith(root + sep)) {
      throw new Error('Original wave path escapes the assets root.');
    }
    const path = await realpath(candidate);
    if (!path.startsWith(root + sep)) {
      throw new Error('Original wave path escapes the assets root.');
    }
    const bytes = await readFile(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return decodeSequenceWave(buffer, descriptor);
  }));
  return { definition, waves };
}
