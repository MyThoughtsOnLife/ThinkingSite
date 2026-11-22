import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Bold, BookOpen, CalendarDays, Clock3, Download, FilePlus, Heading2, Italic,
  Link2, List, PanelRight, Redo2, Undo2
} from 'lucide-react';
import { Annotation } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap } from '@codemirror/search';
import { asText, download, mimeFor } from '../lib/drafts.js';
import { insertLink, toggleWrap } from '../lib/editor-commands.js';
import { extractFrontmatter, normalizeTags } from '../lib/frontmatter.js';
import { baseName, fileKind } from '../lib/paths.js';
import { createPreviewScope, findAnchor, mountMarkdown, mountMedia } from '../lib/reader.js';
import { displayDay } from '../lib/publication.js';
import { TagButtons } from './Notebook.jsx';

export function MarkdownView({ source, path, access, nav, anchor, onOutline, fields, onTag, compact = false }) {
  const article = useRef(null);
  const title = useRef(null);
  const body = useRef(null);
  const callbacks = useRef(nav);
  callbacks.current = nav;
  const { body: content, props } = extractFrontmatter(source.replace(/\r\n?/g, '\n'));
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(wordCount / 220));
  const getProp = name => typeof props?.[name] === 'string' ? props[name] : '';
  const author = getProp('author');
  const date = displayDay(getProp('date'));
  const labels = normalizeTags(props?.tags);
  const deck = getProp('description') || getProp('summary');

  useLayoutEffect(() => {
    const root = body.current;
    const headline = title.current;
    const scope = createPreviewScope();
    root.replaceChildren();
    if (headline) headline.replaceChildren();
    let outline = mountMarkdown(root, source, path, {
      access,
      scope,
      fields,
      omitProperties: compact ? [] : ['title', 'author', 'date', 'description', 'summary', 'tags'],
      open: (...args) => callbacks.current.open(...args),
      href: (...args) => callbacks.current.href(...args),
      report: message => callbacks.current.report(message)
    });
    if (headline) {
      const first = [...root.children].find(node => !node.matches('.properties, hr'));
      const explicit = extractFrontmatter(source.replace(/\r\n?/g, '\n')).props?.title;
      if (first?.tagName === 'H1' && (typeof explicit !== 'string' || first.textContent === explicit)) {
        headline.append(first);
      } else {
        const heading = document.createElement('h1');
        heading.textContent = typeof explicit === 'string' ? explicit : baseName(path).replace(/\.[^.]+$/, '');
        headline.append(heading);
        if (first?.tagName === 'H1' && first.id) outline = [{ id: first.id, name: first.textContent, level: 1 }, ...outline];
      }
    }
    onOutline?.(outline);
    return () => scope.dispose();
  }, [source, path, access, onOutline, compact, fields]);

  useLayoutEffect(() => {
    if (anchor) findAnchor(article.current, anchor)?.scrollIntoView({ block: 'start' });
  }, [anchor, path, source]);

  return (
    <article className={compact ? 'compact-article' : 'article'} ref={article}>
      {!compact && <header className="article-header">
        <div className="article-title" ref={title} />
        {deck && <p className="article-deck">{deck}</p>}
        <div className="article-meta">
          {author && <span className="article-author"><span className="author-initial">{author.slice(0, 1).toUpperCase()}</span>{author}</span>}
          {date && <span><CalendarDays size={14} />{date}</span>}
          {wordCount > 0 && <span><Clock3 size={14} />{minutes} min read</span>}
        </div>
        {onTag && <TagButtons tags={labels} onTag={onTag} />}
      </header>}
      <div className="markdown-body" ref={body} />
    </article>
  );
}

function MediaView({ path, bytes, access, anchor }) {
  const ref = useRef(null);
  useEffect(() => {
    const host = ref.current;
    const scope = createPreviewScope();
    host.textContent = 'Loading preview…';
    void mountMedia(host, { path, bytes, access, scope, anchor });
    return () => scope.dispose();
  }, [path, bytes, access, anchor]);
  return <div className="standalone-media" ref={ref} />;
}

export function ReadView({ path, bytes, access, nav, anchor, onOutline, fields, onTag }) {
  const kind = fileKind(path);
  if (kind === 'markdown') return <MarkdownView source={asText(bytes)} {...{ path, access, nav, anchor, onOutline, fields, onTag }} />;
  const preview = ['html', 'image', 'pdf'].includes(kind);
  return <article className="article asset-article">
    <header className="article-header asset-header">
      <h1>{baseName(path)}</h1>
      <button type="button" className="button secondary" onClick={() => download(bytes, baseName(path), mimeFor(path))}><Download size={16} /> Download</button>
    </header>
    {preview ? <MediaView {...{ path, bytes, access, anchor }} /> :
      kind === 'text' ? <pre className="text-file"><code>{asText(bytes)}</code></pre> :
        <p>This file is available for download.</p>}
  </article>;
}

function prefixLine(view, prefix) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const exists = line.text.startsWith(prefix);
  view.dispatch({ changes: { from: line.from, to: line.from + (exists ? prefix.length : 0), insert: exists ? '' : prefix } });
  view.focus();
}

