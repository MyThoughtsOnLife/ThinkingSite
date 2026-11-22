import { encodePath, validatePath } from './paths.js';

const GITHUB = 'github.com';
const GITLAB = 'gitlab.com';
const PAGE_SIZE = 20;

export function parseRepository(input) {
  const value = input.trim();
  let url;
  try {
    url = new URL(value.includes('://') ? value : 'https://' + value);
  } catch {
    throw new Error('Enter a GitHub or GitLab repository URL.');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || ![GITHUB, GITLAB].includes(host)) {
    throw new Error('Enter a public repository URL from github.com or gitlab.com.');
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.some(part => part === '.' || part === '..' || /[/\\]/.test(part))) {
    throw new Error('This repository URL contains an invalid path.');
  }
  const boundary = host === GITHUB ? 2 : parts.includes('-') ? parts.indexOf('-') : parts.length;
  const project = parts.slice(0, boundary);
  const [route, ...tail] = parts.slice(host === GITHUB ? boundary : boundary + 1);
  if (project.length < 2) throw new Error('Include the repository owner or group and the repository name.');
  project[project.length - 1] = project.at(-1).replace(/\.git$/i, '');
  if (!project.at(-1)) throw new Error('Include the repository name.');
  return {
    host,
    provider: host === GITHUB ? 'GitHub' : 'GitLab',
    project: project.join('/'),
    url: 'https://' + host + '/' + project.map(encodeURIComponent).join('/'),
    route: ['tree', 'blob', 'commit'].includes(route) ? route : '',
    tail,
    ref: url.searchParams.get('ref') || '',
    anchor: url.hash.slice(1)
  };
}

export class RepositoryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(url, provider) {
  let response;
  try {
    response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error('Could not reach ' + provider + '. Check your connection and try again.');
  }
  if (response.ok) return response;
  let message = provider + ' returned HTTP ' + response.status + '.';
  if (response.status === 404) message = 'This repository, revision, or file is unavailable. Check the URL and public access.';
  if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') {
    message = provider + ' has temporarily rate-limited requests from this connection. Try again later.';
  }
  throw new RepositoryError(response.status, message);
}

function endpoint(root, path = '', params = {}) {
  const url = new URL(root + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value != null) url.searchParams.set(key, value);
  }
  return url;
}

function entries(tree) {
  const files = new Map();
  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    try {
      files.set(validatePath(entry.path), { id: entry.sha || entry.id, mode: entry.mode });
    } catch {
      // Entries that cannot be represented safely in the exported repository are skipped.
    }
  }
  return files;
}

function githubCommit(entry) {
  return {
    id: entry.sha,
    message: entry.commit?.message || '',
    author: entry.commit?.author?.name || entry.author?.login || 'Unknown author',
    date: entry.commit?.author?.date || entry.commit?.committer?.date,
    url: entry.html_url
  };
}

function gitlabCommit(entry) {
  return { id: entry.id, message: entry.message || '', author: entry.author_name, date: entry.authored_date, url: entry.web_url };
}

function github(root, project) {
  const read = (path, params) => request(endpoint(root, path, params), 'GitHub');
  const json = async (path, params) => (await read(path, params)).json();

  async function tree(sha) {
    const { tree, truncated } = await json('/git/trees/' + encodeURIComponent(sha), { recursive: 1 });
    if (!truncated) return entries(tree);

    const result = [];
    const pending = [{ sha, prefix: '' }];
    while (pending.length) {
      const level = await Promise.all(pending.splice(0, 6).map(async node => ({
        prefix: node.prefix,
        items: (await json('/git/trees/' + node.sha)).tree
      })));
      for (const { prefix, items } of level) {
        for (const item of items) {
          const path = prefix + item.path;
          if (item.type === 'tree') pending.push({ sha: item.sha, prefix: path + '/' });
          else result.push({ ...item, path });
        }
      }
    }
    return entries(result);
  }

  return {
    info: () => json(''),
    commit: async ref => githubCommit(await json('/commits/' + encodeURIComponent(ref))),
    tree,
    async bytes(path, sha, entry) {
      if (entry.mode === '120000') {
        const { content } = await json('/git/blobs/' + entry.id);
        return Uint8Array.from(atob(content), char => char.charCodeAt(0));
      }
      const raw = 'https://raw.githubusercontent.com/' + encodePath(project) + '/' + encodeURIComponent(sha) + '/' + encodePath(path);
      return new Uint8Array(await (await request(raw, 'GitHub')).arrayBuffer());
    },
    async history(ref, path, page) {
      const response = await read('/commits', { sha: ref, path, page, per_page: PAGE_SIZE });
      const list = await response.json();
      return historyPage(list.map(githubCommit), page, response);
    }
  };
}

