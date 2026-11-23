const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const dottedDate = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function civilDate(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(dottedDate, '$3-$2-$1');
  if (!isoDate.test(normalized)) return '';
  const date = new Date(normalized + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized ? '' : normalized;
}

export function localDay(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
}

export function ageOn(birthDate, timestamp) {
  const born = civilDate(birthDate);
  const actual = civilDate(typeof timestamp === 'string' ? timestamp.slice(0, 10) : '');
  if (!born || !actual || actual < born) return null;
  return Number(actual.slice(0, 4)) - Number(born.slice(0, 4)) - Number(actual.slice(5) < born.slice(5));
}

export function displayDay(value) {
  const date = civilDate(typeof value === 'string' ? value.slice(0, 10) : '');
  return date ? dateFormatter.format(new Date(date + 'T00:00:00Z')) : '';
}

export function readProfile(defaults, metadata) {
  let config;
  try { config = JSON.parse(metadata || 'null'); } catch { config = null; }
  const text = (a, b) => typeof a === 'string' && a.trim() ? a.trim() : typeof b === 'string' ? b.trim() : '';
  return {
    name: text(config?.title, defaults?.name),
    description: text(config?.description, defaults?.description),
    author: {
      name: text(config?.author?.name, defaults?.author?.name),
      birthDate: civilDate(config?.author?.birthDate) || civilDate(defaults?.author?.birthDate)
    }
  };
}

export function aboutFile(files) {
  return [...files.keys()].find(path => /^about\.(md|markdown)$/i.test(path)) || '';
}
