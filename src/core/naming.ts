/**
 * Identifier helpers: PascalCase type names, naive English singularisation
 * for array element names, and deriving a root type name from a request URL.
 */

const RESERVED = new Set([
  'any', 'array', 'boolean', 'date', 'error', 'function', 'map', 'never', 'null', 'number', 'object',
  'promise', 'record', 'set', 'string', 'symbol', 'undefined', 'unknown', 'void', 'z',
]);

export function toPascalCase(input: string): string {
  const words = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  if (name.length === 0) return '';
  if (/^\d/.test(name)) name = `T${name}`;
  if (RESERVED.has(name.toLowerCase())) name = `${name}Type`;
  return name;
}

const UNCOUNTABLE = new Set(['series', 'species', 'news', 'data', 'metadata', 'info', 'media', 'sheep', 'fish']);
/** Plurals ending in `-ies` whose singular is `-ie`, not `-y`. */
const IE_SINGULARS = /(movie|cookie|zombie|selfie|calorie|rookie|prairie|genie|hoodie|newbie|pixie|foodie|brownie|goalie|smoothie|bookie)s$/i;
/** Plurals of words ending in `s` that take `-es` (`statuses`, `Buses`). */
const ES_AFTER_S = /(alias|status|campus|virus|bonus|census|focus|genus|canvas|atlas|bias)es$|(^|[A-Z])[Bb]uses$/;

export function singularize(word: string): string {
  if (UNCOUNTABLE.has(word.toLowerCase())) return word;
  if (IE_SINGULARS.test(word)) return word.slice(0, -1);
  if (ES_AFTER_S.test(word)) return word.slice(0, -2);
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/zzes$/i.test(word)) return word.slice(0, -3);
  if (/(ss|sh|ch|x)es$/i.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/s$/i.test(word) && word.length > 1) return word.slice(0, -1);
  return word;
}

/** Name used for elements of an array whose own name is `name`. */
export function elementName(name: string): string {
  const singular = singularize(name);
  return singular !== name ? singular : `${name}Item`;
}

/**
 * Derives a type name from a URL path, skipping ids and version segments:
 *   /api/v2/users/42        -> "User"
 *   /repos/{{OWNER}}/issues -> "Issues"
 */
export function rootNameFromUrl(url: string, isArray: boolean): string | undefined {
  let path = url.replace(/\{\{[^}]*\}\}/g, ':var');
  try {
    path = new URL(path).pathname;
  } catch {
    path = path.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0];
  }

  const segments = path.split('/').filter(Boolean).map((s) => decodeSafe(s)).reverse();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isId = /^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || seg.startsWith(':') || /^v\d+$/i.test(seg) || seg === 'api';
    if (isId) continue;
    const base = toPascalCase(seg.replace(/\.[a-z]+$/i, ''));
    if (!base) continue;
    // `/users/42` returns a single user; `/users` returns the collection.
    const pointsAtItem = i > 0 && !isArray;
    return pointsAtItem ? singularize(base) : base;
  }
  return undefined;
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function toSafeKey(key: string): string {
  // `__proto__: x` in an object literal sets the prototype instead of a key.
  if (key === '__proto__') return '["__proto__"]';
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
