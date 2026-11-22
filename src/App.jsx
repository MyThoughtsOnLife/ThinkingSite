import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, BookOpenText, ChevronRight, CircleAlert, Download, GitBranch, Info,
  Library, Link2, PanelLeft, PanelRight, Pencil, Search, SquarePen, Tags, Trash2, X
} from 'lucide-react';
import { collectionFor, primaryCollection, site } from './data/collections.js';
import { tagQuery } from './lib/catalog.js';
import { extractFrontmatter, normalizeTags, setNoteTags } from './lib/frontmatter.js';
import { aboutFile, ageOn, displayDay, localDay, readProfile } from './lib/publication.js';
import { localWorkspace } from './data/workspaces.js';
import { applyDraft, asText, download, exportZip, readDraft, readFile, saveDraft } from './lib/drafts.js';
import { copyURL, locationChoice, viewURL } from './lib/location.js';
import { baseName, dirName, fileKind, isRootReadme, parentFolders, pathConflict, preferredFile, withoutRootReadme, resolvePath, validatePath } from './lib/paths.js';
import { openRepository } from './lib/repository.js';
import { EmptyContent, ReadView, Writer } from './components/Content.jsx';
import { ImportDialog, InputDialog, LibraryDialog, RemoveDialog } from './components/Dialogs.jsx';
import Explorer, { FileIcon } from './components/Explorer.jsx';
import Inspector from './components/Inspector.jsx';
import { NotebookHome, SearchDialog } from './components/Notebook.jsx';
import RevisionComparison from './components/RevisionComparison.jsx';
import ThemeControl from './components/Theme.jsx';

const EMPTY_DRAFT = new Map();
const EMPTY_HISTORY = { items: [], next: null, error: '', loading: true };
const editable = new Set(['markdown', 'html', 'text']);

function savedList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function requestedCollection() {
  const entry = locationChoice();
  return entry.url || entry.local ? entry :
    { ...entry, url: primaryCollection.url, ref: entry.ref || primaryCollection.ref };
}

function remember(key, update) {
  try { localStorage.setItem(key, JSON.stringify(update)); } catch {}
}

function useBytes(repo, revision, path, exists, change, attempt) {
  const [result, setResult] = useState(null);
  const match = result?.repo === repo && result?.revision === revision && result?.path === path && result?.attempt === attempt;
  useEffect(() => {
    if (!repo || !exists || change) return;
    let active = true;
    repo.bytes(revision, path).then(bytes => {
      if (active) setResult({ repo, revision, path, attempt, bytes });
    }).catch(error => {
      if (active) setResult({ repo, revision, path, attempt, error: error.message });
    });
    return () => { active = false; };
  }, [repo, revision, path, exists, change, attempt]);
  return change ? { draft: change } : match ? result : null;
}

function useHistory(repo, path) {
  const [state, setState] = useState(EMPTY_HISTORY);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const matching = state.repo === repo && state.path === path;
  const current = matching ? state : EMPTY_HISTORY;

  const load = useCallback(async (repo, path, page, previous = []) => {
    const id = ++request.current;
    setState({ repo, path, items: previous, next: page > 1 ? page : null, loading: true, error: '' });
    try {
      const { items, next } = await repo.history(path, page);
      if (request.current === id) {
        const previousIds = new Set(previous.map(item => item.id));
        setState({ repo, path, items: [...previous, ...items.filter(item => !previousIds.has(item.id))], next, loading: false, error: '' });
      }
    } catch (error) {
      if (request.current === id) setState({ repo, path, items: previous, next: page > 1 ? page : null, loading: false, error: error.message });
    }
  }, []);

  useEffect(() => {
    if (repo) void load(repo, path, 1);
    return () => { request.current++; };
  }, [repo, path, load, reload]);

  return {
    current,
    more: () => { if (current.next && !current.loading) void load(repo, path, current.next, current.items); },
    retry: () => current.next ? void load(repo, path, current.next, current.items) : setReload(value => value + 1)
  };
}

function Crumb({ repo, path, onHome }) {
  const parts = path ? path.split('/') : [];
  return <div className="breadcrumb" aria-label="Current file path">
    <button className="breadcrumb-root" type="button" onClick={onHome}>{repo.name}</button>
    {parts.map((part, index) => <span className={index === parts.length - 1 ? 'leaf' : ''} key={index}>
      <ChevronRight size={13} aria-hidden="true" />
      {index === parts.length - 1 && <FileIcon path={path} size={15} />}<span title={part}>{part}</span>
    </span>)}
  </div>;
}

