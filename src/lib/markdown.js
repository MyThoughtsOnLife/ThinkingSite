import { extractFrontmatter } from './frontmatter.js';
/* Obsidian Markdown rendering adapted from obsidian-editor/src/lib/markdown.js. */
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { $$, el, esc, escAttr } from './source-utils.js';
import { ICONS } from './icons.js';

function sanitize(html) {
  // Keep iframe references as inert data until MdReader installs its own sandbox.
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const frame of template.content.querySelectorAll('iframe, embed, object')) {
    const target = frame.getAttribute('src') || frame.getAttribute('data');
    if (!target) continue;
    const placeholder = el('span', 'md-embed');
    placeholder.dataset.embed = target;
    placeholder.dataset.externalEmbed = '';
    frame.replaceWith(placeholder);
  }
  const wrapper = el('div');
  wrapper.append(template.content);
  DOMPurify.sanitize(wrapper, {
    IN_PLACE: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'button', 'link', 'base'],
    FORBID_ATTR: ['style', 'name', 'srcset', 'target', 'ping', 'autofocus']
  });
  for (const input of wrapper.querySelectorAll('input')) {
    if (input.type === 'checkbox' && input.closest('li')) {
      input.disabled = true;
      input.className = 'task-checkbox';
    } else input.remove();
  }
  for (const image of wrapper.querySelectorAll('img[src]')) {
    image.dataset.originalSrc = image.getAttribute('src');
    image.removeAttribute('src');
  }
  const result = document.createDocumentFragment();
  result.append(...wrapper.childNodes);
  return result;
}

let footnoteSequence = 0;
let footnoteContext = null;
export let markedReady = false;
export function ensureMarked() {
  if (markedReady) return;
  marked.use({ gfm: true, breaks: true, extensions: [embExt, wlExt, hlExt, ulExt, fnExt] });
  markedReady = true;
}

