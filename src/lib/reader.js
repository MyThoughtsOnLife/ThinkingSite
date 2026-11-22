import { asText, mimeFor } from './drafts.js';
import { baseName, externalTarget, fileKind, resolvePath, splitTarget, webTarget } from './paths.js';
import { renderMarkdown, replaceEmbed, slugify, splitLinkTarget } from './markdown.js';
import { el } from './source-utils.js';

export function createPreviewScope() {
  let disposed = false;
  const cleanups = [];
  return {
    get active() { return !disposed; },
    add(cleanup) {
      if (disposed) cleanup();
      else cleanups.push(cleanup);
    },
    dispose() {
      disposed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
    }
  };
}

export function findAnchor(root, anchor) {
  if (!root || !anchor) return null;
  const target = anchor.replace(/^#/, '');
  const candidates = [...root.querySelectorAll('[id]')];
  return candidates.find(node => node.id === target) ||
    candidates.find(node => node.id === slugify(target));
}

function mediaError(host, name, error, url) {
  host.classList.add('media-error');
  const text = el('p');
  text.textContent = error.message || 'Could not load ' + name + '.';
  host.replaceChildren(text);
  if (url) {
    const link = el('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open ' + name;
    host.append(link);
  }
}

function objectURL(bytes, path, scope) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(path) }));
  scope.add(() => URL.revokeObjectURL(url));
  return url;
}

function frame(name, width, height) {
  const iframe = el('iframe', 'html-preview');
  iframe.title = name;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.referrerPolicy = 'no-referrer';
  if (width) iframe.style.maxWidth = width + 'px';
  iframe.style.height = (height || 480) + 'px';
  return iframe;
}

export async function mountMedia(host, { path, url, bytes, alt, anchor, width, height, access, scope }) {
  const name = alt || baseName(path);
  const kind = fileKind(path);
  try {
    if (kind === 'image') {
      const figure = el('figure', 'image-preview');
      const image = el('img');
      image.alt = name;
      image.decoding = 'async';
      if (width) image.style.maxWidth = 'min(100%, ' + width + 'px)';
      image.src = url || objectURL(bytes || await access.read(path), path, scope);
      image.addEventListener('error', () => {
        if (scope.active) mediaError(host, name, new Error('Could not load ' + name + '.'), url);
      }, { once: true });
      if (scope.active) {
        figure.append(image);
        host.replaceChildren(figure);
      }
      return;
    }
    if (kind === 'pdf') {
      const [{ mountPdfViewer }, data] = await Promise.all([
        import('./pdf.js'),
        bytes || (url ? fetch(url, { credentials: 'omit' }).then(response => {
          if (!response.ok) throw new Error('The PDF could not be downloaded.');
          return response.arrayBuffer();
        }).then(buffer => new Uint8Array(buffer)) : access.read(path))
      ]);
      if (!scope.active) return;
      if (width) host.style.maxWidth = width + 'px';
      const initialPage = Number(/^page=(\d+)/i.exec(anchor || '')?.[1]) || 1;
      const viewer = await mountPdfViewer(host, { name, bytes: data, height: height || 520, initialPage });
      scope.add(() => viewer.destroy());
      return;
    }
    const iframe = frame(name, width, height);
    if (url) {
      iframe.src = url;
    } else {
      const [{ prepareHtml }, data] = await Promise.all([import('./html-preview.js'), bytes || access.read(path)]);
      iframe.srcdoc = await prepareHtml(asText(data), path, access);
    }
    if (scope.active) host.replaceChildren(iframe);
  } catch (error) {
    if (scope.active) mediaError(host, name, error, url);
  }
}

function loadingTarget(text) {
  const host = el('div', 'media-slot');
  host.textContent = 'Loading ' + text + '…';
  return host;
}

function prepareLinks(root, current, context) {
  for (const link of root.querySelectorAll('a[href], a[data-href]')) {
    const options = context.forNode ? { ...context, ...context.forNode(link) } : context;
    if (link.classList.contains('footnote-jump') || link.classList.contains('footnote-backref')) {
      link.addEventListener('click', event => {
        event.preventDefault();
        const destination = findAnchor(root, link.getAttribute('href'));
        destination?.scrollIntoView({ block: 'nearest' });
        destination?.focus({ preventScroll: true });
      });
      continue;
    }
    const wiki = link.classList.contains('internal-link');
    const target = (wiki ? splitLinkTarget(link.dataset.href || '').target : (link.getAttribute('href') || '')).trim();
    if (externalTarget(target)) {
      if (webTarget(target)) {
        link.href = target;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else if (/^(mailto:|tel:)/i.test(target)) link.href = target;
      else link.removeAttribute('href');
      continue;
    }
    const value = resolvePath(options.access.files, target, current, wiki);
    if (value) {
      link.href = options.href(value.path, value.anchor);
      link.addEventListener('click', event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (!options.isRoot && target.startsWith('#')) {
          findAnchor(root, (options.idPrefix || '') + slugify(value.anchor))?.scrollIntoView({ block: 'start' });
        } else {
          options.open(value.path, value.anchor);
        }
      });
    } else {
      link.href = '#';
      link.classList.add('unresolved-link');
      link.title = 'File unavailable in this revision';
      link.addEventListener('click', event => {
        event.preventDefault();
        options.report('Could not find ' + (target || 'this file') + ' in this revision.');
      });
    }
  }
  for (const button of root.querySelectorAll('.copy-btn')) {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.closest('.code-wrap').querySelector('code').textContent);
        button.textContent = 'Copied';
      } catch {
        context.report('The browser could not access the clipboard.');
      }
    });
  }
}

