import { extractFrontmatter, normalizeTags } from './frontmatter.js';
import { asText } from './drafts.js';
import { baseName, fileKind } from './paths.js';
import { civilDate } from './publication.js';

const parsedNotes = new WeakMap();

export function noteTitle(path) {
  return baseName(path).replace(/\.(md|markdown|mdx)$/i, '').replace(/[_-]+/g, ' ');
}

function readableExcerpt(value) {
  return value.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, path, label) => label || noteTitle(path))
    .replace(/!?\[([^\]]+)\]\((?:<[^>]+>|[^)]+)\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(?:^|\n)\s*[-*+]\s+/g, ' ')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function describeNote(path, bytes) {
  const cached = parsedNotes.get(bytes);
  if (cached?.path === path) return cached.note;
  const { body, props } = extractFrontmatter(asText(bytes));
  const value = key => typeof props?.[key] === 'string' ? props[key].trim() : '';
  const heading = /^#\s+(.+?)\s*#*$/m.exec(body)?.[1];
  const paragraphs = body.split(/\r?\n\r?\n+/).filter(paragraph => !/^\s*[#>!]/.test(paragraph));
  const note = {
    title: value('title') || heading || noteTitle(path),
    description: value('description') || value('summary') || readableExcerpt(paragraphs[0] || '').slice(0, 165),
    date: civilDate(value('date')),
    tags: normalizeTags(props?.tags),
    body
  };
  parsedNotes.set(bytes, { path, note });
  return note;
}

export function notePaths(files) {
  return [...files.keys()].filter(path => fileKind(path) === 'markdown' && files.get(path).mode !== '120000');
}

export function topicsFor(notes) {
  const topics = new Map();
  for (const note of notes.values()) {
    for (const tag of note.tags) {
      const key = tag.toLowerCase();
      const entry = topics.get(key) || { label: tag, count: 0 };
      topics.set(key, { ...entry, count: entry.count + 1 });
    }
  }
  return [...topics.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export const tagQuery = tag => 'tag:' + JSON.stringify(tag);

export function searchTerms(query) {
  return [...query.trim().matchAll(/(tag:)?(?:"((?:\\.|[^"])*)"|([^\s"]+))/gi)].map(match => ({
    tag: Boolean(match[1]),
    value: (match[2]?.replace(/\\(["\\])/g, '$1') || match[3] || '').toLowerCase()
  })).filter(term => term.value);
}

export function searchCatalog(paths, notes, query, scope = 'all') {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const hits = [];
  for (const path of paths) {
    const note = notes.get(path);
    const title = note?.title || (fileKind(path) === 'markdown' ? noteTitle(path) : baseName(path));
    const filename = (path + ' ' + title).toLowerCase();
    const tags = (note?.tags || []).map(tag => tag.toLowerCase());
    const body = note?.body.toLowerCase() || '';
    let score = 0;
    let contentMatch = '';
    const matches = terms.every(term => {
      const { value } = term;
      if (term.tag || scope === 'tags') {
        const found = tags.some(tag => term.tag ? tag === value : tag.includes(value));
        if (found) score += 3;
        return found;
      }
      if (scope !== 'content' && filename.includes(value)) { score += 5; return true; }
      if (scope === 'all' && tags.some(tag => tag.includes(value))) { score += 3; return true; }
      if (scope !== 'files' && body.includes(value)) { score += 1; contentMatch ||= value; return true; }
      return false;
    });
    if (!matches) continue;
    const position = contentMatch ? body.indexOf(contentMatch) : -1;
    const lines = position >= 0 ? note.body.slice(Math.max(0, position - 45), position + 95)
      .replace(/\s+/g, ' ').trim() : '';
    hits.push({ path, title, note, score, snippet: position > 45 ? '…' + lines + '…' : lines });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
