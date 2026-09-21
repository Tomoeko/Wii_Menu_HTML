import {
  defaultStorageFixture,
  defaultStorageState,
  validateStorageFixture,
  validateStorageState,
} from '../web/src/storage-state.js';
import { createValidatedJsonState } from './validated-json-state.mjs';

const storageState = createValidatedJsonState({
  validate: validateStorageState,
  fallback: defaultStorageState,
  maxBytes: 256 * 1024,
  label: 'Local storage state',
});
const storageFixture = createValidatedJsonState({
  validate: validateStorageFixture,
  fallback: defaultStorageFixture,
  maxBytes: 256 * 1024,
  label: 'Local storage fixture',
});

export const readStorageState = storageState.read;
export const writeStorageState = storageState.write;
export const readStorageFixture = storageFixture.read;
