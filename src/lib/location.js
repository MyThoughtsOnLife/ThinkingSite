export function locationChoice() {
  const url = new URL(window.location.href);
  // Old demo links should open the default collection without carrying a demo file or revision.
  if (url.searchParams.get('collection') === 'sample' && !url.searchParams.get('repo') && !url.searchParams.get('local')) {
    url.search = '';
    url.hash = '';
  }
  return {
    url: url.searchParams.get('repo') || '',
    local: url.searchParams.get('local') || '',
    ref: url.searchParams.get('ref') || '',
    version: url.searchParams.get('version') || '',
    path: url.searchParams.get('file') || '',
    anchor: url.hash ? decodeHash(url.hash.slice(1)) : ''
  };
}

function decodeHash(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function viewURL(repo, revision, path, anchor) {
  const url = new URL(window.location.href);
  url.search = '';
  if (repo.url) {
    url.searchParams.set('repo', repo.url);
    url.searchParams.set('ref', repo.ref);
  } else if (repo.provider === 'Local') {
    url.searchParams.set('local', repo.name);
  }
  if (revision.id !== repo.latest.id) url.searchParams.set('version', revision.id);
  if (path) url.searchParams.set('file', path);
  url.hash = anchor ? encodeURIComponent(anchor) : '';
  return url;
}

export async function copyURL(url) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(url.href);
  const input = document.createElement('textarea');
  input.value = url.href;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Clipboard unavailable.');
}
