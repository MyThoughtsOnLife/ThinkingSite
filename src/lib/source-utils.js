/* DOM and path helpers adapted from obsidian-editor/src/state/vault-core.js. */
export const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
export function esc(s2) {
  return String(s2 == null ? '' : s2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escAttr(s2) {
  return esc(s2).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

export const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus', pdf: 'application/pdf',
  json: 'application/json', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', txt: 'text/plain',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'
};
export function extOf(name) { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); }
export function baseName(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
export function dirName(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
export function decodeSafe(s) { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } }
