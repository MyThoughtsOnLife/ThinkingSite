import assert from 'node:assert/strict';
import test from 'node:test';
import { openRepository, parseRepository } from '../src/lib/repository.js';

test('parses nested GitLab project paths and identifies GitHub file links', () => {
  assert.deepEqual(parseRepository('gitlab.com/group/team/notebook.git/-/blob/main/draft.md'), {
    host: 'gitlab.com',
    provider: 'GitLab',
    project: 'group/team/notebook',
    url: 'https://gitlab.com/group/team/notebook',
    route: 'blob',
    tail: ['main', 'draft.md'],
    ref: '',
    anchor: ''
  });
  assert.deepEqual(parseRepository('https://github.com/user/project/blob/draft/one/Note%20one.md#method').tail,
    ['draft', 'one', 'Note one.md']);
  assert.throws(() => parseRepository('https://github.com.example.net/user/project'), /public repository/);
  assert.throws(() => parseRepository('https://github.com/user%2Ffake/project'), /invalid path/);
});

test('pins GitHub reads to a commit and resolves a branch name containing a slash', async t => {
  const commit = '10ab01';
  const prior = '09ab01';
  t.mock.method(globalThis, 'fetch', async url => {
    const value = new URL(url);
    const respond = (json, headers) => Response.json(json, { headers });
    const api = '/repos/example/notebook';
    if (value.hostname === 'raw.githubusercontent.com') {
      assert.equal(value.pathname, '/example/notebook/' + commit + '/notes/Entry%20one.md');
      return new Response('# Entry one');
    }
    assert.equal(value.hostname, 'api.github.com');
    if (value.pathname === api) return respond({ name: 'notebook', default_branch: 'main' });
    if (value.pathname === api + '/commits/notes%2Frevision%2Fnotes') return new Response('', { status: 404 });
    if (value.pathname === api + '/commits/notes%2Frevision') return respond({ sha: commit });
    if (value.pathname === api + '/git/trees/' + commit) return respond({ tree: [
      { type: 'tree', path: 'notes', sha: 'tree' },
      { type: 'blob', path: 'notes/Entry one.md', sha: 'blob', mode: '100644' }
    ] });
    if (value.pathname === api + '/git/trees/' + prior) return respond({ tree: [] });
    if (value.pathname === api + '/commits') {
      assert.equal(value.searchParams.get('sha'), commit);
      assert.equal(value.searchParams.get('path'), 'notes/Entry one.md');
      return respond([{ sha: commit, commit: { message: 'Write note', author: { name: 'Reader' } } }]);
    }
    throw new Error('Unexpected request: ' + value);
  });
  const repo = await openRepository('https://github.com/example/notebook/blob/notes/revision/notes/Entry%20one.md');
  assert.equal(repo.ref, 'notes/revision');
  assert.equal(repo.initialPath, 'notes/Entry one.md');
  assert.equal(repo.latest.id, commit);
  assert.equal(new TextDecoder().decode(await repo.bytes(repo.latest, repo.initialPath)), '# Entry one');
  assert.equal((await repo.history(repo.initialPath, 1)).items[0].message, 'Write note');
  assert.equal((await repo.snapshot(prior)).files.size, 0);
});

test('reads all GitLab tree pages and fetches files by immutable blob ID', async t => {
  const api = '/api/v4/projects/group%2Fteam%2Fnotes';
  t.mock.method(globalThis, 'fetch', async url => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === api) return Response.json({ default_branch: 'main', path: 'notes' });
    if (pathname === api + '/repository/commits/main') return Response.json({ id: 'commit' });
    if (pathname === api + '/repository/tree') {
      assert.equal(searchParams.get('ref'), 'commit');
      const page = searchParams.get('page');
      return Response.json([{ type: 'blob', path: page + '.md', id: 'blob-' + page }], {
        headers: { 'x-next-page': page === '1' ? '2' : '' }
      });
    }
    if (pathname === api + '/repository/blobs/blob-2/raw') return new Response('# Page two');
    throw new Error('Unexpected request: ' + url);
  });
  const repo = await openRepository('https://gitlab.com/group/team/notes');
  assert.deepEqual([...repo.latest.files.keys()], ['1.md', '2.md']);
  assert.equal(new TextDecoder().decode(await repo.bytes(repo.latest, '2.md')), '# Page two');
});
