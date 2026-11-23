import assert from 'node:assert/strict';
import test from 'node:test';
import { describeNote, searchCatalog, tagQuery } from '../src/lib/catalog.js';
import { asBytes } from '../src/lib/drafts.js';
import { extractFrontmatter, setNoteTags } from '../src/lib/frontmatter.js';
import { notebookFiles } from '../src/lib/paths.js';
import { ageOn, civilDate, readProfile } from '../src/lib/publication.js';
import { compareSources, revisionSource } from '../src/lib/revision-diff.js';

test('calculates age from the civil date of the commit across birthdays', () => {
  assert.equal(ageOn('2001-11-22', '2026-11-21T23:45:00-07:00'), 24);
  assert.equal(ageOn('2001-11-22', '2026-11-22T00:00:00+14:00'), 25);
  assert.equal(ageOn('2000-02-29', '2025-02-28'), 24);
  assert.equal(ageOn('2000-02-29', '2025-03-01'), 25);
  assert.equal(ageOn('2001-02-29', '2026-11-22'), null);
  assert.equal(ageOn('2026-11-23', '2026-11-22'), null);
});

test('accepts dotted civil dates in author profiles and rejects invalid days', () => {
  const defaults = { author: { birthDate: ' 22.11.2001 ' } };
  assert.equal(readProfile(defaults).author.birthDate, '2001-11-22');
  assert.equal(readProfile(defaults, '{"author":{"birthDate":"12.03.2002"}}').author.birthDate, '2002-03-12');
  assert.equal(ageOn('22.11.2001', '2026-11-21T23:45:00-07:00'), 24);
  assert.equal(ageOn('22.11.2001', '2026-11-22'), 25);
  assert.equal(civilDate('31.04.2026'), '');
  assert.equal(civilDate('29.02.2024'), '2024-02-29');
});

test('loads repository-specific published metadata and falls back to valid configured values', () => {
  const defaults = { name: 'Notebook', author: { name: 'Editor', birthDate: '2001-01-01' } };
  assert.deepEqual(readProfile(defaults, '{"title":"Guest collection","author":{"birthDate":"2001-02-30"}}'), {
    name: 'Guest collection', description: '', author: { name: 'Editor', birthDate: '2001-01-01' }
  });
});

test('editing YAML tags preserves the Markdown body and other properties', () => {
  const body = '# Heading\r\n\r\nBody text\r\n';
  const source = '---\r\n# My notes\r\ntitle: Example\r\nextra:\r\n  enabled: true\r\ntags: [Old]\r\n---\r\n' + body;
  const next = setNoteTags(source, 'New, #Research notes, research notes');
  const { props } = extractFrontmatter(next);
  assert.match(next, /# My notes/);
  assert.ok(next.endsWith(body));
  assert.deepEqual(props.tags, ['New', 'Research notes']);
  assert.deepEqual(props.extra, { enabled: true });
  assert.equal(extractFrontmatter(setNoteTags(next, '')).props.tags, undefined);
  assert.throws(() => setNoteTags('---\ntags: [broken\n---\nBody', 'new'), /frontmatter/);
});

test('search combines exact tags with filename or body terms and offers scoped search', () => {
  const first = 'field/River observations.md';
  const second = 'field/Other.md';
  const pdf = 'sources/Field sheet.pdf';
  const paths = [first, second, pdf];
  const notes = new Map([
    [first, describeNote(first, asBytes('---\ntags: ["River studies", fieldwork]\n---\n# Stream study\n\nThe cork stayed near the bank.'))],
    [second, describeNote(second, asBytes('---\ntags: [fieldwork]\n---\n# Leaf study\n\nThere was a cork here.'))]
  ]);
  assert.deepEqual(searchCatalog(paths, notes, tagQuery('River studies') + ' cork').map(hit => hit.path), [first]);
  assert.deepEqual(searchCatalog(paths, notes, 'field sheet', 'files').map(hit => hit.path), [pdf]);
  assert.equal(searchCatalog(paths, notes, 'stream', 'content').length, 1);
  assert.equal(searchCatalog(paths, notes, 'leaf study', 'tags').length, 0);
  assert.match(searchCatalog(paths, notes, 'cork', 'content')[0].snippet, /cork/);
});

test('diff represents added, changed, unchanged and deleted lines with separate line numbers', async () => {
  const diff = compareSources('Same\nOld\n', 'Same\nNew\nPlus\n');
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.groups.find(group => group.type === 'add').lines, [
    { text: 'New', old: null, next: 2 }, { text: 'Plus', old: null, next: 3 }
  ]);
  assert.equal(compareSources(null, 'New\n').added, 1);
  const repo = {
    latest: { id: 'latest', files: new Map([['README.md', {}]]) },
    async snapshot(id) { return { id, files: new Map() }; },
    async bytes() { return asBytes('One\r\n'); }
  };
  assert.equal((await revisionSource(repo, 'latest', 'README.md')).source, 'One\n');
  assert.equal((await revisionSource(repo, 'old', 'README.md')).source, null);
});


test('hides dotfiles, dotfolders and the root README without changing the workspace files', () => {
  const paths = ['.gitignore', '.mdreader.json', '.github/workflows/site.yml', 'notes/.draft.md',
    'notes/.private/page.md', 'Readme.md', 'notes/README.md', 'notes/Entry.md', 'About.md'];
  const files = new Map(paths.map(path => [path, {}]));
  assert.deepEqual([...notebookFiles(files).keys()], ['notes/README.md', 'notes/Entry.md', 'About.md']);
  assert.deepEqual([...files.keys()], paths);
});