const editorSyntax = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--text)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--tok-function)', textDecoration: 'underline' },
  { tag: [tags.monospace, tags.string], color: 'var(--tok-string)' },
  { tag: [tags.quote, tags.comment, tags.meta], color: 'var(--tok-comment)' },
  { tag: [tags.list, tags.processingInstruction], color: 'var(--tok-keyword)' }
]);

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: 1.65 },
  '.cm-content': { fontSize: '14px', padding: '16px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': { backgroundColor: 'var(--chrome)', color: 'var(--faint)', border: '0', padding: '0 4px' },
  '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: 'var(--active-soft)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--select-bg) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-panels, .cm-search input, .cm-search button': { color: 'var(--text)', backgroundColor: 'var(--chrome)', borderColor: 'var(--border)' }
});

const syncEditor = Annotation.define();

export function Writer({ path, source, access, nav, onChange, saved, fields }) {
  const ref = useRef(null);
  const editor = useRef(null);
  const change = useRef(onChange);
  change.current = onChange;
  const kind = fileKind(path);
  const canPreview = kind === 'markdown' || kind === 'html';
  const [preview, setPreview] = useState(kind === 'markdown');
  const deferredSource = useDeferredValue(source);
  const deferredAccess = useDeferredValue(access);
  const deferredBytes = useRef({ text: null, bytes: null });
  if (deferredBytes.current.text !== deferredSource) {
    deferredBytes.current = { text: deferredSource, bytes: new TextEncoder().encode(deferredSource) };
  }

  useEffect(() => {
    const extension = kind === 'markdown' ? markdown({ base: markdownLanguage }) : [];
    const view = new EditorView({
      parent: ref.current,
      doc: source,
      extensions: [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), EditorView.lineWrapping, extension,
        syntaxHighlighting(editorSyntax), editorTheme,
        EditorView.contentAttributes.of({ 'aria-label': 'File source editor', spellcheck: kind === 'markdown' ? 'true' : 'false' }),
        keymap.of([
          { key: 'Mod-b', run: view => { toggleWrap(view, '**'); return true; } },
          { key: 'Mod-i', run: view => { toggleWrap(view, '*'); return true; } },
          { key: 'Mod-k', run: view => { insertLink(view); return true; } },
          ...defaultKeymap, ...historyKeymap, ...searchKeymap
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(syncEditor))) {
            change.current(update.state.doc.toString());
          }
        })
      ]
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
    // The caller keys Writer by repository, revision and path. CodeMirror owns the live document.
  }, [kind]);

  useLayoutEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== source) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, annotations: syncEditor.of(true) });
    }
  }, [source]);

  const command = action => {
    if (editor.current) action(editor.current);
  };
  return <section className="writer" aria-label="File editor">
    <div className="writer-toolbar">
      <div className="format-actions">
        {kind === 'markdown' && <>
          <button type="button" className="icon-button" aria-label="Heading" title="Heading" onClick={() => command(view => prefixLine(view, '## '))}><Heading2 size={18} /></button>
          <button type="button" className="icon-button" aria-label="Bold" title="Bold" onClick={() => command(view => toggleWrap(view, '**'))}><Bold size={16} /></button>
          <button type="button" className="icon-button" aria-label="Italic" title="Italic" onClick={() => command(view => toggleWrap(view, '*'))}><Italic size={16} /></button>
          <button type="button" className="icon-button" aria-label="Insert link" title="Insert link" onClick={() => command(insertLink)}><Link2 size={16} /></button>
          <button type="button" className="icon-button" aria-label="List" title="List" onClick={() => command(view => prefixLine(view, '- '))}><List size={17} /></button>
          <span className="tool-separator" />
        </>}
        <button type="button" className="icon-button" aria-label="Undo" title="Undo" onClick={() => command(undo)}><Undo2 size={16} /></button>
        <button type="button" className="icon-button" aria-label="Redo" title="Redo" onClick={() => command(redo)}><Redo2 size={16} /></button>
      </div>
      {canPreview && <button type="button" className="button secondary preview-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}><PanelRight size={16} /> Preview</button>}
    </div>
    <div className={'writer-panes' + (preview ? ' split' : '')}>
      <div className="source-editor" ref={ref} />
      {preview && <div className="writer-preview" aria-label="Live preview">
        {kind === 'markdown' ? <MarkdownView source={deferredSource} path={path} access={deferredAccess} nav={nav} fields={fields} compact />
          : <MediaView bytes={deferredBytes.current.bytes} path={path} access={deferredAccess} />}
      </div>}
    </div>
    <div className="writer-footer">{saved}</div>
  </section>;
}

export function EmptyContent({ title, children, editing, onOpen }) {
  return <div className="empty-content">
    <span className="empty-icon">{editing ? <FilePlus size={30} /> : <BookOpen size={30} />}</span>
    <h1>{title}</h1>
    {children}
    {onOpen && <button type="button" className="button primary" onClick={onOpen}>{editing ? 'New file' : 'Open a repository'}</button>}
  </div>;
}