async function embed(host, target, current, options, wiki, alt = '') {
  const { access, scope, chain } = options;
  const { target: link, display } = wiki ? splitLinkTarget(target) : { target, display: null };
  const size = /^(\d+)(?:x(\d+))?$/.exec(display || '');
  const label = alt || (size ? '' : display);
  const width = size && Math.min(1800, Math.max(128, Number(size[1])));
  const height = size?.[2] && Math.min(1200, Math.max(160, Number(size[2])));
  const isExternal = externalTarget(link);
  const resolved = isExternal ? null : resolvePath(access.files, link, current, wiki);
  if (!resolved && !(isExternal && webTarget(link))) {
    return mediaError(host, link, new Error('Embed unavailable: ' + link));
  }
  const parts = isExternal ? splitTarget(link) : resolved;
  const path = isExternal ? parts.filename : resolved.path;
  const kind = fileKind(path);

  if (kind === 'markdown' && resolved) {
    if (chain.has(path) || chain.size >= 5) {
      return mediaError(host, path, new Error('This note already appears in the embed chain.'));
    }
    try {
      const source = asText(await access.read(path));
      if (!scope.active) return;
      const nested = el('div', 'embedded-note');
      const idPrefix = 'embed-' + options.nextEmbedId() + '-';
      const scratch = el('div', 'embedded-note-content');
      renderMarkdown(scratch, source, { idPrefix });
      if (parts.anchor) {
        const heading = findAnchor(scratch, idPrefix + slugify(parts.anchor));
        if (!heading) {
          return mediaError(host, path, new Error('This section is absent from the embedded note.'));
        }
        let next = heading.nextElementSibling;
        nested.append(heading);
        while (next && !(/^H[1-6]$/.test(next.tagName) && next.tagName <= heading.tagName)) {
          const item = next;
          next = next.nextElementSibling;
          nested.append(item);
        }
      } else nested.append(...scratch.childNodes);
      prepareLinks(nested, path, { ...options, isRoot: false, idPrefix });
      prepareEmbeds(nested, path, { ...options, isRoot: false, idPrefix, chain: new Set([...chain, path]) });
      host.replaceChildren(nested);
    } catch (error) {
      if (scope.active) mediaError(host, path, error);
    }
    return;
  }
  if (resolved && !['pdf', 'html', 'image'].includes(kind)) {
    const name = label || baseName(path);
    const link = el('a');
    link.href = options.href(path, '');
    link.textContent = name;
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      options.open(path, '');
    });
    host.replaceChildren(link);
    return;
  }
  return mountMedia(host, { path, alt: label, anchor: parts.anchor, url: isExternal ? link : '', width, height, access, scope });
}

function prepareEmbeds(root, path, context) {
  for (const span of root.querySelectorAll('span.md-embed[data-embed]')) {
    const options = context.forNode ? { ...context, ...context.forNode(span), forNode: null } : context;
    const target = span.dataset.embed;
    const host = loadingTarget(splitLinkTarget(target).target);
    replaceEmbed(span, host);
    void embed(host, target, path, options, !span.hasAttribute('data-external-embed'));
  }
  for (const image of root.querySelectorAll('img[data-original-src]')) {
    const options = context.forNode ? { ...context, ...context.forNode(image), forNode: null } : context;
    const target = image.dataset.originalSrc;
    const { filename } = splitTarget(target);
    const kind = fileKind(filename);
    if (kind === 'html' || kind === 'pdf') {
      const host = loadingTarget(image.alt || baseName(filename));
      replaceEmbed(image, host);
      void embed(host, target, path, options, false, image.alt);
    } else if (webTarget(target) || /^data:image\//i.test(target)) {
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = target;
    } else {
      const local = resolvePath(options.access.files, target, path);
      const unavailable = () => {
        if (!options.scope.active) return;
        const message = el('span', 'media-error');
        message.textContent = 'Image unavailable: ' + (image.alt || filename);
        image.replaceWith(message);
      };
      if (local && fileKind(local.path) === 'image') {
        options.access.read(local.path).then(bytes => {
          if (!options.scope.active) return;
          image.decoding = 'async';
          image.src = objectURL(bytes, local.path, options.scope);
        }).catch(unavailable);
      } else unavailable();
    }
  }
}

export function mountMarkdown(root, source, path, options) {
  renderMarkdown(root, source, { showProperties: true, omitProperties: options.omitProperties, fields: options.fields });
  const headings = [...root.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
  const outline = headings.filter((heading, index) => heading.tagName !== 'H1' || index > 0)
    .map(heading => ({ id: heading.id, name: heading.textContent, level: Number(heading.tagName[1]) }));
  hydrateMarkdown(root, path, options);
  return outline;
}

export function hydrateMarkdown(root, path, options) {
  let sequence = 0;
  const context = { ...options, isRoot: true, chain: new Set([path]), nextEmbedId: () => ++sequence };
  prepareLinks(root, path, context);
  prepareEmbeds(root, path, context);
}
