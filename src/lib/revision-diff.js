import { diffLines } from 'diff';
import { asText } from './drafts.js';

export async function revisionSource(repo, id, path) {
  const revision = id === repo.latest.id ? repo.latest : await repo.snapshot(id);
  if (!revision.files.has(path)) return { revision, source: null };
  const bytes = await repo.bytes(revision, path);
  if (bytes.length > 1_000_000) throw new Error('This file is over 1 MB. Open each revision to read its source.');
  return { revision, source: asText(bytes).replace(/\r\n?/g, '\n') };
}

export function compareSources(before, after) {
  const changes = diffLines(before ?? '', after ?? '', { timeout: 500 });
  if (!changes) throw new Error('The difference is too large to show. Open each revision to read its source.');
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;
  const groups = changes.map(change => {
    const type = change.added ? 'add' : change.removed ? 'remove' : 'same';
    const lines = change.value.split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (change.added) added += lines.length;
    if (change.removed) removed += lines.length;
    return { type, lines: lines.map(text => ({
      text,
      old: change.added ? null : oldLine++,
      next: change.removed ? null : newLine++
    })) };
  });
  return { groups, added, removed };
}
