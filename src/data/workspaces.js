import { validatePath } from '../lib/paths.js';

export function localWorkspace(name) {
  validatePath(name);
  if (name.includes('/')) throw new Error('Use a workspace name without slashes.');
  return {
    key: 'local:' + name,
    name,
    namespace: 'Local workspace',
    provider: 'Local',
    ref: 'main',
    latest: { id: 'local', files: new Map() },
    async bytes() { throw new Error('This file is missing from the local workspace.'); },
    async history() { return { items: [], next: null }; }
  };
}
