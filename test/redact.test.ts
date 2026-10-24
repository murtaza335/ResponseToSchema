import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactBody, redactRequest, redactUrl } from '../src/core/redact';
import { RequestSpec } from '../src/core/curl';

test('sensitive query parameters are blanked, others and placeholders kept', () => {
  assert.equal(redactUrl('https://x.dev/a?api_key=SECRET&page=2&token={{TOKEN}}#top'), 'https://x.dev/a?api_key=&page=2&token={{TOKEN}}#top');
  assert.equal(redactUrl('https://x.dev/a?key=AIza123&q=cats'), 'https://x.dev/a?key=&q=cats');
  assert.equal(redactUrl('https://x.dev/a?access%5Ftoken=abc'), 'https://x.dev/a?access%5Ftoken=');
  assert.equal(redactUrl('https://x.dev/a?author=bob&monkey=1&keyboard=2'), 'https://x.dev/a?author=bob&monkey=1&keyboard=2');
  assert.equal(redactUrl('{{BASE}}/users'), '{{BASE}}/users');
});

test('credentials embedded in the URL are blanked', () => {
  assert.equal(redactUrl('https://me:hunter2@x.dev/a'), 'https://me:@x.dev/a');
  assert.equal(redactUrl('https://me:{{PASS}}@x.dev/a'), 'https://me:{{PASS}}@x.dev/a');
});

test('JSON bodies: sensitive fields are blanked at any depth, untouched bodies keep their formatting', () => {
  const redacted = JSON.parse(redactBody('{"user":"ada","password":"hunter2","nested":{"apiKey":"k","list":[{"client_secret":"s"}]},"token":"{{T}}"}'));
  assert.deepEqual(redacted, { user: 'ada', password: '', nested: { apiKey: '', list: [{ client_secret: '' }] }, token: '{{T}}' });
  const plain = '{ "name":   "ada" }';
  assert.equal(redactBody(plain), plain);
});

test('form-encoded bodies are redacted, other bodies are left as typed', () => {
  assert.equal(redactBody('user=ada&password=hunter2&remember=1'), 'user=ada&password=&remember=1');
  assert.equal(redactBody('<a>text</a>'), '<a>text</a>');
  assert.equal(redactBody(''), '');
});

test('redactRequest covers headers, auth, URL and body together', () => {
  const request: RequestSpec = {
    method: 'POST',
    url: 'https://x.dev/login?apikey=abc',
    headers: [
      { key: 'Authorization', value: 'Bearer abc', enabled: true },
      { key: 'X-Api-Key', value: '{{KEY}}', enabled: true },
      { key: 'Accept', value: 'application/json', enabled: true },
    ],
    body: '{"password":"p"}',
    auth: { type: 'basic', username: 'ada', password: 'pw' },
  };
  const out = redactRequest(request);
  assert.equal(out.url, 'https://x.dev/login?apikey=');
  assert.deepEqual(out.headers.map((h) => h.value), ['', '{{KEY}}', 'application/json']);
  assert.deepEqual(out.auth, { type: 'basic', username: 'ada', password: '' });
  assert.deepEqual(JSON.parse(out.body), { password: '' });
  assert.equal(request.body, '{"password":"p"}', 'input must not be mutated');
});
