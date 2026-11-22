import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { applyDraft, asBytes, asText, exportZip } from '../src/lib/drafts.js';
import { pathFromLink, resolvePath, validatePath } from '../src/lib/paths.js';
import { prepareHtml } from '../src/lib/html-preview.js';

test('resolves repository links relative to their source and prevents escaping the root', () => {
  const files = new Map([
    ['notes/My file.md', {}],
    ['attachments/Chart.png', {}],
    ['Reference.md', {}]
  ]);
  assert.deepEqual(resolvePath(files, '../attachments/Chart.png', 'notes/My file.md'), { path: 'attachments/Chart.png', anchor: '' });
  assert.deepEqual(resolvePath(files, 'Reference#Method', 'notes/My file.md', true), { path: 'Reference.md', anchor: 'Method' });
  assert.deepEqual(resolvePath(files, '#method', 'notes/My file.md'), { path: 'notes/My file.md', anchor: 'method' });
  assert.equal(pathFromLink('../../readme.md', 'notes/My file.md'), null);
  assert.equal(pathFromLink('..%2Freadme.md', 'notes/My file.md'), null);
  assert.throws(() => validatePath('.git/config'), /Enter a file path/);
});

test('exports drafts with binary attachments, removals and upstream path conflicts', async () => {
  const revision = { id: 'main', files: new Map([['folder', {}], ['assets/figure.png', {}], ['old.md', {}]]) };
  const draft = new Map([['folder/Note.md', { content: 'New draft' }], ['old.md', null]]);
  const attachment = new Uint8Array([137, 80, 78, 71, 0, 255]);
  const repo = {
    async bytes(_, path) {
      assert.equal(path, 'assets/figure.png');
      return attachment;
    }
  };
  assert.deepEqual([...applyDraft(revision.files, draft).keys()], ['assets/figure.png', 'folder/Note.md']);
  const archive = unzipSync(await exportZip(repo, revision, draft, () => {}));
  assert.deepEqual(archive['assets/figure.png'], attachment);
  assert.equal(asText(archive['folder/Note.md']), 'New draft');
  assert.equal(archive['old.md'], undefined);
});

test('materializes local HTML assets and rewrites cyclic JavaScript imports', async () => {
  const files = new Map([
    ['widget/style.css', 'p { background-image: url(../image.png) }'],
    ['image.png', asBytes('image')],
    ['widget/entry.js', 'import { x } from "./other.js"; console.log(x);'],
    ['widget/other.js', 'import "./entry.js"; export const x = 7;']
  ]);
  const access = { has: path => files.has(path), read: async path => asBytes(files.get(path)) };
  const html = await prepareHtml(
    '<!-- <head> --><html><head class="custom"><base href="https://example.com/"><link rel="stylesheet" href="style.css"><script type="module" src="./entry.js"></script></head></html>',
    'widget/page.html',
    access
  );
  assert.match(html, /<head class="custom"><meta http-equiv="Content-Security-Policy"/);
  assert.doesNotMatch(html, /<base\b/);
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /data:text\/css;.*data%3Aimage%2Fpng/);
  assert.match(html, /mdreader-preview-file:widget%2Fentry.js/);
  assert.match(html, /mdreader-preview-file:widget%2Fother.js/);
});
