import { ExternalLink, GitCommitHorizontal, GitCompareArrows, History, List, X } from 'lucide-react';

import { ageOn, displayDay } from '../lib/publication.js';

export default function Inspector({
  open, onClose, outline, currentHeading, onJump, history, scope, onScope, activeVersion, onVersion,
  path, latest, onMore, onRetry, onLatest, author, comparing, onCompare
}) {
  return (
    <aside className={'inspector panel' + (open ? ' mobile-open' : '')} aria-label="Document navigation and history">
      <button className="icon-button mobile-close inspector-close" type="button" title="Close details" aria-label="Close details" onClick={onClose}><X size={18} /></button>
      {outline.length > 0 && <section className="outline-panel">
        <h2 className="side-label"><List size={16} /> On this page</h2>
        <nav className="outline-links" aria-label="On this page">
          {outline.map(heading => <button key={heading.id} type="button"
            className={currentHeading === heading.id ? 'active' : ''}
            aria-current={currentHeading === heading.id ? 'location' : undefined}
            style={{ '--level': Math.max(0, heading.level - 2) }}
            onClick={() => { onJump(heading.id); onClose(); }}>
            {heading.name}
          </button>)}
        </nav>
      </section>}

      <section className="history-panel">
        <div className="history-title"><h2 className="side-label"><History size={16} /> Git history</h2></div>
        <div className="history-tabs" role="group" aria-label="Git history scope">
          <button type="button" aria-pressed={scope === 'file'} disabled={!path} onClick={() => onScope('file')}>File</button>
          <button type="button" aria-pressed={scope === 'repo'} onClick={() => onScope('repo')}>Repository</button>
        </div>

        {onCompare && <button type="button" className="button compare-button" aria-pressed={comparing} onClick={onCompare}><GitCompareArrows size={16} /> Compare revisions</button>}

        {history.error && <div className="history-error" role="alert">{history.error}<button type="button" className="text-button" onClick={onRetry}>Retry</button></div>}
        {history.loading && !history.items.length && <p className="panel-empty" role="status">Loading history…</p>}
        {!history.loading && !history.items.length && !history.error && <p className="panel-empty">No commits to show.</p>}

        <ol className="commits">
          {history.items.map((commit, index) => {
            const current = activeVersion === commit.id;
            const tip = index === 0 && latest;
            const age = ageOn(author.birthDate, commit.date);
            return (
              <li key={commit.id} className={'commit' + (current || tip ? ' selected' : '')}>
                <span className="commit-marker"><GitCommitHorizontal size={16} /></span>
                <div className="commit-content">
                  <button type="button" className="commit-select" aria-current={current || tip ? 'true' : undefined}
                    onClick={() => onVersion(commit.id)} title={commit.message}>{commit.message.split('\n')[0]}</button>
                  <div className="commit-meta">
                    <time dateTime={commit.date}>{displayDay(commit.date)}</time>
                    {commit.url ? <a href={commit.url} target="_blank" rel="noopener noreferrer" title={'View commit ' + commit.id} aria-label={'View commit ' + commit.id}>
                      <code>{commit.id.slice(0, 7)}</code><ExternalLink size={11} />
                    </a> : <code>{commit.id.slice(0, 7)}</code>}
                  </div>
                  <div className="commit-attribution">
                    {commit.author && <span className="commit-author" title={commit.author}>{commit.author}</span>}
                    {age !== null && <span className="commit-age" title={(author.name || 'The notebook author') + ' at this revision'} aria-label={(author.name || 'Notebook author') + ', age ' + age}>Age {age}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {history.next && <button type="button" className="text-button more-button" onClick={onMore} disabled={history.loading}>
          {history.loading ? 'Loading…' : 'Load more commits'}
        </button>}
        {!latest && <button className="text-button latest-link" type="button" onClick={onLatest}>Back to latest</button>}
      </section>
    </aside>
  );
}
