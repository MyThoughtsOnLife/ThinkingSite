import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeftRight, GitCompareArrows } from 'lucide-react';
import { mountMarkdownDiff } from '../lib/markdown-diff.js';
import { fileKind } from '../lib/paths.js';
import { createPreviewScope } from '../lib/reader.js';
import { ageOn, displayDay } from '../lib/publication.js';
import { compareSources, revisionSource } from '../lib/revision-diff.js';

function preferredBase(history, active, latest) {
  const commits = history.items;
  const position = active === latest ? 0 : commits.findIndex(commit => commit.id === active);
  return commits[position + 1]?.id ||
    commits.find(commit => commit.id !== active)?.id ||
    (active !== latest ? latest : '');
}

function RevisionSelect({ label, value, onChange, choices, author }) {
  return <label className="revision-choice">
    <span className="field-label">{label}</span>
    <select className="form-input" aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      {!value && <option value="">Choose a revision</option>}
      {choices.map(commit => {
        const age = ageOn(author.birthDate, commit.date);
        return <option value={commit.id} key={commit.id}>
          {[commit.label || commit.message.split('\n')[0], displayDay(commit.date), age === null ? '' : 'Age ' + age, commit.id.slice(0, 7)].filter(Boolean).join(' · ')}
        </option>;
      })}
    </select>
  </label>;
}

function DiffLine({ line, type }) {
  return <div className={'diff-line diff-' + type}>
    <span className="diff-number">{line.old}</span><span className="diff-number">{line.next}</span>
    <span className="diff-code"><b>{type === 'add' ? '+' : type === 'remove' ? '−' : ' '}</b>{line.text || ' '}</span>
  </div>;
}

function DiffGroup({ group, showAll }) {
  if (group.type !== 'same' || group.lines.length <= 12 || showAll) {
    return group.lines.map(line => <DiffLine key={line.old ?? line.next} line={line} type={group.type} />);
  }
  const line = item => <DiffLine key={item.old} line={item} type="same" />;
  return <>
    {group.lines.slice(0, 3).map(line)}
    <div className="diff-gap">{group.lines.length - 6} unchanged lines</div>
    {group.lines.slice(-3).map(line)}
  </>;
}

function MarkdownChanges({ comparison, repo, path, fields, report }) {
  const body = useRef(null);
  const [empty, setEmpty] = useState(false);
  useLayoutEffect(() => {
    const scope = createPreviewScope();
    const root = body.current;
    try {
      mountMarkdownDiff(root, comparison.before, comparison.after, { repo, path, fields, scope, report });
      setEmpty(!root.querySelector('.revision-added, .revision-removed'));
    } catch (error) {
      scope.dispose();
      root.textContent = error.message;
    }
    return () => scope.dispose();
  }, [comparison, repo, path, fields, report]);
  return <>
    {empty && comparison.before.source !== comparison.after.source &&
      <p className="panel-empty" role="status">The source changed without changing the rendered note.</p>}
    <div className="markdown-body compared-markdown" ref={body} aria-label="Markdown changes" />
  </>;
}

export default function RevisionComparison({ repo, path, revision, history, author, fields, report, onMore, onRetry }) {
  const latest = repo.latest.id;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(revision.id);
  const [showAll, setShowAll] = useState(false);
  const markdown = fileKind(path) === 'markdown';
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const base = from || preferredBase(history, to, latest);
  const activeCommit = repo.tip || history.items.find(item => item.id === latest);
  const choices = [
    { ...activeCommit, id: latest, label: 'Latest on ' + repo.ref },
    ...history.items.filter(item => item.id !== latest)
  ];
  if (!choices.some(item => item.id === revision.id)) choices.push({ id: revision.id, label: 'Current revision' });
  const ready = Boolean(base && to && base !== to);
  const shown = result?.base === base && result?.to === to && result?.attempt === attempt ? result : null;

  useEffect(() => {
    if (!ready) return;
    let active = true;
    Promise.all([revisionSource(repo, base, path), revisionSource(repo, to, path)]).then(([before, after]) => {
      if (active) setResult({ base, to, attempt, before, after, diff: compareSources(before.source, after.source) });
    }).catch(error => {
      if (active) setResult({ base, to, attempt, error: error.message });
    });
    return () => { active = false; };
  }, [repo, path, base, to, attempt, ready]);

  const changed = shown?.diff && shown.before.source !== shown.after.source;
  return <article className="article revision-comparison" aria-labelledby="comparison-title">
    <header className="comparison-header">
      <h2 id="comparison-title"><GitCompareArrows size={19} /> Compare revisions</h2>
      <div className="revision-selectors">
        <RevisionSelect label="From" value={base} onChange={setFrom} choices={choices} author={author} />
        <button type="button" className="icon-button swap-revisions" aria-label="Swap revisions" title="Swap revisions" disabled={!ready}
          onClick={() => { setFrom(to); setTo(base); }}><ArrowLeftRight size={18} /></button>
        <RevisionSelect label="To" value={to} onChange={setTo} choices={choices} author={author} />
      </div>
      {history.error && <p className="form-error">{history.error} <button type="button" className="text-button" onClick={onRetry}>Retry history</button></p>}
      {history.next && <button type="button" className="text-button revision-more" onClick={onMore} disabled={history.loading}>
        {history.loading ? 'Loading…' : 'Load older revisions'}
      </button>}
      {changed && <div className="diff-summary">
        <span className="diff-key">
          <span className="diff-added">+{shown.diff.added} added</span>
          <span className="diff-removed">−{shown.diff.removed} removed</span>
          {shown.before.source === null && 'File added'}
          {shown.after.source === null && 'File removed'}
        </span>
        {!markdown && <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Show unchanged lines</label>}
      </div>}
    </header>
    {ready && !shown && <p className="panel-empty" role="status">Comparing revisions…</p>}
    {!ready && <p className="panel-empty" role="status">{history.loading ? 'Loading revisions…' :
      base && base === to ? 'Choose two different revisions to compare.' : 'Only one version of this file is available.'}</p>}
    {shown?.error && <p className="form-error" role="alert">{shown.error} <button type="button" className="text-button" onClick={() => setAttempt(attempt + 1)}>Retry</button></p>}
    {shown?.diff && !changed && <p className="panel-empty" role="status">
      {shown.before.source === null ? 'The file is absent from both revisions.' : 'These revisions have identical content.'}
    </p>}
    {shown?.diff && markdown && (shown.before.source !== null || shown.after.source !== null) &&
      <MarkdownChanges comparison={shown} {...{ repo, path, fields, report }} />}
    {changed && !markdown && <div className="diff-output" tabIndex={0} aria-label="Line by line differences">
      {shown.diff.groups.map((group, index) => <DiffGroup key={index} group={group} showAll={showAll} />)}
    </div>}
  </article>;
}
