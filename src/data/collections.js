import { parseRepository } from '../lib/repository.js';

export const site = {
  name: 'My Thoughts on Life',
  heading: 'A place to think in writing.',
  description: 'A notebook to have my thoughts, insights, and findings organized.'
};

// Use the repository's default branch unless a ref is configured.
export const primaryCollection = {
  url: 'https://github.com/MyThoughtsOnLife/Thoughts',
  ref: '',
  name: site.name,
  description: site.description,
  author: { name: 'MyThoughtsOnLife', birthDate: '15.04.2008' }
};

export const collections = [
  primaryCollection
  // Add guest collections here with a name, description, and public repository URL.
];

export function collectionFor(repo) {
  if (!repo?.url) return undefined;
  return collections.find(collection => {
    if (!collection.url || (collection.ref && collection.ref !== repo.ref)) return false;
    try { return parseRepository(collection.url).url.toLowerCase() === repo.url.toLowerCase(); }
    catch { return false; }
  });
}
