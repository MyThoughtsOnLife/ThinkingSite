import { useMemo, useState } from 'react';
import {
  Archive, BookOpen, ChevronDown, ChevronRight, CodeXml, File, FileText, Folder,
  FolderOpen, GitBranch, Image, Library, Plus, Search, Upload, X
} from 'lucide-react';
import { fileKind, makeTree } from '../lib/paths.js';

const fileIcons = { markdown: FileText, text: FileText, image: Image, pdf: FileText, html: CodeXml, file: File };
export function FileIcon({ path, size = 16 }) {
  const kind = fileKind(path);
  const Icon = fileIcons[kind];
  return <Icon size={size} className={'file-icon kind-' + kind} />;
}

function TreeBranch({ nodes, depth, expanded, filtered, selected, changes, onToggle, onOpen }) {
  const sorted = [...nodes.values()].sort((a, b) => Number(Boolean(b.children)) - Number(Boolean(a.children)) ||
    a.name.localeCompare(b.name, undefined, { numeric: true }));
  return (
    <ul className="tree-branch">
      {sorted.map(node => {
        const folder = Boolean(node.children);
        const open = folder && (filtered || expanded.has(node.path));
        const active = selected === node.path;
        const Chevron = open ? ChevronDown : ChevronRight;
        const DirIcon = open ? FolderOpen : Folder;
        return (
          <li key={node.path}>
            <button
              type="button"
              className={'tree-row' + (active ? ' current' : '')}
              style={{ '--depth': depth }}
              aria-expanded={folder ? open : undefined}
              aria-current={active ? 'page' : undefined}
              onClick={() => folder ? onToggle(node.path) : onOpen(node.path)}
              title={node.path}
            >
              {folder ? <><Chevron className="tree-chevron" size={13} /><DirIcon className="folder-icon" size={16} /></>
                : <><span className="tree-chevron" /><FileIcon path={node.path} /></>}
              <span className="tree-label">{node.name}</span>
              {changes?.has(node.path) && <span className="draft-dot" title="Local draft" aria-label="Local draft" />}
            </button>
            {open && <TreeBranch nodes={node.children} depth={depth + 1} {...{ expanded, filtered, selected, changes, onToggle, onOpen }} />}
          </li>
        );
      })}
    </ul>
  );
}

export default function Explorer({
  repo, files, path, expanded, changes, mode, open, onClose, onToggleFolder, onOpenFile, onOpenLibrary, onNew, onImport
}) {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const tree = useMemo(() => makeTree([...files.keys()].filter(path => path.toLowerCase().includes(query))), [files, query]);

  return (
    <aside className={'explorer panel' + (open ? ' mobile-open' : '')} aria-label="Repository file explorer">
      <div className="explorer-inner">
        <div className="side-label-row">
          <h2 className="side-label">Repository</h2>
          <button className="icon-button mobile-close" type="button" title="Close files" aria-label="Close files" onClick={onClose}><X size={18} /></button>
        </div>
        <button type="button" className="repository-card" onClick={onOpenLibrary} title="Switch repository">
          <span className="repository-icon">{repo.provider === 'Local' ? <Archive size={20} /> : <BookOpen size={20} />}</span>
          <span className="repository-label"><strong>{repo.name}</strong><span>{repo.namespace}</span></span>
          <ChevronDown size={15} className="repo-chevron" />
        </button>
        <div className="branch-label" title={repo.ref}><GitBranch size={14} /><span>{repo.ref}</span></div>

        <div className="explorer-tools">
          <div className="side-label-row">
            <h2 className="side-label">Files</h2>
            {mode === 'edit' && <div className="explorer-actions">
              <button className="icon-button" type="button" title="New file" aria-label="New file" onClick={onNew}><Plus size={17} /></button>
              <button className="icon-button" type="button" title="Import files or folder" aria-label="Import files or folder" onClick={onImport}><Upload size={16} /></button>
            </div>}
          </div>
          <label className="file-filter"><Search size={15} /><input placeholder="Filter files" aria-label="Filter files" value={filter} onChange={event => setFilter(event.target.value)} />
            {filter && <button type="button" className="icon-button clear-filter" title="Clear filter" aria-label="Clear filter" onClick={() => setFilter('')}><X size={14} /></button>}
          </label>
        </div>
        <nav className="tree" aria-label="Repository files">
          {tree.size ? <TreeBranch nodes={tree} depth={0} expanded={expanded} filtered={Boolean(query)} selected={path} changes={changes} onToggle={onToggleFolder} onOpen={onOpenFile} />
            : <p className="panel-empty">{query ? 'No matching files.' : 'This workspace is empty.'}</p>}
        </nav>
      </div>
      <div className="explorer-footer">
        <button type="button" className="library-button" onClick={onOpenLibrary}><Library size={17} /> Browse collections</button>
      </div>
    </aside>
  );
}
