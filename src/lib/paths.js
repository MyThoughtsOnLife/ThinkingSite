import { baseName, decodeSafe, dirName, extOf } from './source-utils.js';

export { baseName, dirName };
const markdown = new Set(['md', 'markdown', 'mdx']);
const images = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
const text = new Set(['txt', 'css', 'js', 'mjs', 'ts', 'json', 'csv', 'yaml', 'yml', 'toml', 'xml', 'ini', 'sh', 'py', 'rst']);

export function fileKind(path) {
  const ext = extOf(path);
  if (markdown.has(ext)) return 'markdown';
  if (images.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (text.has(ext) || /^(LICENSE|Makefile|Dockerfile|\.gitignore|\.nojekyll)$/i.test(baseName(path))) return 'text';
  return 'file';
}

export function validatePath(path) {
  if (!path || /[\u0000-\u001f\\]/u.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new Error('Enter a file path such as notes/First note.md.');
  }
  return path;
}

export const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const scheme = /^[a-z][a-z0-9+.-]*:/i;
export const externalTarget = target => scheme.test(target) || target.startsWith('//');
export const webTarget = target => /^(https?:\/\/|\/\/)/i.test(target);

export function splitTarget(target) {
  const index = target.indexOf('#');
  const filename = index < 0 ? target : target.slice(0, index);
  return {
    filename: filename.split('?')[0],
    anchor: index < 0 ? '' : decodeSafe(target.slice(index + 1))
  };
}

// Resolve repository links without treating an encoded slash or dot as a real directory traversal.
export function pathFromLink(link, current, suffix = false) {
  if (!link) return current;
  if (externalTarget(link)) return null;
  const parts = link.startsWith('/') ? [] : dirName(current).split('/').filter(Boolean);
  for (const segment of link.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    const name = decodeSafe(segment);
    if (name === '.' || name === '..' || /[/\\\u0000]/u.test(name)) return null;
    parts.push(name);
  }
  return parts.join('/') + (suffix ? '/' : '');
}

export function resolvePath(files, target, current, wiki = false) {
  const { filename, anchor } = splitTarget(target.trim());
  const relative = pathFromLink(filename, current);
  if (relative === null) return null;
  const exact = [relative];
  if (wiki && filename && !filename.startsWith('.') && !filename.startsWith('/')) {
    const root = pathFromLink('/' + filename, '');
    if (root) exact.push(root);
  }
  for (const path of exact) {
    if (files.has(path)) return { path, anchor };
    for (const ext of ['.md', '.markdown']) {
      if (wiki && files.has(path + ext)) return { path: path + ext, anchor };
    }
    for (const name of ['README.md', 'readme.md', 'index.md']) {
      const candidate = path ? path + '/' + name : name;
      if (files.has(candidate)) return { path: candidate, anchor };
    }
  }
  if (wiki && filename && !filename.includes('/')) {
    const basename = decodeSafe(filename).toLowerCase();
    const matches = new Set([basename, basename + '.md', basename + '.markdown']);
    const path = [...files.keys()].filter(path => matches.has(baseName(path).toLowerCase()))
      .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    if (path) return { path, anchor };
  }
  return null;
}

export function isHiddenNotebookPath(path) {
  return /^readme(?:\.[^/]+)?$/i.test(path) || path.split('/').some(part => part.startsWith('.'));
}

export function notebookFiles(files) {
  return new Map([...files].filter(([path]) => !isHiddenNotebookPath(path)));
}

export function preferredFile(files) {
  const markdown = [...files.keys()].filter(path => fileKind(path) === 'markdown');
  return markdown.find(path => /^readme\.(md|markdown)$/i.test(path)) ??
    markdown.find(path => /^index\.(md|markdown)$/i.test(path)) ??
    markdown.sort((a, b) => a.localeCompare(b))[0] ?? files.keys().next().value ?? '';
}

export function parentFolders(path) {
  const folders = [];
  while ((path = dirName(path))) folders.push(path);
  return folders;
}

export function makeTree(paths) {
  const root = new Map();
  for (const path of paths) {
    const parts = path.split('/');
    let current = root;
    let prefix = '';
    for (const [index, name] of parts.entries()) {
      prefix += (index ? '/' : '') + name;
      if (!current.has(name)) {
        current.set(name, { path: prefix, name, children: index < parts.length - 1 ? new Map() : null });
      }
      current = current.get(name).children;
    }
  }
  return root;
}

export function pathConflict(files, path, except = '') {
  return [...files.keys()].some(file => file !== except &&
    (file === path || file.startsWith(path + '/') || path.startsWith(file + '/')));
}
