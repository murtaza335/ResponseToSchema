/**
 * Best-effort removal of literal secrets before a request is written to
 * workspace storage. `{{VARIABLE}}` placeholders are kept because they hold
 * no secret themselves. Bodies in formats other than JSON or form-encoding
 * can't be inspected and are stored as typed.
 */

import { RequestSpec } from './curl';

const SENSITIVE_NAME = /authorization|(^|[-_.])auth([-_.]|$)|oauth|cookie|token|secret|api[-_]?key|^key$|password|passwd|pwd|session|signature|credential/i;

const hasPlaceholder = (value: string): boolean => /\{\{[^}]*\}\}/.test(value);

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Blanks values of `a=b&c=d` pairs whose name looks sensitive. */
function redactPairs(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const value = pair.slice(eq + 1);
      const sensitive = SENSITIVE_NAME.test(decode(pair.slice(0, eq)));
      return sensitive && value && !hasPlaceholder(decode(value)) ? `${pair.slice(0, eq)}=` : pair;
    })
    .join('&');
}

export function redactUrl(url: string): string {
  // https://user:password@host
  let result = url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/:@\s?#]+):([^@/\s?#]+)@/i, (match, head: string, password: string) =>
    hasPlaceholder(decode(password)) ? match : `${head}:@`
  );
  const q = result.indexOf('?');
  if (q === -1) return result;
  const hash = result.indexOf('#', q);
  const end = hash === -1 ? result.length : hash;
  result = result.slice(0, q + 1) + redactPairs(result.slice(q + 1, end)) + result.slice(end);
  return result;
}

function redactJson(value: unknown, state: { changed: boolean }): unknown {
  if (Array.isArray(value)) return value.map((v) => redactJson(v, state));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const isPrimitive = child !== null && typeof child !== 'object';
    if (SENSITIVE_NAME.test(key) && isPrimitive && child !== '' && !(typeof child === 'string' && hasPlaceholder(child))) {
      out[key] = '';
      state.changed = true;
    } else {
      out[key] = redactJson(child, state);
    }
  }
  return out;
}

export function redactBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return body;

  try {
    const state = { changed: false };
    const redacted = redactJson(JSON.parse(trimmed), state);
    return state.changed ? JSON.stringify(redacted, null, 2) : body;
  } catch {
    // Not JSON.
  }

  if (/^[^\s=&]+=[^\s&]*(&[^\s=&]+=[^\s&]*)*$/.test(trimmed)) return redactPairs(trimmed);
  return body;
}

export function redactRequest(request: RequestSpec): RequestSpec {
  const keep = (value: string): string => (hasPlaceholder(value) ? value : '');
  const auth = request.auth;
  return {
    ...request,
    url: redactUrl(request.url),
    body: redactBody(request.body),
    headers: request.headers.map((h) => (SENSITIVE_NAME.test(h.key) ? { ...h, value: keep(h.value) } : { ...h })),
    auth:
      auth.type === 'bearer' ? { type: 'bearer', token: keep(auth.token) }
      : auth.type === 'basic' ? { type: 'basic', username: auth.username, password: keep(auth.password) }
      : { type: 'none' },
  };
}
