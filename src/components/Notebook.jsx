import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Search, Tags } from 'lucide-react';
import { describeNote, notePaths, noteTitle, searchCatalog, tagQuery, topicsFor } from '../lib/catalog.js';
import { aboutFile, displayDay } from '../lib/publication.js';
import { Dialog } from './Dialogs.jsx';
import { FileIcon } from './Explorer.jsx';

const empty = { notes: new Map(), done: 0, failed: 0, paths: null, access: null };

function useCatalog(access, paths) {
  const [result, setResult] = useState(empty);
  useEffect(() => {
    let active = true;
    async function load() {
      const notes = new Map();
      let failed = 0;
      for (let index = 0; active && index < paths.length; index += 8) {
        const batch = paths.slice(index, index + 8);
        await Promise.all(batch.map(async path => {
          try { notes.set(path, describeNote(path, await access.read(path))); }
          catch { failed++; }
        }));
        if (active) setResult({ access, paths, notes: new Map(notes), done: index + batch.length, failed });
      }
    }
    void load();
    return () => { active = false; };
  }, [access, paths]);
  return result.paths === paths && result.access === access ? result : empty;
}

function NoteLink({ href, onClick, children, className, title }) {
  return <a href={href} className={className} title={title} onClick={event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClick();
  }}>{children}</a>;
}

export function TagButtons({ tags, onTag, counts = false }) {
  if (!tags.length) return null;
  return <ul className="topic-tags" aria-label="Tags">
    {tags.map(item => {
      const label = typeof item === 'string' ? item : item.label;
      return <li key={label}>
        <button type="button" className="topic-tag" onClick={() => onTag(label)}>
          <span aria-hidden="true">#</span>{label}{counts && <small>{item.count}</small>}
        </button>
      </li>;
    })}
  </ul>;
}

export function NotebookHome({ access, profile, heading, nav, onTag, onSearch, onBrowse, onCollection }) {
  const [limit, setLimit] = useState(8);
  const notes = useMemo(() => {
    const about = aboutFile(access.files);
    return notePaths(access.files).filter(path => path !== about)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [access.files]);
  const visible = useMemo(() => notes.slice(0, limit), [notes, limit]);
  const index = useCatalog(access, visible);
  const topics = useMemo(() => topicsFor(index.notes), [index.notes]);
  const entries = [...visible].sort((a, b) => (index.notes.get(b)?.date || '').localeCompare(index.notes.get(a)?.date || '') ||
    visible.indexOf(a) - visible.indexOf(b));

  return <div className="notebook-home">
    <header className="notebook-hero">
      <h1>{heading}</h1>
      {profile.description && <p className="notebook-deck">{profile.description}</p>}
      <div className="notebook-actions">
        <button type="button" className="button primary" onClick={onBrowse}><FolderOpen size={17} /> Browse files</button>
        <button type="button" className="button secondary" onClick={onSearch}><Search size={17} /> Search notebook</button>
      </div>
    </header>
    <div className="notebook-index">
      <section aria-labelledby="writing-heading">
        <div className="notebook-section-heading"><h2 id="writing-heading">Notes</h2><span>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span></div>
        {!notes.length && <p className="panel-empty">This collection has no Markdown notes yet.</p>}
        <ol className="note-index">
          {entries.map(path => {
            const note = index.notes.get(path);
            return <li key={path} className="note-index-row">
              {note?.date && <time dateTime={note.date}>{displayDay(note.date)}</time>}
              <h3><NoteLink href={nav.href(path)} onClick={() => nav.open(path)}>{note?.title || noteTitle(path)}</NoteLink></h3>
              {note?.description && <p>{note.description}</p>}
              <TagButtons tags={note?.tags || []} onTag={onTag} />
            </li>;
          })}
        </ol>
        {limit < notes.length && <button type="button" className="button secondary show-more-notes" onClick={() => setLimit(limit + 8)}>Show more notes</button>}
      </section>
      <aside aria-labelledby="topics-heading" className="home-topics">
        <div className="notebook-section-heading"><h2 id="topics-heading">Topics</h2></div>
        {topics.length ? <TagButtons tags={topics} onTag={onTag} /> :
          <p className="panel-empty">{index.done < visible.length ? 'Finding tags…' : 'Tags appear here as you add them to notes.'}</p>}
        <button type="button" className="text-button collection-link" onClick={onCollection}>Switch collection</button>
      </aside>
    </div>
  </div>;
}

export function SearchDialog({ access, initialQuery, nav, onClose }) {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState('all');
  const [limit, setLimit] = useState(24);
  const paths = useMemo(() => [...access.files.keys()].sort((a, b) => a.localeCompare(b)), [access.files]);
  const markdown = useMemo(() => notePaths(access.files), [access.files]);
  const index = useCatalog(access, markdown);
  const topics = useMemo(() => topicsFor(index.notes), [index.notes]);
  const hits = useMemo(() => searchCatalog(paths, index.notes, query, scope), [paths, index.notes, query, scope]);
  const working = index.done < markdown.length;
  function select(path) {
    nav.open(path);
    onClose();
  }
  return <Dialog title="Search notebook" onClose={onClose} className="search-dialog">
    <form onSubmit={event => { event.preventDefault(); if (hits.length) select(hits[0].path); }}>
      <label className="form-input icon-input search-input"><Search size={19} />
        <input autoFocus type="search" placeholder="Find a title, tag, or passage" aria-label="Search notes, tags, and text" value={query}
          onChange={event => { setQuery(event.target.value); setLimit(24); }} />
      </label>
    </form>
    <div className="search-filters" role="group" aria-label="Search scope">
      {Object.entries({ all: 'All', files: 'Files', tags: 'Tags', content: 'Content' }).map(([value, label]) =>
        <button type="button" key={value} aria-pressed={value === scope} onClick={() => { setScope(value); setLimit(24); }}>{label}</button>)}
    </div>
    {!query.trim() && topics.length > 0 && <section className="search-topics">
      <h3 className="side-label"><Tags size={16} /> Topics</h3>
      <TagButtons tags={topics} counts onTag={tag => { setQuery(tagQuery(tag)); setScope('all'); setLimit(24); }} />
    </section>}
    <p className="search-status" role="status">
      {query.trim() ? hits.length + (hits.length === 1 ? ' result' : ' results') : ''}
      {working ? (query.trim() ? ' · ' : '') + 'Indexing notes ' + index.done + '/' + markdown.length : ''}
      {!working && index.failed ? (query.trim() ? ' · ' : '') + index.failed + ' notes unavailable' : ''}
    </p>
    {query.trim() && !hits.length && !working && <p className="panel-empty">No results for “{query.trim()}”.</p>}
    {hits.length > 0 && <ul className="search-results">
      {hits.slice(0, limit).map(hit => <li key={hit.path}>
        <NoteLink href={nav.href(hit.path)} onClick={() => select(hit.path)} className="search-result" title={hit.path}>
          <FileIcon path={hit.path} size={18} />
          <span><strong>{hit.title}</strong><small>{hit.path}</small>{hit.snippet && <span className="search-snippet">{hit.snippet}</span>}</span>
        </NoteLink>
      </li>)}
    </ul>}
    {hits.length > limit && <button type="button" className="button secondary" onClick={() => setLimit(limit + 24)}>Show more results</button>}
  </Dialog>;
}
