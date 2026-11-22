import { createStore, get, set } from 'idb-keyval';
import { zip } from 'fflate';
import { MIME, extOf } from './source-utils.js';
import { parentFolders } from './paths.js';

const store = createStore('mdreader-workspaces', 'drafts');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const asText = bytes => decoder.decode(bytes);
export const asBytes = value => typeof value === 'string' ? encoder.encode(value) : value;
export const mimeFor = path => MIME[extOf(path)] || 'application/octet-stream';

export async function readDraft(key) {
  return await get(key, store) || new Map();
}

export function saveDraft(key, changes) {
  return set(key, changes, store);
}

export function applyDraft(base, changes) {
  if (!changes.size) return base;
  const files = new Map(base);
  for (const [path, change] of changes) {
    if (change === null) {
      files.delete(path);
      continue;
    }
    const previous = files.get(path);
    if (!previous) {
      // An upstream file can take a path that was a directory when the draft was created.
      for (const parent of parentFolders(path)) files.delete(parent);
      for (const existing of files.keys()) {
        if (existing.startsWith(path + '/')) files.delete(existing);
      }
    }
    files.set(path, { ...previous, mode: change.mode || previous?.mode, draft: true });
  }
  return files;
}

export async function readFile(repo, revision, changes, path) {
  if (changes.has(path)) {
    const change = changes.get(path);
    if (!change) throw new Error('This file has been removed from the local draft.');
    return asBytes(change.content);
  }
  return repo.bytes(revision, path);
}

export function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportZip(repo, revision, changes, onProgress) {
  const files = [...applyDraft(revision.files, changes)];
  if (!files.length) throw new Error('Add a file before exporting your workspace.');
  const archive = Object.create(null);
  let cursor = 0;
  let completed = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(files.length, 8) }, async () => {
    while (!failure && cursor < files.length) {
      const [path, entry] = files[cursor++];
      try {
        const bytes = await readFile(repo, revision, changes, path);
        const mode = Number.parseInt(entry.mode || '100644', 8);
        archive[path] = [bytes, { os: 3, attrs: (mode << 16) >>> 0, level: /\.(png|jpe?g|webp|pdf|zip)$/i.test(path) ? 0 : 6 }];
        onProgress(++completed, files.length);
      } catch (error) {
        failure ||= new Error('Could not export ' + path + '. ' + error.message);
      }
    }
  }));
  if (failure) throw failure;
  return new Promise((resolve, reject) => {
    zip(archive, (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}