export default function App() {
  const [repo, setRepo] = useState(null);
  const [revision, setRevision] = useState(null);
  const [path, setPath] = useState('');
  const [anchor, setAnchor] = useState('');
  const [changes, setChanges] = useState(EMPTY_DRAFT);
  const changesRef = useRef(EMPTY_DRAFT);
  const [expanded, setExpanded] = useState(() => new Set());
  const [mode, setMode] = useState('read');
  const [mobilePanel, setMobilePanel] = useState('');
  const [dialog, setDialog] = useState('');
  const [comparing, setComparing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [today, setToday] = useState(() => localDay());
  const [scope, setScope] = useState('file');
  const [outline, setOutline] = useState([]);
  const [currentHeading, setHeading] = useState('');
  const [versionLoading, setVersionLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const [bootError, setBootError] = useState('');
  const [exporting, setExporting] = useState('');
  const exportLock = useRef(false);
  const [storageStatus, setStorageStatus] = useState('saved');
  const draftSequence = useRef(0);
  const [recent, setRecent] = useState(() => savedList('mdreader:recent'));
  const [local, setLocal] = useState(() => savedList('mdreader:local'));
  const reading = useRef(null);
  const sequence = useRef(0);
  const navigation = useRef(null);
  const nextHistoryAction = useRef('replaceState');

  const latest = !repo || revision.id === repo.latest.id;
  const overlay = latest ? changes : EMPTY_DRAFT;
  const files = useMemo(() => applyDraft(revision?.files || EMPTY_DRAFT, overlay), [revision, overlay]);
  const browsingFiles = useMemo(() => mode === 'read' && repo?.provider !== 'Local' ? withoutRootReadme(files) : files,
    [files, mode, repo]);
  const exists = Boolean(path) && browsingFiles.has(path);
  const about = useMemo(() => aboutFile(files), [files]);
  const metadata = useBytes(repo, revision, '.mdreader.json', files.has('.mdreader.json'), overlay.get('.mdreader.json'), attempt);
  const configured = collectionFor(repo);
  const profile = useMemo(() => {
    const raw = metadata?.draft?.content ?? metadata?.bytes;
    return readProfile(configured || { name: repo?.name }, typeof raw === 'string' ? raw : raw ? asText(raw) : '');
  }, [metadata, configured, repo]);
  const fields = useMemo(() => path && path === about ? {
    date: displayDay(today),
    age: String(ageOn(profile.author.birthDate, today) ?? '—')
  } : undefined, [path, about, today, profile.author.birthDate]);
  const activeChange = overlay.get(path);
  const content = useBytes(repo, revision, path, exists, activeChange, attempt);
  const historyScope = path ? scope : 'repo';
  const history = useHistory(repo, historyScope === 'file' ? path : '');
  const readContent = useMemo(() => {
    if (content?.draft) {
      return typeof content.draft.content === 'string'
        ? new TextEncoder().encode(content.draft.content) : content.draft.content;
    }
    return content?.bytes;
  }, [content?.draft, content?.bytes]);

  const access = useMemo(() => ({
    files: browsingFiles,
    has: file => browsingFiles.has(file),
    read: file => readFile(repo, revision, overlay, file)
  }), [browsingFiles, repo, revision, overlay]);

  const report = useCallback(message => setNotice(message), []);
  const closeDialog = useCallback(() => setDialog(''), []);
  const openLibrary = useCallback(() => setDialog('library'), []);
  const openSearch = useCallback((query = '') => {
    setSearchQuery(query);
    setMobilePanel('');
    setDialog('search');
  }, []);
  const openTag = useCallback(tag => openSearch(tagQuery(tag)), [openSearch]);

  async function openChoice(choice, record = true) {
    const id = ++sequence.current;
    setVersionLoading(false);
    const next = choice.local ? localWorkspace(choice.local) : await openRepository(choice.url, choice.ref);
    const selected = choice.version && choice.version !== next.latest.id ? await next.snapshot?.(choice.version) : null;
    let draft = EMPTY_DRAFT;
    let storageAvailable = true;
    try { draft = await readDraft(next.key); } catch { storageAvailable = false; }
    if (id !== sequence.current) return;
    const snapshot = selected || next.latest;
    const workspaceFiles = applyDraft(snapshot.files, selected ? EMPTY_DRAFT : draft);
    const tree = next.provider === 'Local' ? workspaceFiles : withoutRootReadme(workspaceFiles);
    const requestedPath = choice.path || next.initialPath || '';
    const hiddenReadme = next.provider !== 'Local' && isRootReadme(requestedPath);
    const target = hiddenReadme ? '' : requestedPath;
    const directory = target ? new Map([...tree].filter(([file]) => file.startsWith(target + '/'))) : null;
    const nextPath = target && (tree.has(target) || selected) ? target :
      (target && (resolvePath(tree, '/' + target.split('/').map(encodeURIComponent).join('/'), '')?.path || preferredFile(directory))) ||
      (target || choice.local ? preferredFile(tree) : '');
    draftSequence.current++;
    nextHistoryAction.current = record ? 'pushState' : 'replaceState';
    changesRef.current = draft;
    setStorageStatus(storageAvailable ? 'saved' : 'unavailable');
    setChanges(draft);
    setRepo(next);
    setRevision(snapshot);
    setComparing(false);
    setPath(nextPath);
    setAnchor(hiddenReadme ? '' : choice.anchor || next.anchor || '');
    setExpanded(new Set(parentFolders(nextPath)));
    setMode(next.provider === 'Local' ? 'edit' : 'read');
    setMobilePanel('');
    setScope('file');
    setOutline([]);
    setHeading('');
    if (target && target !== nextPath && !directory?.size) {
      report('Could not find ' + target + ' in this revision.');
    }
    if (next.url && !collectionFor(next)) {
      setRecent(previous => {
        const items = [{ url: next.url, ref: next.ref, name: next.name }, ...previous.filter(item => item.url !== next.url || item.ref !== next.ref)].slice(0, 5);
        remember('mdreader:recent', items);
        return items;
      });
    }
    if (choice.local) {
      setLocal(previous => {
        const items = [...new Set([choice.local, ...previous])];
        remember('mdreader:local', items);
        return items;
      });
    }
  }

  async function openAddress() {
    setBootError('');
    const token = sequence.current + 1;
    try {
      await openChoice(requestedCollection(), false);
    } catch (error) {
      if (sequence.current !== token) return;
      if (repo) report(error.message);
      else setBootError(error.message);
    }
  }

  useEffect(() => {
    void openAddress();
    const onPopState = () => navigation.current();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const update = () => setToday(localDay());
    const timer = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function shortcut(event) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setMobilePanel('');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.target.closest?.('.cm-editor') && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        openSearch();
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [openSearch]);

  useEffect(() => {
    if (!repo) return;
    const url = viewURL(repo, revision, path, anchor);
    const action = nextHistoryAction.current;
    nextHistoryAction.current = 'replaceState';
    if (url.href !== window.location.href) {
      try { window.history[action](null, '', url); } catch {}
    }
  }, [repo, revision, path, anchor]);

  useLayoutEffect(() => {
    if (comparing || !anchor) reading.current?.scrollTo(0, 0);
  }, [path, revision, mode, anchor, comparing]);

  useEffect(() => {
    if (mode !== 'read' || !outline.length) return;
    const host = reading.current;
    if (!host) return;
    function onScroll() {
      const top = host.getBoundingClientRect().top;
      let current = outline[0].id;
      for (const heading of outline) {
        const element = document.getElementById(heading.id);
        if (element && element.getBoundingClientRect().top <= top + 115) current = heading.id;
      }
      const overflow = host.scrollHeight - host.clientHeight;
      setHeading(overflow > 0 && host.scrollTop >= overflow - 4 ? outline.at(-1).id : current);
    }
    onScroll();
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => host.removeEventListener('scroll', onScroll);
  }, [outline, mode]);

  const onOutline = useCallback(values => setOutline(values), []);

  const openFile = useCallback((nextPath, nextAnchor = '', record = true) => {
    if (nextPath !== path || nextAnchor !== anchor) nextHistoryAction.current = record ? 'pushState' : 'replaceState';
    if (nextPath !== path) {
      setComparing(false);
      setOutline([]);
      setHeading('');
      setPath(nextPath);
      setExpanded(previous => new Set([...previous, ...parentFolders(nextPath)]));
    } else if (nextAnchor) {
      const node = document.getElementById(nextAnchor);
      if (node) node.scrollIntoView({ block: 'start' });
    }
    setAnchor(nextAnchor);
    setMobilePanel('');
  }, [path, anchor]);

  function openHome() {
    setMode('read');
    openFile('');
  }

  function openAbout() {
    setMode('read');
    if (about) openFile(about);
  }

  const nav = useMemo(() => ({
    open: openFile,
    href: (nextPath, nextAnchor) => viewURL(repo, revision, nextPath, nextAnchor).href,
    report
  }), [openFile, repo, revision, report]);

  function toggleFolder(folder) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  async function openVersion(id) {
    if (!repo || id === revision.id || !repo.snapshot) return;
    const token = ++sequence.current;
    setComparing(false);
    setVersionLoading(true);
    try {
      const snapshot = id === repo.latest.id ? repo.latest : await repo.snapshot(id);
      if (token !== sequence.current) return;
      setOutline([]);
      setHeading('');
      nextHistoryAction.current = 'pushState';
      setRevision(snapshot);
      setMode('read');
      setMobilePanel('');
      if (isRootReadme(path)) {
        setPath('');
        setAnchor('');
      } else if (!path) {
        setPath(preferredFile(withoutRootReadme(snapshot.files)));
      }
    } catch (error) {
      if (token === sequence.current) report(error.message);
    } finally {
      if (token === sequence.current) setVersionLoading(false);
    }
  }

  navigation.current = async () => {
    const choice = requestedCollection();
    const same = repo && (choice.local ? repo.provider === 'Local' && choice.local === repo.name :
      choice.url.toLowerCase() === repo.url?.toLowerCase() && (!choice.ref || choice.ref === repo.ref));
    if (!same) {
      await openAddress();
      return;
    }
    const token = ++sequence.current;
    const version = choice.version || repo.latest.id;
    try {
      if (version !== revision.id) {
        setVersionLoading(true);
        const snapshot = version === repo.latest.id ? repo.latest : await repo.snapshot(version);
        if (token !== sequence.current) return;
        setOutline([]);
        setHeading('');
        setRevision(snapshot);
      }
      setComparing(false);
      setMode(repo.provider === 'Local' ? 'edit' : 'read');
      if (repo.provider !== 'Local' && isRootReadme(choice.path)) openFile('', '', false);
      else openFile(choice.path, choice.anchor, false);
    } catch (error) {
      if (token === sequence.current) report(error.message);
    } finally {
      if (token === sequence.current) setVersionLoading(false);
    }
  };

  function changeDraft(update) {
    const next = new Map(changesRef.current);
    update(next);
    const token = ++draftSequence.current;
    changesRef.current = next;
    setChanges(next);
    setStorageStatus('saving');
    saveDraft(repo.key, next).then(() => {
      if (draftSequence.current === token) setStorageStatus('saved');
    }).catch(() => {
      if (draftSequence.current === token) setStorageStatus('unavailable');
    });
  }

  function newFile(input) {
    const target = validatePath(/\.[^/]+$/.test(input) ? input : input + '.md');
    if (pathConflict(files, target)) throw new Error('A file or folder already uses that path.');
    const kind = fileKind(target);
    const content = kind === 'markdown' ? '# ' + baseName(target).replace(/\.[^.]+$/, '') + '\n' :
      kind === 'html' ? '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n</head>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>\n' : '';
    changeDraft(next => next.set(target, { content }));
    openFile(target);
  }

  function setTags(input) {
    const source = asText(readContent);
    const tagged = setNoteTags(source, input);
    if (tagged !== source) changeDraft(next => next.set(path, { content: tagged, mode: files.get(path)?.mode }));
  }

  async function moveFile(input) {
    const target = validatePath(input);
    if (target === path) return;
    if (pathConflict(files, target, path)) throw new Error('A file or folder already uses that path.');
    const bytes = await access.read(path);
    const entry = files.get(path);
    changeDraft(next => {
      next.set(target, { content: bytes, mode: entry.mode });
      if (revision.files.has(path)) next.set(path, null);
      else next.delete(path);
    });
    openFile(target);
  }

  function removeFile() {
    changeDraft(next => {
      if (revision.files.has(path)) next.set(path, null);
      else next.delete(path);
    });
    openFile(preferredFile(applyDraft(revision.files, changesRef.current)));
  }

  async function importFiles(incoming) {
    const folder = dirName(path);
    const tree = new Map(files);
    const added = await Promise.all(incoming.map(async file => {
      const relative = file.webkitRelativePath || file.name;
      const target = validatePath(folder ? folder + '/' + relative : relative);
      if (pathConflict(tree, target)) throw new Error('A file or folder already uses ' + target + '.');
      tree.set(target, {});
      return [target, { content: new Uint8Array(await file.arrayBuffer()) }];
    }));
    changeDraft(next => { for (const [path, entry] of added) next.set(path, entry); });
    openFile(added[0][0]);
  }

  async function exportWorkspace() {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting('Preparing…');
    try {
      const bytes = await exportZip(repo, revision, overlay, (done, total) => setExporting(done === total ? 'Compressing…' : done + ' / ' + total));
      const suffix = latest ? '' : '-' + revision.id.slice(0, 7);
      download(bytes, repo.name.replace(/[\\/:*?"<>|]/g, '-') + suffix + '.zip', 'application/zip');
      report('ZIP downloaded.');
    } catch (error) {
      report(error.message);
    } finally {
      exportLock.current = false;
      setExporting('');
    }
  }

  async function share() {
    try {
      await copyURL(viewURL(repo, revision, path, anchor));
      report('Link copied.');
    } catch {
      report('The clipboard is unavailable. Copy the link from the address bar.');
    }
  }

  const canEdit = latest && exists && editable.has(fileKind(path)) && files.get(path)?.mode !== '120000';
  const canShare = repo && window.location.protocol !== 'file:' && repo.provider !== 'Local' && !overlay.size;
  const showRead = mode === 'read' || !canEdit;
  const home = Boolean(repo && !path && mode === 'read' && repo.provider !== 'Local');
  const canCompare = Boolean(path && repo?.snapshot && repo.latest.id && editable.has(fileKind(path)) && files.get(path)?.mode !== '120000');
  const commit = latest ? repo?.tip : history.current.items.find(item => item.id === revision.id);
  const versionAge = ageOn(profile.author.birthDate, commit?.date);
  const collectionHeading = configured === primaryCollection ? site.heading : profile.name || repo?.name;
  const show = (which) => setMobilePanel(mobilePanel === which ? '' : which);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  const closePanel = () => setMobilePanel('');
  const libraryProps = { recent: recent.filter(item => !collectionFor(item)), workspaces: local, onOpen: openChoice, onClose: closeDialog, onNew: () => setDialog('new-workspace') };

  return (
    <div className="app">
      <header className="topbar">
        <div className="site-brand">
          {repo && <button type="button" className="icon-button files-toggle" aria-label="Toggle files" aria-expanded={mobilePanel === 'files'} title="Browse files" onClick={() => show('files')}><PanelLeft size={19} /></button>}
          <button className="brand-link" type="button" onClick={openHome} aria-label="Notebook home">
            <span className="brand-mark"><BookOpenText size={19} strokeWidth={1.65} /></span>
            <span className="brand-name">{site.name}</span>
          </button>
        </div>
        <button type="button" className="open-repo notebook-search" onClick={() => openSearch()} aria-label="Search notebook" disabled={!repo} title="Search notebook">
          <Search size={17} /><span>Search notes, tags, and text</span><kbd>{shortcut}</kbd>
        </button>
        <div className="top-actions">
          {repo && <>
            {about && <button type="button" className="button top-about" aria-label="About" aria-current={path === about ? 'page' : undefined} onClick={openAbout} title="About this notebook"><Info size={17} /><span>About</span></button>}
            <button type="button" className="icon-button top-library" onClick={openLibrary} aria-label="Switch collection" title="Switch collection"><Library size={18} /></button>
            {mode === 'read'
              ? <button type="button" className="button top-mode" aria-label="Edit" disabled={!latest} title={latest ? 'Edit this notebook' : 'Return to the latest version to edit'} onClick={() => {
                setComparing(false);
                setOutline([]);
                if (!path) openFile(preferredFile(browsingFiles) || preferredFile(files));
                setMode('edit');
              }}><SquarePen size={17} /><span>Edit</span></button>
              : <button type="button" className="button top-mode" aria-label="Read" title="Return to reading" onClick={() => {
                setComparing(false);
                if (repo.provider !== 'Local' && isRootReadme(path)) openHome();
                else setMode('read');
              }}><BookOpen size={17} /><span>Read</span></button>}
            <button type="button" className={'button export-button ' + (mode === 'edit' ? 'primary' : 'icon-only')} disabled={Boolean(exporting) || !files.size || versionLoading}
              onClick={exportWorkspace} aria-label="Export ZIP" title="Export the workspace as a ZIP"><Download size={16} /><span>{exporting || 'Export ZIP'}</span></button>
            <button type="button" className="icon-button details-toggle" aria-expanded={mobilePanel === 'details'} aria-label="Toggle history and outline" title="History and outline" onClick={() => show('details')}><PanelRight size={20} /></button>
          </>}
          <ThemeControl />
        </div>
      </header>

      {repo ? <div className={'workspace' + (home ? ' home-view' : '')}>
        {mobilePanel && <button className={'mobile-scrim ' + mobilePanel + '-scrim'} type="button" aria-label="Close sidebar" onClick={closePanel} />}
        <Explorer key={repo.key} {...{ repo, path, expanded, mode }} files={browsingFiles} changes={overlay} open={mobilePanel === 'files'} onClose={closePanel}
          onOpenFile={openFile} onToggleFolder={toggleFolder} onOpenLibrary={openLibrary}
          onNew={() => setDialog('new-file')} onImport={() => setDialog('import')} />

        <section className="reader-pane" aria-label="Document">
          <div className="document-bar">
            <Crumb repo={repo} path={path} onHome={openHome} />
            <div className="document-actions">
              <button type="button" className="icon-button doc-export" disabled={Boolean(exporting) || !files.size || versionLoading}
                onClick={exportWorkspace} aria-label="Export ZIP" title={exporting || 'Export the workspace as a ZIP'}><Download size={16} /></button>
              <button type="button" className="icon-button doc-details" aria-expanded={mobilePanel === 'details'} aria-label="Toggle history and outline"
                title="History and outline" onClick={() => show('details')}><PanelRight size={18} /></button>
              {comparing && <button type="button" className="button close-comparison" onClick={() => setComparing(false)} aria-label="Close comparison" title="Close comparison">
                <X size={16} /><span>Close comparison</span>
              </button>}
              {!comparing && mode === 'edit' && latest && exists && <>
                {fileKind(path) === 'markdown' && readContent && <button type="button" className="button tag-action" title="Edit note tags" aria-label="Edit note tags" onClick={() => setDialog('tags')}><Tags size={16} /><span>Tags</span></button>}
                <button type="button" className="icon-button" title="Rename or move file" aria-label="Rename or move file" onClick={() => setDialog('move')}><Pencil size={16} /></button>
                <button type="button" className="icon-button delete-action" title="Remove file" aria-label="Remove file" onClick={() => setDialog('remove')}><Trash2 size={16} /></button>
              </>}
              {!comparing && mode === 'read' && canShare && <button type="button" className="button share-button" onClick={share} title="Copy a link to this file"><Link2 size={16} /> <span>Share</span></button>}
            </div>
          </div>
          {!latest && <div className="version-banner"><GitBranch size={16} />
            <span>Revision <code>{revision.id.slice(0, 7)}</code>{commit?.date && ' · ' + displayDay(commit.date)}{versionAge !== null && ' · Age ' + versionAge}</span>
            <button type="button" className="text-button" onClick={() => openVersion(repo.latest.id)}>Back to latest</button>
          </div>}
          <main id="reading-pane" className={'reading-pane' + (!comparing && mode === 'edit' && canEdit ? ' writing-pane' : '')} ref={reading}>
            {versionLoading ? <div className="content-status" role="status">Opening revision…</div> :
              comparing ? <RevisionComparison key={repo.key + '\n' + path} {...{ repo, revision, path, fields, report }}
                history={history.current} author={profile.author} onMore={history.more} onRetry={history.retry} /> :
              home ? <NotebookHome key={repo.key + revision.id} {...{ access, profile, nav }} heading={collectionHeading} onTag={openTag}
                onSearch={() => openSearch()} onBrowse={() => show('files')} onCollection={openLibrary} /> :
              !path ? <EmptyContent title={mode === 'edit' ? 'Start with a file' : 'No files to display'}
                editing={mode === 'edit'} onOpen={mode === 'edit' ? () => setDialog('new-file') : openLibrary}>
                <p>{mode === 'edit' ? 'Create a Markdown note or import a folder to start this workspace.' : 'Open a repository with files, or switch to Edit to add one.'}</p>
                {mode === 'edit' && <button type="button" className="text-button" onClick={() => setDialog('import')}>Import files</button>}
              </EmptyContent> :
              !exists ? <EmptyContent title="File unavailable"><p>{baseName(path)} is absent from this revision. Choose another file or return to the latest version.</p></EmptyContent> :
              content?.error ? <div className="content-status" role="alert">{content.error} <button className="text-button" type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div> :
              !readContent ? <div className="content-status" role="status">Loading file…</div> :
              showRead ? <ReadView key={revision.id + '\n' + path} path={path} bytes={readContent} access={access} nav={nav} anchor={anchor} onOutline={onOutline} fields={fields} onTag={openTag} /> :
                <Writer key={repo.key + '\n' + path} path={path} source={typeof activeChange?.content === 'string' ? activeChange.content : asText(readContent)}
                  access={access} nav={nav} fields={fields} onChange={content => changeDraft(next => next.set(path, { content, mode: files.get(path)?.mode }))}
                  saved={storageStatus === 'unavailable' ? 'Browser storage unavailable. Export your changes to keep them.' :
                    storageStatus === 'saving' ? 'Saving…' : activeChange ? 'Draft saved in this browser' : 'Changes are saved in this browser'} />}
          </main>
        </section>

        <Inspector open={mobilePanel === 'details'} onClose={closePanel} outline={mode === 'read' && !comparing ? outline : []} currentHeading={currentHeading}
          onJump={id => openFile(path, id)} history={history.current} scope={historyScope} onScope={value => {
            if (value === 'repo') setComparing(false);
            setScope(value);
          }} activeVersion={revision.id}
          onVersion={openVersion} path={path} latest={latest} onMore={history.more} onRetry={history.retry} onLatest={() => openVersion(repo.latest.id)}
          author={profile.author} comparing={comparing} onCompare={canCompare ? () => {
            setScope('file');
            setMobilePanel('');
            setComparing(!comparing);
          } : null} />
      </div> : <main className="boot-screen" aria-busy={!bootError}>
        {bootError ? <EmptyContent title="Could not open repository" onOpen={openLibrary}>
          <p role="alert">{bootError}</p>
          <button type="button" className="text-button" onClick={openAddress}>Retry</button>
        </EmptyContent> : <span className="content-status" role="status">Opening workspace…</span>}
      </main>}

      {dialog === 'search' && <SearchDialog access={access} initialQuery={searchQuery} nav={nav} onClose={closeDialog} />}
      {dialog === 'tags' && <InputDialog title="Edit note tags" label="Tags" button="Save tags" placeholder="fieldwork, methods"
        optional value={normalizeTags(extractFrontmatter(asText(readContent)).props?.tags).join(', ')} onClose={closeDialog} onSubmit={setTags}
        hint="Use commas to separate tags. Clear the field to remove them." />}
      {dialog === 'library' && <LibraryDialog {...libraryProps} />}
      {dialog === 'new-workspace' && <InputDialog title="New workspace" label="Workspace name" placeholder="My notebook"
        button="Create workspace" onClose={closeDialog} onSubmit={name => openChoice({ local: name })} />}
      {dialog === 'new-file' && <InputDialog title="New file" label="Repository path" placeholder="notes/Untitled.md"
        value={dirName(path) ? dirName(path) + '/Untitled.md' : ''}
        button="Create file" onClose={closeDialog} onSubmit={newFile} hint="Use a slash to create a file inside a folder." />}
      {dialog === 'move' && <InputDialog title="Rename or move file" label="Repository path" value={path}
        button="Save path" onClose={closeDialog} onSubmit={moveFile} />}
      {dialog === 'remove' && <RemoveDialog path={path} onClose={closeDialog} onRemove={removeFile} />}
      {dialog === 'import' && <ImportDialog onClose={closeDialog} onImport={importFiles} />}
      {notice && <div className="toast" role="status"><CircleAlert size={17} /><span>{notice}</span>
        <button type="button" className="icon-button" title="Dismiss message" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button>
      </div>}
    </div>
  );
}
