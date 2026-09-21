import { validateRemoteState } from '../web/src/remote-state.js';
import { createValidatedJsonState } from './validated-json-state.mjs';

const remoteState = createValidatedJsonState({
  validate: validateRemoteState,
  fallback: () => null,
  maxBytes: 4096,
  label: 'Local remote state',
});

export const readRemoteState = remoteState.read;
export const writeRemoteState = remoteState.write;
