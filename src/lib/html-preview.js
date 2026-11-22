import { parse, parseFragment, serialize } from 'parse5';
import { init, parse as parseImports } from 'es-module-lexer';
import { asText, mimeFor } from './drafts.js';
import { externalTarget, pathFromLink, splitTarget } from './paths.js';
import { extOf } from './source-utils.js';

const FRAME_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https: data:",
  "style-src 'unsafe-inline' https: data:",
  'img-src https: data:',
  'font-src https: data:',
  'media-src https: data:',
  'connect-src https: data:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

const policy = '<meta http-equiv="Content-Security-Policy" content="' + FRAME_POLICY + '">';

function dataURL(bytes, mime) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return 'data:' + mime + ';base64,' + btoa(chunks.join(''));
}

const textURL = (text, mime) => 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text);

async function replaceAsync(text, pattern, replacer) {
  const matches = [...text.matchAll(pattern)];
  const edits = await Promise.all(matches.map(replacer));
  let cursor = 0;
  const parts = [];
  for (const [index, match] of matches.entries()) {
    parts.push(text.slice(cursor, match.index), edits[index]);
    cursor = match.index + match[0].length;
  }
  return parts.join('') + text.slice(cursor);
}

export async function prepareHtml(source, path, access) {
  const doc = parse(source);
  const assets = new Map();
  const moduleAliases = new Map();
  const moduleSources = new Map();

  function relative(target, current) {
    if (!target || target.startsWith('#') || externalTarget(target)) return null;
    return pathFromLink(splitTarget(target).filename, current);
  }

  async function rewriteCSS(css, current, trail) {
    const urls = await replaceAsync(css, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/gi, async match => {
      const url = match[1] ?? match[2] ?? match[3];
      const value = await asset(url, current, trail);
      return value === url ? match[0] : 'url("' + value + '")';
    });
    return replaceAsync(urls, /(@import\s+)(["'])([^"']+)\2/gi, async match => {
      return match[1] + '"' + await asset(match[3], current, trail) + '"';
    });
  }

  async function asset(target, current, trail = new Set()) {
    const file = relative(target, current);
    if (!file || !access.has(file) || trail.has(file)) return target;
    // CSS recursion carries its own visited paths. Cache only leaves so concurrent
    // stylesheets importing one another cannot wait on each other's promise.
    if (extOf(file) === 'css') {
      const bytes = await access.read(file);
      return textURL(await rewriteCSS(asText(bytes), file, new Set([...trail, file])), 'text/css');
    }
    if (!assets.has(file)) {
      assets.set(file, access.read(file).then(bytes =>
        dataURL(bytes, extOf(file) === 'mjs' ? 'text/javascript' : mimeFor(file))));
    }
    const { anchor } = splitTarget(target);
    return await assets.get(file) + (anchor ? '#' + encodeURIComponent(anchor) : '');
  }

  function moduleAlias(file) {
    if (!moduleAliases.has(file)) {
      const name = 'mdreader-preview-file:' + encodeURIComponent(file);
      moduleAliases.set(file, name);
      const source = access.read(file).then(async bytes => {
        if (extOf(file) === 'json') return dataURL(bytes, 'application/json');
        return textURL(await rewriteModule(asText(bytes), file), 'text/javascript');
      });
      source.catch(() => {});
      moduleSources.set(name, source);
    }
    return moduleAliases.get(file);
  }

  async function rewriteModule(script, current) {
    await init();
    const [imports] = parseImports(script);
    const changes = [];
    for (const entry of imports) {
      if (entry.glob || !/^\.{1,2}\/|^\//.test(entry.specifier || '')) continue;
      const file = relative(entry.specifier, current);
      if (!file || !access.has(file)) continue;
      const alias = moduleAlias(file);
      changes.push({ start: entry.start, end: entry.end, value: entry.type === 'dynamic' ? JSON.stringify(alias) : alias });
    }
    for (const { start, end, value } of changes.sort((a, b) => b.start - a.start)) {
      script = script.slice(0, start) + value + script.slice(end);
    }
    return script;
  }

  // Parse the preview as data. Only assign the result to an opaque-origin iframe.
  async function visit(node) {
    if (node.childNodes) {
      node.childNodes = node.childNodes.filter(child => child.tagName !== 'base' &&
        !(child.tagName === 'meta' && child.attrs.some(attr => attr.name === 'http-equiv')));
      await Promise.all(node.childNodes.map(visit));
    }
    if (!node.attrs) return;
    const type = node.attrs.find(attr => attr.name === 'type')?.value.toLowerCase();
    if (node.tagName === 'script' && type === 'module') {
      const src = node.attrs.find(attr => attr.name === 'src');
      const file = src && relative(src.value, path);
      if (file && access.has(file)) {
        node.attrs = node.attrs.filter(attr => !['src', 'integrity', 'crossorigin'].includes(attr.name));
        node.childNodes = [{ nodeName: '#text', value: 'import ' + JSON.stringify(moduleAlias(file)) + ';' }];
      } else if (!src && node.childNodes[0]?.nodeName === '#text') {
        node.childNodes[0].value = await rewriteModule(node.childNodes[0].value, path);
      }
      return;
    }
    if (node.tagName === 'style' && node.childNodes[0]?.nodeName === '#text') {
      node.childNodes[0].value = await rewriteCSS(node.childNodes[0].value, path, new Set());
    }
    let rewritten = false;
    await Promise.all(node.attrs.map(async attr => {
      if (attr.name === 'style') {
        attr.value = await rewriteCSS(attr.value, path, new Set());
      } else if (['src', 'poster', 'href'].includes(attr.name) && node.tagName !== 'a') {
        const target = attr.value;
        attr.value = await asset(target, path);
        rewritten ||= attr.value !== target;
      } else if (attr.name === 'srcset' && !attr.value.includes('data:')) {
        const items = await Promise.all(attr.value.split(',').map(async item => {
          const [src, ...size] = item.trim().split(/\s+/);
          return [await asset(src, path), ...size].join(' ');
        }));
        attr.value = items.join(', ');
      }
    }));
    if (rewritten) node.attrs = node.attrs.filter(attr => !['integrity', 'crossorigin'].includes(attr.name));
  }

  await visit(doc);
  const imports = Object.create(null);
  // Iterating the map also visits module dependencies discovered during rewriting.
  for (const [name, value] of moduleSources) imports[name] = await value;
  const map = moduleSources.size
    ? '<script type="importmap">' + JSON.stringify({ imports }) + '</script>'
    : '';
  const head = doc.childNodes.find(node => node.tagName === 'html').childNodes.find(node => node.tagName === 'head');
  const injected = parseFragment(head, policy + map).childNodes;
  for (const node of injected) node.parentNode = head;
  head.childNodes.unshift(...injected);
  return serialize(doc);
}
