import { diffArrays, diffWordsWithSpace } from 'diff';
import { renderMarkdown, slugify } from './markdown.js';
import { findAnchor, hydrateMarkdown } from './reader.js';
import { viewURL } from './location.js';
import { notebookFiles } from './paths.js';

const OLD_HEADING_PREFIX = 'comparison-from-';
const atomic = '.md-embed, img, .katex, .code-wrap, .code-fallback, .fnref, .footnotes, input';
const identity = node => node.nodeType === Node.TEXT_NODE ? '#text' : node.tagName;

function attributes(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  return [...node.attributes].filter(attr => attr.name !== 'id').map(attr => [
    attr.name,
    attr.name === 'href' && node.matches('.footnote-jump, .footnote-backref')
      ? attr.value.replace(/^#fn-\d+-/, '#fn-')
      : attr.value
  ]).sort(([a], [b]) => a.localeCompare(b));
}

function comparable(node) {
  return node.nodeType === Node.ELEMENT_NODE && !node.matches(atomic) && !node.querySelector(atomic);
}

function similarTextBlocks(previous, current) {
  if (!previous.matches('p, h1, h2, h3, h4, h5, h6')) return true;
  const before = previous.textContent;
  const after = current.textContent;
  const length = Math.max(before.replace(/\s/g, '').length, after.replace(/\s/g, '').length);
  if (length < 48 || before === after) return true;
  const diff = diffWordsWithSpace(before, after, { timeout: 80 });
  const common = diff?.reduce((total, word) =>
    total + (word.added || word.removed ? 0 : word.value.replace(/\s/g, '').length), 0);
  return common >= length * 0.4;
}

function highlight(node, kind, wrapBlock) {
  // Markdown embed placeholders can replace their parent when hydrated.
  if (wrapBlock || node.nodeType === Node.TEXT_NODE) {
    if (node.nodeType === Node.TEXT_NODE && !node.data.trim()) return node;
    const wrapper = node.ownerDocument.createElement(wrapBlock ? 'div' : kind === 'added' ? 'ins' : 'del');
    wrapper.className = 'revision-' + kind;
    wrapper.append(node);
    return wrapper;
  }
  node.classList.add('revision-' + kind);
  return node;
}

export function mountMarkdownDiff(root, before, after, { repo, path, fields, scope, report }) {
  const document = root.ownerDocument;
  const previous = document.createElement('div');
  const current = document.createElement('div');
  const signatures = new WeakMap();
  const shapes = new Map();
  const removed = new WeakSet();
  const hasSameShape = (a, b) => identity(a) === identity(b) &&
    (identity(a) === '#text' || (comparable(a) && comparable(b) &&
      JSON.stringify(attributes(a)) === JSON.stringify(attributes(b)) && similarTextBlocks(a, b)));

  if (before.source !== null) {
    renderMarkdown(previous, before.source, { showProperties: true, fields, idPrefix: OLD_HEADING_PREFIX });
  }
  if (after.source !== null) renderMarkdown(current, after.source, { showProperties: true, fields });

  function signature(node) {
    if (!signatures.has(node)) {
      const shape = JSON.stringify([
        identity(node), attributes(node), node.nodeValue,
        ...[...node.childNodes].map(signature)
      ]);
      if (!shapes.has(shape)) shapes.set(shape, shapes.size);
      signatures.set(node, shapes.get(shape));
    }
    return signatures.get(node);
  }

  function changed(node, kind, wrapBlock) {
    const marked = highlight(node, kind, wrapBlock);
    if (kind === 'removed') removed.add(marked);
    return marked;
  }

  function patch(a, b) {
    if (a.nodeType === Node.TEXT_NODE) {
      const words = diffWordsWithSpace(a.data, b.data, { timeout: 150 });
      if (!words) return [changed(a, 'removed', false), changed(b, 'added', false)];
      return words.map(word => {
        const text = document.createTextNode(word.value);
        return word.removed ? changed(text, 'removed', false) : word.added ? changed(text, 'added', false) : text;
      });
    }
    const children = node => [...node.childNodes].filter(child =>
      child.nodeType === Node.ELEMENT_NODE || child.nodeType === Node.TEXT_NODE);
    b.replaceChildren(compare(children(a), children(b)));
    if (b.matches('details.properties')) b.open = true;
    return [b];
  }

  function appendChanges(output, left, right, wrapBlocks) {
    const alignment = diffArrays(left, right, { comparator: hasSameShape, timeout: 150 });
    if (!alignment) {
      for (const node of left) output.append(changed(node, 'removed', wrapBlocks));
      for (const node of right) output.append(changed(node, 'added', wrapBlocks));
      return;
    }
    let from = 0;
    let to = 0;
    for (const part of alignment) {
      if (part.removed) {
        for (let index = 0; index < part.count; index++) output.append(changed(left[from++], 'removed', wrapBlocks));
      } else if (part.added) {
        for (let index = 0; index < part.count; index++) output.append(changed(right[to++], 'added', wrapBlocks));
      } else {
        for (let index = 0; index < part.count; index++) output.append(...patch(left[from++], right[to++]));
      }
    }
  }

  function compare(left, right, wrapBlocks = false) {
    const output = document.createDocumentFragment();
    const chunks = diffArrays(left, right, {
      comparator: (a, b) => signature(a) === signature(b),
      timeout: 250
    });
    if (!chunks) {
      for (const node of left) output.append(changed(node, 'removed', wrapBlocks));
      for (const node of right) output.append(changed(node, 'added', wrapBlocks));
      return output;
    }

    let fromIndex = 0;
    let toIndex = 0;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!chunk.added && !chunk.removed) {
        output.append(...right.slice(toIndex, toIndex + chunk.count));
        fromIndex += chunk.count;
        toIndex += chunk.count;
        continue;
      }
      const oldNodes = [];
      const newNodes = [];
      while (index < chunks.length && (chunks[index].added || chunks[index].removed)) {
        const change = chunks[index++];
        if (change.removed) {
          oldNodes.push(...left.slice(fromIndex, fromIndex + change.count));
          fromIndex += change.count;
        } else {
          newNodes.push(...right.slice(toIndex, toIndex + change.count));
          toIndex += change.count;
        }
      }
      index--;
      appendChanges(output, oldNodes, newNodes, wrapBlocks);
    }
    return output;
  }

  const blocks = element => [...element.childNodes].filter(node =>
    node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.data.trim()));
  root.replaceChildren(compare(blocks(previous), blocks(current), true));

  function navigation(snapshot, isOld) {
    const href = (file, anchor) => viewURL(repo, snapshot, file, anchor).href;
    const files = notebookFiles(snapshot.files);
    return {
      access: { files, has: file => files.has(file), read: file => repo.bytes(snapshot, file) },
      href,
      open(file, anchor) {
        const target = file === path && anchor &&
          (isOld && findAnchor(root, OLD_HEADING_PREFIX + slugify(anchor)) || findAnchor(root, anchor));
        if (target) target.scrollIntoView({ block: 'start' });
        else window.location.assign(href(file, anchor));
      }
    };
  }

  const newer = navigation(after.revision, false);
  const older = navigation(before.revision, true);
  hydrateMarkdown(root, path, {
    ...newer,
    forNode(node) {
      for (let element = node; element && element !== root; element = element.parentElement) {
        if (removed.has(element)) return older;
      }
      return newer;
    },
    scope,
    report
  });
}