function gitlab(root) {
  const read = (path, params) => request(endpoint(root, path, params), 'GitLab');
  const json = async (path, params) => (await read(path, params)).json();

  return {
    info: () => json(''),
    commit: async ref => gitlabCommit(await json('/repository/commits/' + encodeURIComponent(ref))),
    async tree(sha) {
      const list = [];
      for (let page = 1;; page++) {
        const response = await read('/repository/tree', { ref: sha, recursive: true, per_page: 100, page });
        const batch = await response.json();
        list.push(...batch);
        if (!hasNext(batch, 100, response)) return entries(list);
      }
    },
    async bytes(path, sha, entry) {
      const response = await read('/repository/blobs/' + entry.id + '/raw');
      return new Uint8Array(await response.arrayBuffer());
    },
    async history(ref, path, page) {
      const response = await read('/repository/commits', { ref_name: ref, path, follow: false, page, per_page: PAGE_SIZE });
      const list = await response.json();
      return historyPage(list.map(gitlabCommit), page, response);
    }
  };
}

function hasNext(items, pageSize, response) {
  const next = response.headers.get('x-next-page');
  const links = response.headers.get('link');
  if (next != null) return Boolean(next);
  if (links != null) return /rel="next"/.test(links);
  return items.length === pageSize;
}

function historyPage(items, page, response) {
  return { items, next: hasNext(items, PAGE_SIZE, response) ? page + 1 : null };
}

async function linkRef(info, api, override) {
  async function resolve(ref, path = '') {
    const commit = await api.commit(ref);
    return { ref, sha: commit.id, commit, path };
  }
  if (override || info.ref) return resolve(override || info.ref);
  if (info.route && info.tail.length) {
    if (info.route === 'commit') return resolve(info.tail[0]);
    // Provider links do not delimit ref names containing slashes from the file path.
    const last = info.tail.length - (info.route === 'blob' ? 1 : 0);
    for (let length = last; length > 0; length--) {
      const ref = info.tail.slice(0, length).join('/');
      try {
        return await resolve(ref, info.tail.slice(length).join('/'));
      } catch (error) {
        if (error.status !== 404 && error.status !== 422) throw error;
      }
    }
    throw new Error('The branch or tag in this repository link could not be found.');
  }
  return resolve(info.defaultBranch);
}

export async function openRepository(input, override = '') {
  const parsed = parseRepository(input);
  const api = parsed.host === GITHUB
    ? github('https://api.github.com/repos/' + encodePath(parsed.project), parsed.project)
    : gitlab('https://gitlab.com/api/v4/projects/' + encodeURIComponent(parsed.project));
  const meta = await api.info();
  const info = { ...parsed, defaultBranch: meta.default_branch };
  let ref;
  try {
    ref = meta.empty_repo ? { ref: override || parsed.ref || info.defaultBranch || 'main', sha: '', path: '' }
      : await linkRef(info, api, override);
  } catch (error) {
    if (error.status !== 409) throw error;
    ref = { ref: override || parsed.ref || info.defaultBranch || 'main', sha: '', path: '' };
  }
  const snapshotCache = new Map();
  const byteCache = new Map();
  const name = meta.path || meta.name || parsed.project.split('/').at(-1);

  function snapshot(sha) {
    return cached(snapshotCache, sha, async () => {
      try {
        return { id: sha, files: await api.tree(sha) };
      } catch (error) {
        if (sha === ref.sha && (meta.empty_repo || error.status === 409)) return { id: sha, files: new Map() };
        throw error;
      }
    });
  }

  if (!ref.sha) snapshotCache.set(ref.sha, Promise.resolve({ id: ref.sha, files: new Map() }));
  const latest = await snapshot(ref.sha);
  return {
    key: parsed.url.toLowerCase() + '\n' + ref.ref,
    name,
    namespace: parsed.project.split('/').slice(0, -1).join('/'),
    url: parsed.url,
    provider: parsed.provider,
    ref: ref.ref,
    tip: ref.commit,
    latest,
    initialPath: ref.path,
    anchor: parsed.anchor,
    snapshot,
    bytes(revision, path) {
      const entry = revision.files.get(path);
      if (!entry) throw new Error('This file is absent from the selected revision.');
      const key = revision.id + '\n' + path;
      return cached(byteCache, key, () => api.bytes(path, revision.id, entry), 250);
    },
    history: (path, page) => ref.sha ? api.history(ref.sha, path, page) : { items: [], next: null }
  };
}

export function cached(cache, key, read, limit = Infinity) {
  if (!cache.has(key)) {
    if (cache.size >= limit) cache.delete(cache.keys().next().value);
    const promise = Promise.resolve().then(read);
    cache.set(key, promise);
    promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
  }
  return cache.get(key);
}
