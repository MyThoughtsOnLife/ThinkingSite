import { isMap, parseDocument } from 'yaml';

function opening(source) {
  return /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(source);
}

export function extractFrontmatter(source) {
  const match = opening(source);
  if (match?.index !== 0) return { body: source, props: null };
  try {
    const document = parseDocument(match[1]);
    const value = document.errors.length ? null : document.toJS({ maxAliasCount: 20 });
    const props = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    return { body: source.slice(match[0].length), props };
  } catch {
    return { body: source.slice(match[0].length), props: null };
  }
}

export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const tags = new Map();
  for (const value of list) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ');
    if (tag && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }
  return [...tags.values()];
}

export function setNoteTags(source, values) {
  const match = opening(source);
  const current = match?.index === 0 ? match : null;
  const document = parseDocument(current?.[1] ?? '');
  if (document.errors.length || (document.contents && !isMap(document.contents))) {
    throw new Error('Fix the YAML frontmatter before updating tags.');
  }
  const tags = normalizeTags(values);
  if (!tags.length && !document.has('tags')) return source;
  if (tags.length) document.set('tags', tags);
  else document.delete('tags');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const body = current ? source.slice(current[0].length) : source.replace(/^\uFEFF/, '');
  const yaml = document.toString({ lineWidth: 0 }).replace(/\n/g, newline);
  return (source.startsWith('\uFEFF') ? '\uFEFF' : '') + '---' + newline + yaml + '---' + newline + body;
}