/* ---------- inline extensions ---------- */
export const embExt = {
  name: 'obsembed', level: 'inline',
  start(src) { const i = src.indexOf('![['); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^!\[\[([^\]\n]+?)\]\]/.exec(src);
    if (m) return { type: 'obsembed', raw: m[0], target: m[1].trim() };
  },
  renderer(t) { return '<span class="md-embed" data-embed="' + escAttr(t.target) + '"></span>'; }
};
export const wlExt = {
  name: 'obswikilink', level: 'inline',
  start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\[\[([^\]\n]+?)\]\]/.exec(src);
    if (m) return { type: 'obswikilink', raw: m[0], target: m[1].trim() };
  },
  renderer(t) {
    const p = splitLinkTarget(t.target);
    return '<a class="internal-link" data-href="' + escAttr(t.target) + '" href="#">' + esc(p.display || p.target) + '</a>';
  }
};
export const hlExt = {
  name: 'obshl', level: 'inline',
  start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^==([^\n]+?)==/.exec(src);
    if (m && m[1].trim()) return { type: 'obshl', raw: m[0], text: m[1] };
  },
  renderer(t) { return '<mark>' + esc(t.text) + '</mark>'; }
};
/* underline: ^^text^^ → <u>text</u> (also raw <u> HTML via marked) */
export const ulExt = {
  name: 'obsul', level: 'inline',
  start(src) { const i = src.indexOf('^^'); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\^\^([^\n]+?)\^\^/.exec(src);
    if (m && m[1].trim()) return { type: 'obsul', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(t) { return '<u>' + this.parser.parseInline(t.tokens) + '</u>'; }
};
function inlineFootnote(src) {
  if (!src.startsWith('^[')) return null;
  let brackets = 1;
  for (let i = 2; i < src.length && src[i] !== '\n'; i++) {
    if (src[i] === '\\' && src[i + 1] !== '\n') i++;
    else if (src[i] === '`') {
      const ticks = /^`+/.exec(src.slice(i))[0];
      const rest = src.slice(i + ticks.length).split('\n', 1)[0];
      const end = new RegExp('(?<!`)' + ticks + '(?!`)').exec(rest);
      i += end ? ticks.length * 2 + end.index - 1 : ticks.length - 1;
    } else if (src[i] === '[') brackets++;
    else if (src[i] === ']' && --brackets === 0) {
      const text = src.slice(2, i);
      return text.trim() ? { type: 'fnref', raw: src.slice(0, i + 1), text } : null;
    }
  }
  return null;
}

export function matchFootnote(src) {
  const named = /^\[\^([^\]\s]+)\](?![:(])/.exec(src);
  return named ? { type: 'fnref', raw: named[0], label: named[1] } : inlineFootnote(src);
}

export const fnExt = {
  name: 'fnref', level: 'inline',
  start(src) {
    const index = src.search(/\[\^|\^\[/);
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    if (!this.lexer.state.inLink && !this.lexer.state.inRawBlock) return matchFootnote(src);
  },
  renderer(token) {
    if (!footnoteContext) return esc(token.raw);
    const note = numberFootnote(footnoteContext, token);
    if (!note) return esc(token.raw);
    const id = 'fn-' + footnoteContext.id + '-' + note.num;
    const reference = id + '-ref-' + (note.refs.length + 1);
    note.refs.push(reference);
    return '<sup class="fnref"><a class="footnote-jump" id="' + reference + '" href="#' + id +
      '" aria-label="Footnote ' + note.num + '">[' + note.num + ']</a></sup>';
  }
};
export function splitLinkTarget(t) {
  const bar = t.indexOf('|');
  if (bar > -1) return { target: t.slice(0, bar).trim(), display: t.slice(bar + 1).trim() };
  return { target: t.trim(), display: null };
}

/* ---------- math protection ---------- */
export function protectMath(src, map) {
  const lines = src.split('\n');
  const out = []; let chunk = []; let fence = null;
  const flush = () => { if (chunk.length) { out.push(protectChunk(chunk.join('\n'), map)); chunk = []; } };
  for (const ln of lines) {
    const fm = /^\s*(`{3,}|~{3,})/.exec(ln);
    if (fm) {
      if (!fence) { flush(); fence = fm[1][0]; out.push(ln); }
      else if (ln.trim().split('')[0] === fence && /^\s*(`{3,}|~{3,})\s*$/.test(ln)) { fence = null; out.push(ln); }
      else out.push(ln);
      continue;
    }
    if (fence) out.push(ln); else chunk.push(ln);
  }
  flush();
  return out.join('\n');
}
export function protectChunk(text, map) {
  const put = (tex, disp) => { const id = map.size; map.set(id, { tex: tex, disp: disp }); return '\uE000' + id + '\uE001'; };
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, g) => put(g, true));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (m, g) => put(g, true));
  let out = '', i = 0;
  const re = /\$([^\n$]+?)\$/g; let m;
  while ((m = re.exec(text))) {
    const inner = m[1];
    const bad = !inner.trim() || /^\s/.test(inner) || /\s$/.test(inner);
    if (bad) { out += text.slice(i, m.index + 1); i = m.index + 1; continue; }
    out += text.slice(i, m.index) + put(inner, false);
    i = m.index + m[0].length;
  }
  out += text.slice(i);
  text = out;
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (m, g) => put(g, false));
  return text;
}
export function renderMathIn(root, map) {
  if (!map || !map.size || typeof katex === 'undefined') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      if (n.nodeValue.indexOf('\uE000') === -1) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (p && p.closest('pre, code')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const parts = n.nodeValue.split(/(\uE000\d+\uE001)/);
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      const mm = /^\uE000(\d+)\uE001$/.exec(p);
      if (mm) {
        const it = map.get(+mm[1]);
        const sp = el('span', it.disp ? 'math-block' : 'math-inline');
        if (!String(it.tex).trim()) {
          // an empty $$ $$ renders nothing and would be impossible to click
          sp.classList.add('math-empty');
          sp.textContent = 'Empty math block';
          frag.appendChild(sp);
          continue;
        }
        try { katex.render(it.tex, sp, { throwOnError: false, displayMode: it.disp, strict: 'ignore', output: 'html', fleqn: false }); }
        catch (e) { sp.textContent = it.tex; sp.classList.add('katex-error'); }
        frag.appendChild(sp);
      } else if (p) frag.appendChild(document.createTextNode(p));
    }
    n.parentNode.replaceChild(frag, n);
  }
}

/* ---------- footnotes ---------- */
export function collectFootnotes(src) {
  const defs = new Map();
  const lines = src.split('\n');
  const out = lines.slice();
  let fence = null;
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (comment) {
      comment = !line.includes('-->');
      continue;
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (/^ {0,3}<!--/.test(line)) {
      comment = !line.includes('-->');
      continue;
    }
    if (marker && (marker[1][0] === '~' || !marker[2].includes('`'))) {
      fence = marker[1];
      continue;
    }

    const match = /^( {0,3})\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const [, indent, label, first] = match;
    const unindent = new RegExp('^(?: {' + (indent.length + 2) + '}| {0,' + (indent.length + 1) + '}\\t)');
    const content = [first];
    let end = i;
    for (let next = i + 1; next < lines.length; next++) {
      if (!lines[next].trim()) continue;
      if (!unindent.test(lines[next])) break;
      while (end + 1 < next) { content.push(''); end++; }
      content.push(lines[next].replace(unindent, ''));
      end = next;
    }
    if (!defs.has(label)) {
      defs.set(label, {
        line: i, from: indent.length, to: indent.length + label.length + 4,
        text: content.join('\n'), num: 0, refs: []
      });
    }
    for (; i <= end; i++) out[i] = '';
    i--;
  }
  return { body: out.join('\n'), defs };
}

function numberFootnote(context, { label, text }) {
  const note = label != null ? context.defs.get(label) : { text, refs: [] };
  if (note && !note.num) {
    note.num = context.notes.length + 1;
    context.notes.push(note);
  }
  return note;
}

function insertMarkdown(root, source) {
  let html;
  try { html = marked.parse(source); }
  catch (e) {
    console.error(e);
    html = '<p><em>Could not render this note: ' + esc(e.message) + '</em></p>';
  }
  root.append(sanitize(html));
}

function appendFootnotes(root, context, mathMap) {
  for (const label of context.defs.keys()) numberFootnote(context, { label });
  if (!context.notes.length) return;

  const section = el('section', 'footnotes');
  section.setAttribute('aria-label', 'Footnotes');
  section.appendChild(el('div', 'fn-head', 'Footnotes'));
  const list = el('ol');
  const items = [];
  for (const note of context.notes) {
    const item = el('li');
    item.id = 'fn-' + context.id + '-' + note.num;
    item.tabIndex = -1;
    insertMarkdown(item, protectMath(note.text, mathMap));
    list.appendChild(item);
    items.push(item);
  }
  for (const [index, note] of context.notes.entries()) {
    const paragraph = items[index].lastElementChild;
    const parent = paragraph?.tagName === 'P' ? paragraph : items[index];
    for (const [occurrence, ref] of note.refs.entries()) {
      const back = el('a', 'footnote-backref');
      back.href = '#' + ref;
      back.setAttribute('aria-label', 'Back to reference ' + (occurrence + 1) + ' for footnote ' + note.num);
      back.textContent = note.refs.length > 1 ? '↩' + (occurrence + 1) : '↩';
      parent.append(back);
    }
  }
  section.appendChild(list);
  root.appendChild(section);
}

/* ---------- syntax highlighting ---------- */
export const FALLBACK_LANGS = { mermaid: 1, dataview: 1, dataviewjs: 1, chem: 1, 'jsx-graph': 1, mindmap: 1 };
export const KW = {
  js: 'const let var function return if else for while do class new extends super import export from default async await try catch finally throw typeof instanceof this switch case break continue in of null undefined true false void delete yield static get set interface type enum implements private public protected readonly namespace declare as keyof infer abstract debugger with package',
  py: 'def return if elif else for while class import from as try except finally raise with lambda None True False and or not in is pass break continue global nonlocal assert yield async await del match case',
  c: 'int char float double void long short unsigned signed struct union enum typedef static const return if else for while do switch case break continue default sizeof goto extern inline register volatile public private protected class virtual namespace using template typename new delete this nullptr NULL true false bool operator friend mutable explicit override final uint8_t uint16_t uint32_t int32_t int64_t size_t',
  go: 'func package import return if else for range switch case break continue defer go chan select map struct interface type var const nil true false make new append len cap panic recover goto fallthrough',
  rust: 'fn let mut const static if else for while loop match impl trait struct enum pub use mod crate self super as in ref move async await dyn where unsafe return break continue Some None Ok Err true false',
  java: 'public private protected class interface extends implements static final void int long double float boolean char byte short new return if else for while do switch case break continue try catch finally throw throws this super null true false import package enum abstract synchronized volatile transient instanceof var record sealed permits',
  sql: 'select from where insert into values update set delete create table alter drop join left right inner outer full cross on group by order having limit offset as and or not null primary key foreign references distinct count sum avg min max case when then else end union all exists between like in asc desc',
  bash: 'if then else elif fi for while do done case esac function echo export local return in read cd shift trap set unset source alias exit printf sudo apt git npm node python pip curl wget mkdir rm cp mv ls cat grep sed awk chmod chown tar zip unzip kill ps sleep test',
  yaml: 'true false null yes no on off',
  jsonkw: 'true false null'
};
export function langFamily(lang) {
  if (['js','jsx','ts','tsx','mjs','cjs','javascript','typescript'].indexOf(lang) > -1) return 'js';
  if (['json','jsonc','json5'].indexOf(lang) > -1) return 'json';
  if (['py','python','python3','sage'].indexOf(lang) > -1) return 'py';
  if (['c','cpp','c++','h','hpp','hh','cc','cxx','ino','java','kt','kotlin','swift','cs','csharp','php','dart','scala','groovy','objc'].indexOf(lang) > -1) return 'c';
  if (['go','golang'].indexOf(lang) > -1) return 'go';
  if (['rust','rs'].indexOf(lang) > -1) return 'rust';
  if (['sql','mysql','sqlite','psql','postgres'].indexOf(lang) > -1) return 'sql';
  if (['bash','sh','zsh','shell','console','terminal','powershell','bat'].indexOf(lang) > -1) return 'bash';
  if (['css','scss','less'].indexOf(lang) > -1) return 'css';
  if (['html','xml','svg','vue','svelte','xhtml','plist'].indexOf(lang) > -1) return 'xml';
  if (['yaml','yml','toml','ini','conf','properties','env'].indexOf(lang) > -1) return 'yaml';
  if (['diff','patch'].indexOf(lang) > -1) return 'diff';
  return null;
}
export const escReg = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function markTokens(srcEsc, re, groups) {
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(srcEsc))) {
    out += srcEsc.slice(last, m.index);
    let cls = null;
    for (let gi = 1; gi < m.length; gi++) if (m[gi] != null) { cls = groups[gi - 1]; break; }
    out += cls ? '<span class="' + cls + '">' + m[0] + '</span>' : m[0];
    last = m.index + m[0].length;
    if (!m[0].length) re.lastIndex++;
  }
  return out + srcEsc.slice(last);
}
export function highlight(src, lang) {
  const fam = langFamily(lang);
  if (!fam || src.length > 200000) return esc(src);
  const preEsc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (fam === 'xml') {
    return preEsc
    .replace(/&lt;!--[\s\S]*?--&gt;/g, m => '<span class="tok-c">' + m + '</span>')
    .replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="tok-t">$2</span>')
    .replace(/([\w:-]+)=("[^"]*")/g, '<span class="tok-f">$1</span>=$2');
  }
  if (fam === 'diff') {
    return preEsc.replace(/^([+\-@][^\n]*)/gm, m => {
      const c = m[0] === '+' ? 'tok-s' : m[0] === '-' ? 'tok-k' : 'tok-f';
      return '<span class="' + c + '">' + m + '</span>';
    });
  }
  if (fam === 'json') {
    return markTokens(preEsc,
                      /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
                      ['tok-s', 'tok-t', 'tok-k', 'tok-n']);
  }
  const kw = KW[fam === 'yaml' ? 'yaml' : fam === 'json' ? 'jsonkw' : fam] || '';
  let re, groups;
  switch (fam) {
    case 'py':
      re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(KEYWORDS)\b|\b([a-zA-Z_]\w*)(?=\s*\()/g;
      groups = ['tok-c', 'tok-s', 'tok-n', 'tok-k', 'tok-f']; break;
    case 'sql':
      re = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'\n])*')|\b(\d+(?:\.\d+)?)\b|\b(KEYWORDS)\b/gi;
      groups = ['tok-c', 'tok-s', 'tok-n', 'tok-k']; break;
    case 'css':
      re = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b)|(\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|dvh|s|ms|deg|fr|ch|vmin|vmax)?\b)|([\w-]+)(?=\s*:)/g;
      groups = ['tok-c', 'tok-s', 'tok-k', 'tok-n', 'tok-n', 'tok-f']; break;
    case 'yaml':
      re = /(#[^\n]*)|('(?:[^'\n]|'')*'|"(?:\\.|[^"\\\n])*")|(^[ \t]*[\w.$-]+)(?=\s*:)|\b(KEYWORDS)\b|(\b\d+(?:\.\d+)?\b)/gm;
      groups = ['tok-c', 'tok-s', 'tok-t', 'tok-k', 'tok-n']; break;
    case 'bash':
      re = /(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'[^'\n]*')|(\$\{?[\w@#?*-]+\}?)|\b(KEYWORDS)\b/g;
      groups = ['tok-c', 'tok-s', 'tok-f', 'tok-k']; break;
    default:
      re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(KEYWORDS)\b|\b([A-Z][A-Za-z0-9_]*)\b|\b([a-zA-Z_]\w*)(?=\s*\()/g;
      groups = ['tok-c', 'tok-s', 'tok-n', 'tok-k', 'tok-t', 'tok-f'];
  }
  const reStr = re.source.replace('KEYWORDS', kw.split(' ').map(escReg).join('|'));
  const flags = (fam === 'sql' ? 'gi' : fam === 'yaml' ? 'gm' : 'g');
  return markTokens(preEsc, new RegExp(reStr, flags), groups);
}

/* ---------- post-processing pipeline ---------- */
export function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
}
export function slugHeadings(root) {
  const seen = new Set();
  $$('h1,h2,h3,h4,h5,h6', root).forEach(h => {
    const s = slugify(h.textContent) || 'section';
    let u = s, i = 0;
    while (seen.has(u)) u = s + '-' + (++i);
    seen.add(u);
    h.id = u;
  });
}
export const CALLOUT_ALIAS = { summary: 'abstract', tldr: 'abstract', todo: 'info', hint: 'tip', important: 'tip', check: 'success', done: 'success', faq: 'question', help: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };
export const CALLOUT_META = {
  note: ['pencil', 'Note'], abstract: ['list', 'Abstract'], info: ['info', 'Info'], tip: ['flame', 'Tip'],
  success: ['checkCircle', 'Success'], question: ['help', 'Question'], warning: ['warning', 'Warning'],
  failure: ['x', 'Failure'], danger: ['zap', 'Danger'], bug: ['bug', 'Bug'], example: ['list', 'Example'], quote: ['quote', 'Quote']
};
export function transformCallouts(root) {
  const bqs = $$('blockquote', root);
  for (const bq of bqs) {
    if (bq.__co) continue;
    const firstP = bq.querySelector(':scope > p');
    if (!firstP) continue;
    let tn = firstP.firstChild;
    while (tn && tn.nodeType !== 3) tn = tn.nextSibling;
    if (!tn) continue;
    const mm = /^\s*\[!([a-z-]+)\]([+-]?)\s*(.*)$/i.exec(tn.nodeValue);
    if (!mm) continue;
    bq.__co = true;
    const key = mm[1].toLowerCase();
    const canon = (Object.hasOwn(CALLOUT_ALIAS, key) && CALLOUT_ALIAS[key]) || (Object.hasOwn(CALLOUT_META, key) ? key : 'note');
    const fold = mm[2];
    const title = mm[3].trim();
    tn.nodeValue = title;
    // body = everything after the marker text node (minus a leading <br>)
    const rest = [];
    let nn = tn.nextSibling;
    while (nn) { rest.push(nn); nn = nn.nextSibling; }
    if (rest.length && rest[0].nodeName === 'BR') rest.shift();
    firstP.parentNode.removeChild(firstP);
    const meta = CALLOUT_META[canon];
    const co = el(fold ? 'details' : 'div', 'callout');
    co.dataset.callout = canon;
    const head = el(fold ? 'summary' : 'div', 'callout-title');
    head.innerHTML = (ICONS[meta[0]] || '') + '<span class="callout-ttext">' + esc(title || meta[1]) + '</span>';
    if (fold === '+' || fold === '-') {
      co.classList.add('foldable');
      co.open = fold === '+';
      head.insertAdjacentHTML('beforeend', '<span class="callout-fold">' + (ICONS.chevD || '') + '</span>');
    }
    co.appendChild(head);
    const body = el('div', 'callout-body');
    for (const n of rest) body.appendChild(n);
    while (bq.firstChild) body.appendChild(bq.firstChild);
    co.appendChild(body);
    bq.replaceWith(co);
  }
}
export function wrapTables(root) {
  $$('table', root).forEach(t => {
    if (t.parentElement && t.parentElement.classList.contains('table-wrap')) return;
    const w = el('div', 'table-wrap');
    t.replaceWith(w);
    w.appendChild(t);
  });
}
export function highlightCode(root) {
  $$('pre > code', root).forEach(code => {
    const pre = code.parentElement;
    if (pre.__hl) return;
    pre.__hl = true;
    const m = /language-([\w+#.-]+)/.exec(code.className);
    const lang = m ? m[1].toLowerCase() : '';
    const raw = code.textContent;
    if (Object.hasOwn(FALLBACK_LANGS, lang)) {
      const fb = el('div', 'code-fallback');
      fb.innerHTML = '<div class="cf-head">' + (ICONS.info || '') + '<span>' + esc(lang) + ' source</span></div>';
      const wrap = el('div', 'code-wrap');
      const np = el('pre'); const nc = el('code'); nc.textContent = raw;
      np.appendChild(nc); wrap.appendChild(np);
      fb.appendChild(wrap);
      addCodeHead(wrap, lang);
      pre.replaceWith(fb);
      return;
    }
    if (lang && langFamily(lang) && raw.length < 200000) code.innerHTML = highlight(raw, lang);
    const wrap = el('div', 'code-wrap');
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    addCodeHead(wrap, lang);
  });
}
export function addCodeHead(wrap, lang) {
  const head = el('div', 'code-head');
  head.innerHTML = '<span>' + esc(lang || '') + '</span><button class="copy-btn" type="button">' + (ICONS.copy || '') + 'Copy</button>';
  wrap.insertBefore(head, wrap.firstChild);
}

/* ---------- embeds ---------- */
export function replaceEmbed(sp, built) {
  if (!built) return;
  const p = sp.parentElement;
  if (p && p.tagName === 'P') {
    if (p.childNodes.length === 1) { p.replaceWith(built); return; }
    if (p.childNodes.length === 2 && p.lastChild.nodeName === 'BR' && p.firstChild === sp) { p.replaceWith(built); return; }
    if (p.childNodes.length === 2 && p.firstChild.nodeName === 'BR' && p.lastChild === sp) { p.replaceWith(built); return; }
  }
  sp.replaceWith(built);
}

function fillFields(root, fields) {
  if (!fields) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest('code, pre, script, style')) {
      node.data = node.data.replace(/\{\{\s*(date|age)\s*\}\}/g, (_, key) => fields[key]);
    }
  }
}

export function renderMarkdown(root, source, { showProperties = false, omitProperties = [], idPrefix = '', fields } = {}) {
  ensureMarked();
  const { body, props } = extractFrontmatter(source.replace(/\r\n?/g, '\n'));
  const { body: content, defs } = collectFootnotes(body);
  const mathMap = new Map();
  const context = { defs, notes: [], id: ++footnoteSequence };
  const previous = footnoteContext;
  footnoteContext = context;
  try {
    insertMarkdown(root, protectMath(content, mathMap));
    appendFootnotes(root, context, mathMap);
  } finally {
    footnoteContext = previous;
  }
  fillFields(root, fields);
  slugHeadings(root);
  if (idPrefix) for (const heading of $$('h1,h2,h3,h4,h5,h6', root)) heading.id = idPrefix + heading.id;
  transformCallouts(root);
  wrapTables(root);
  highlightCode(root);
  renderMathIn(root, mathMap);

  const properties = Object.entries(props || {}).filter(([key]) => !omitProperties.includes(key));
  if (showProperties && properties.length) {
    const details = el('details', 'properties');
    details.append(el('summary', '', 'Properties'));
    const list = el('dl');
    for (const [key, value] of properties) {
      const term = el('dt');
      const item = el('dd');
      term.textContent = key;
      if (Array.isArray(value)) item.textContent = value.filter(item => typeof item !== 'object').join(', ');
      else item.textContent = value && typeof value === 'object' ? 'Structured value' : String(value ?? '');
      list.append(term, item);
    }
    details.append(list);
    root.prepend(details);
  }
}
