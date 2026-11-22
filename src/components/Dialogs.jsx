import { useEffect, useRef, useState } from 'react';
import { FolderOpen, GitFork, Link2, Plus, Upload, X } from 'lucide-react';
import { collections } from '../data/collections.js';

export function Dialog({ title, children, onClose, busy = false, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className={'dialog ' + className} aria-labelledby="dialog-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="dialog-inner">
        <div className="dialog-header"><h2 id="dialog-title">{title}</h2>
          <button type="button" className="icon-button" title="Close dialog" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={21} /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function LibraryDialog({ recent, workspaces, onOpen, onClose, onNew }) {
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [showRef, setShowRef] = useState(false);
  const [status, setStatus] = useState({ busy: false, error: '' });

  async function load(choice) {
    setStatus({ busy: true, error: '' });
    try {
      await onOpen(choice);
      onClose();
    } catch (error) {
      setStatus({ busy: false, error: error.message });
    }
  }
  return (
    <Dialog title="Open a repository" onClose={onClose} busy={status.busy} className="library-dialog">
      <form onSubmit={event => { event.preventDefault(); void load({ url, ref: ref.trim() }); }}>
        <label className="field-label" htmlFor="repo-url">Public GitHub or GitLab URL</label>
        <div className="repository-form">
          <div className="form-input icon-input"><Link2 size={17} /><input id="repo-url" type="text" inputMode="url" required autoFocus
            placeholder="https://github.com/owner/repository" value={url} disabled={status.busy} onChange={event => setUrl(event.target.value)} /></div>
          <button type="submit" className="button primary" disabled={status.busy}>{status.busy ? 'Opening…' : 'Open'}</button>
        </div>
        <button type="button" className="text-button ref-toggle" onClick={() => setShowRef(!showRef)} aria-expanded={showRef}>
          {showRef ? 'Hide branch or tag' : 'Specify a branch or tag'}
        </button>
        {showRef && <input className="form-input ref-input" aria-label="Branch or tag" placeholder="Default branch" value={ref} disabled={status.busy} onChange={event => setRef(event.target.value)} />}
        {status.error && <p className="form-error" role="alert">{status.error}</p>}
      </form>

      <div className="library-section">
        <h3 className="side-label">Collections</h3>
        {collections.map(collection => <button type="button" className="collection" key={collection.name} disabled={status.busy} onClick={() => load(collection)}>
          <span className="collection-icon"><GitFork size={18} /></span>
          <span><strong>{collection.name}</strong><small>{collection.description}</small></span>
        </button>)}
      </div>
      {!!recent.length && <div className="library-section">
        <h3 className="side-label">Recent repositories</h3>
        {recent.map(item => <button type="button" className="collection" key={item.url + '\n' + item.ref} disabled={status.busy} onClick={() => load(item)}>
          <span className="collection-icon"><GitFork size={17} /></span><span><strong>{item.name}</strong><small>{item.url} · {item.ref}</small></span>
        </button>)}
      </div>}
      {!!workspaces.length && <div className="library-section">
        <h3 className="side-label">Local workspaces</h3>
        {workspaces.map(name => <button type="button" className="collection" key={name} disabled={status.busy} onClick={() => load({ local: name })}>
          <span className="collection-icon"><FolderOpen size={17} /></span><span><strong>{name}</strong></span>
        </button>)}
      </div>}
      <div className="dialog-footer"><button type="button" className="button secondary" disabled={status.busy} onClick={onNew}><Plus size={17} /> New workspace</button></div>
    </Dialog>
  );
}

export function InputDialog({ title, label, value: initial, placeholder, button, onClose, onSubmit, hint, optional = false }) {
  const [value, setValue] = useState(initial || '');
  const [status, setStatus] = useState({ busy: false, error: '' });
  async function submit(event) {
    event.preventDefault();
    setStatus({ busy: true, error: '' });
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (error) {
      setStatus({ busy: false, error: error.message });
    }
  }
  return (
    <Dialog title={title} busy={status.busy} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="value-field">{label}</label>
        <input id="value-field" className="form-input" type="text" value={value} placeholder={placeholder} required={!optional}
          disabled={status.busy} autoFocus onChange={event => setValue(event.target.value)} onFocus={event => event.target.select()} />
        {hint && <p className="field-hint">{hint}</p>}
        {status.error && <p className="form-error" role="alert">{status.error}</p>}
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose} disabled={status.busy}>Cancel</button>
          <button className="button primary" type="submit" disabled={status.busy}>{status.busy ? 'Saving…' : button}</button></div>
      </form>
    </Dialog>
  );
}

export function RemoveDialog({ path, onClose, onRemove }) {
  return (
    <Dialog title="Remove file?" onClose={onClose}>
      <p className="dialog-description"><strong>{path}</strong> will be removed from this workspace and its next ZIP export.</p>
      <div className="dialog-footer">
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="button danger" onClick={() => { onRemove(); onClose(); }}>Remove file</button>
      </div>
    </Dialog>
  );
}

export function ImportDialog({ onClose, onImport }) {
  const [status, setStatus] = useState({ busy: false, error: '' });
  async function select(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    setStatus({ busy: true, error: '' });
    try {
      await onImport(files);
      onClose();
    } catch (error) {
      setStatus({ busy: false, error: error.message });
    }
  }
  return (
    <Dialog title="Import files" busy={status.busy} onClose={onClose}>
      <p className="dialog-description">Add files to the current folder, or import a folder and keep its structure.</p>
      <div className="import-options">
        <label className="button secondary upload-choice"><Upload size={17} /> Select files<input type="file" multiple disabled={status.busy} onChange={select} /></label>
        <label className="button secondary upload-choice"><FolderOpen size={17} /> Select folder<input type="file" multiple webkitdirectory="" disabled={status.busy} onChange={select} /></label>
      </div>
      {status.busy && <p role="status">Importing files…</p>}
      {status.error && <p className="form-error" role="alert">{status.error}</p>}
    </Dialog>
  );
}
