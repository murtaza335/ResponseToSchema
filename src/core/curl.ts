/**
 * Parses a bash-style cURL command (as produced by "Copy as cURL" in browser
 * dev tools, Postman, API docs, etc.) into a request description.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface HeaderEntry {
  key: string;
  value: string;
  enabled: boolean;
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string };

export interface RequestSpec {
  method: HttpMethod;
  url: string;
  headers: HeaderEntry[];
  body: string;
  auth: AuthConfig;
}

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode']);

/** Flags that consume the following token but don't affect the request we build. */
const IGNORED_FLAGS_WITH_VALUE = new Set([
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-x', '--proxy',
  '-U', '--proxy-user', '--retry', '--retry-delay', '--retry-max-time', '-c', '--cookie-jar', '-K', '--config',
  '--cacert', '--capath', '-E', '--cert', '--key', '--resolve', '--limit-rate', '-r', '--range', '-F', '--form',
  '-T', '--upload-file', '--interface', '--dns-servers', '-y', '--speed-time', '-Y', '--speed-limit',
]);

export function isCurlCommand(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

export function parseCurl(command: string): RequestSpec {
  const tokens = tokenize(command);
  if (tokens.length === 0 || !/^curl(\.exe)?$/i.test(tokens[0])) {
    throw new Error('Not a cURL command.');
  }

  let method: HttpMethod | undefined;
  let url = '';
  const headers: HeaderEntry[] = [];
  const dataParts: string[] = [];
  let auth: AuthConfig = { type: 'none' };
  let forceGet = false;
  let isJsonFlag = false;

  const setHeader = (key: string, value: string): void => {
    const existing = headers.find((h) => h.key.toLowerCase() === key.toLowerCase());
    if (existing) existing.value = value;
    else headers.push({ key, value, enabled: true });
  };

  for (let i = 1; i < tokens.length; i++) {
    let token = tokens[i];
    let inlineValue: string | undefined;

    // `-XPOST`, `-H'Accept: x'` and `--request=POST` style attached values.
    const longEq = /^(--[a-z-]+)=(.*)$/s.exec(token);
    if (longEq) {
      token = longEq[1];
      inlineValue = longEq[2];
    } else if (/^-[XHdubAe]./.test(token)) {
      inlineValue = token.slice(2);
      token = token.slice(0, 2);
    }
    const next = (): string => inlineValue ?? tokens[++i] ?? '';

    if (token === '-X' || token === '--request') {
      const m = next().toUpperCase();
      if ((HTTP_METHODS as string[]).includes(m)) method = m as HttpMethod;
    } else if (token === '-H' || token === '--header') {
      const raw = next();
      const idx = raw.indexOf(':');
      if (idx > 0) setHeader(raw.slice(0, idx).trim(), raw.slice(idx + 1).trim());
    } else if (DATA_FLAGS.has(token)) {
      dataParts.push(next());
    } else if (token === '--json') {
      dataParts.push(next());
      isJsonFlag = true;
    } else if (token === '-u' || token === '--user') {
      const raw = next();
      const idx = raw.indexOf(':');
      auth = idx >= 0
        ? { type: 'basic', username: raw.slice(0, idx), password: raw.slice(idx + 1) }
        : { type: 'basic', username: raw, password: '' };
    } else if (token === '--oauth2-bearer') {
      auth = { type: 'bearer', token: next() };
    } else if (token === '-b' || token === '--cookie') {
      setHeader('Cookie', next());
    } else if (token === '-A' || token === '--user-agent') {
      setHeader('User-Agent', next());
    } else if (token === '-e' || token === '--referer') {
      setHeader('Referer', next());
    } else if (token === '--url') {
      url = next();
    } else if (token === '-G' || token === '--get') {
      forceGet = true;
    } else if (token === '-I' || token === '--head') {
      method = 'HEAD';
    } else if (IGNORED_FLAGS_WITH_VALUE.has(token)) {
      next();
    } else if (token.startsWith('-')) {
      // Boolean flags such as -s, -L, -k, --compressed, -sSL: nothing to do.
    } else if (!url) {
      url = token;
    }
  }

  if (!url) throw new Error('No URL found in cURL command.');
  if (!/^[a-z]+:\/\//i.test(url) && !url.startsWith('{{')) url = `http://${url}`;

  let body = dataParts.join('&');
  if (forceGet && body) {
    url += (url.includes('?') ? '&' : '?') + body;
    body = '';
  }
  if (isJsonFlag) {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) setHeader('Content-Type', 'application/json');
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) setHeader('Accept', 'application/json');
  }

  // A bearer token passed as a header is surfaced in the Auth tab instead.
  const authHeader = headers.find((h) => h.key.toLowerCase() === 'authorization');
  if (authHeader && auth.type === 'none') {
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.value);
    if (bearer) {
      auth = { type: 'bearer', token: bearer[1] };
      headers.splice(headers.indexOf(authHeader), 1);
    }
  }

  const resolvedMethod: HttpMethod = method ?? (forceGet ? 'GET' : body ? 'POST' : 'GET');
  return { method: resolvedMethod, url, headers, body, auth };
}

/**
 * Minimal POSIX-shell tokenizer: single quotes, double quotes with backslash
 * escapes, ANSI-C `$'...'` strings, and backslash/caret line continuations.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;
  const src = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      i++;
    } else if (ch === "'") {
      inToken = true;
      const end = src.indexOf("'", i + 1);
      if (end === -1) throw new Error('Unterminated single quote in cURL command.');
      current += src.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '$' && src[i + 1] === "'") {
      inToken = true;
      i += 2;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < src.length) {
          const [text, consumed] = readAnsiEscape(src, i + 1);
          current += text;
          i += 1 + consumed;
        } else {
          current += src[i++];
        }
      }
      if (i >= src.length) throw new Error("Unterminated $'...' string in cURL command.");
      i++;
    } else if (ch === '"') {
      inToken = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1])) {
          current += src[i + 1];
          i += 2;
        } else {
          current += src[i++];
        }
      }
      if (i >= src.length) throw new Error('Unterminated double quote in cURL command.');
      i++;
    } else if (ch === '\\' && i + 1 < src.length) {
      inToken = true;
      current += src[i + 1];
      i += 2;
    } else {
      inToken = true;
      current += ch;
      i++;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

const ANSI_SIMPLE: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', E: '\x1b',
};

/**
 * Decodes one backslash escape of a bash `$'...'` string. `at` points at the
 * character after the backslash; returns the decoded text and how many
 * characters were consumed. Chrome's "Copy as cURL (bash)" relies on `\xHH`
 * and `\uHHHH` for anything that isn't printable ASCII.
 */
function readAnsiEscape(src: string, at: number): [string, number] {
  const ch = src[at];
  if (ch in ANSI_SIMPLE) return [ANSI_SIMPLE[ch], 1];

  const hexLength: Record<string, number> = { x: 2, u: 4, U: 8 };
  if (ch in hexLength) {
    const digits = /^[0-9a-fA-F]*/.exec(src.slice(at + 1, at + 1 + hexLength[ch]))![0];
    if (digits.length === 0) return [ch, 1];
    const code = parseInt(digits, 16);
    return [code <= 0x10ffff ? String.fromCodePoint(code) : '', 1 + digits.length];
  }

  const octal = /^[0-7]{1,3}/.exec(src.slice(at, at + 3));
  if (octal) return [String.fromCharCode(parseInt(octal[0], 8)), octal[0].length];

  // `\\`, `\'`, `\"`, `\?` and unknown escapes decode to the character itself.
  return [ch, 1];
}
