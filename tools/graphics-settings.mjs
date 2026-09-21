import { DEFAULT_GRAPHICS, normalizeGraphics } from '../web/src/graphics.js';
import { readConfiguration, updateConfiguration } from './configuration.mjs';

export async function readGraphicsSettings(file) {
  const configuration = await readConfiguration(file);
  return normalizeGraphics(configuration.graphics);
}

export async function writeGraphicsSettings(file, value) {
  const fields = Object.keys(DEFAULT_GRAPHICS);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length ||
      Object.keys(value).some((key) => !fields.includes(key))) {
    throw new Error('Expected the complete graphics settings.');
  }
  const graphics = normalizeGraphics(value);
  return updateConfiguration(file, (configuration) => {
    configuration.graphics = graphics;
    return graphics;
  });
}
