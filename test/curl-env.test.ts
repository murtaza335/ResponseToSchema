import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCurlCommand, parseCurl, tokenize } from '../src/core/curl';
import { findTokens, parseEnv, substituteTokens } from '../src/core/env';

test('tokenizer handles quotes, escapes and line continuations', () => {
  assert.deepEqual(tokenize(`curl 'a b' "c \\"d\\"" e\\ f \\\n  $'g\\nh'`), ['curl', 'a b', 'c "d"', 'e f', 'g\nh']);
});

test('parses a Chrome "Copy as cURL (bash)" command', () => {
  const spec = parseCurl(`curl 'https://api.example.com/v1/users?page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc.def' \\
  -H 'x-trace: a:b:c' \\
  --compressed`);
  assert.equal(spec.method, 'GET');
  assert.equal(spec.url, 'https://api.example.com/v1/users?page=2');
  assert.deepEqual(spec.auth, { type: 'bearer', token: 'abc.def' });
  assert.deepEqual(spec.headers.map((h) => [h.key, h.value]), [['accept', 'application/json'], ['x-trace', 'a:b:c']]);
});

test('data implies POST unless a method is given', () => {
  assert.equal(parseCurl(`curl https://x.dev -d '{"a":1}'`).method, 'POST');
  assert.equal(parseCurl(`curl -X PUT https://x.dev --data-raw '{"a":1}'`).method, 'PUT');
  assert.equal(parseCurl(`curl -XPATCH https://x.dev -d a=1`).method, 'PATCH');
  assert.equal(parseCurl(`curl --request=DELETE https://x.dev`).method, 'DELETE');
});

test('--json sets body and JSON headers', () => {
  const spec = parseCurl(`curl --json '{"q":"x"}' https://x.dev/search`);
  assert.equal(spec.method, 'POST');
  assert.equal(spec.body, '{"q":"x"}');
  assert.deepEqual(spec.headers.map((h) => h.key), ['Content-Type', 'Accept']);
});

test('-u becomes basic auth, -G moves data to the query string', () => {
  assert.deepEqual(parseCurl('curl -u user:p:ss https://x.dev').auth, { type: 'basic', username: 'user', password: 'p:ss' });
  const spec = parseCurl('curl -G https://x.dev/s?a=1 -d q=x -d n=2');
  assert.equal(spec.method, 'GET');
  assert.equal(spec.url, 'https://x.dev/s?a=1&q=x&n=2');
  assert.equal(spec.body, '');
});

test('flags with values are not mistaken for the URL', () => {
  const spec = parseCurl('curl -sSL -o out.json -m 10 --url https://x.dev/a -A bot');
  assert.equal(spec.url, 'https://x.dev/a');
  assert.deepEqual(spec.headers, [{ key: 'User-Agent', value: 'bot', enabled: true }]);
});

test('scheme-less URLs and template URLs', () => {
  assert.equal(parseCurl('curl example.com/a').url, 'http://example.com/a');
  assert.equal(parseCurl("curl '{{BASE_URL}}/a'").url, '{{BASE_URL}}/a');
});

test('rejects non-cURL input', () => {
  assert.equal(isCurlCommand('https://x.dev'), false);
  assert.equal(isCurlCommand('curl https://x.dev'), true);
  assert.throws(() => parseCurl('curl -s'), /No URL/);
});

test('parseEnv handles export, quotes and comments', () => {
  const env = parseEnv(`# comment\nexport A=1\nB = "two words"\nC='x # not a comment'\nD=val # trailing\nE="line\\nbreak"\ninvalid line\n`);
  assert.deepEqual(Object.fromEntries(env), { A: '1', B: 'two words', C: 'x # not a comment', D: 'val', E: 'line\nbreak' });
});

test('substituteTokens reports missing variables', () => {
  const vars = new Map([['HOST', 'x.dev']]);
  assert.deepEqual(substituteTokens('https://{{HOST}}/{{ ID }}', vars), { value: 'https://x.dev/{{ ID }}', missing: ['ID'] });
  assert.deepEqual(findTokens('{{A}} {{B}} {{A}}'), ['A', 'B']);
});
