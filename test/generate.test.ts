import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFromJson } from '../src/core/generate';
import { rootNameFromUrl, singularize, toPascalCase } from '../src/core/naming';

const ts = (json: unknown, opts = {}) => generateFromJson(JSON.stringify(json), opts).typescript;
const zod = (json: unknown, opts = {}) => generateFromJson(JSON.stringify(json), opts).zod;

test('object root becomes an interface named after rootName', () => {
  assert.equal(ts({ id: 1, name: 'a' }, { rootName: 'user' }), 'export interface User {\n  id: number;\n  name: string;\n}\n');
});

test('invalid JSON reports an error instead of emitting a fallback', () => {
  const result = generateFromJson('{nope', {});
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Invalid JSON/);
  assert.equal(result.combined, '');
});

test('keys missing from some array elements become optional', () => {
  const out = ts([{ a: 1 }, { a: 2, b: 'x' }], { rootName: 'Rows' });
  assert.match(out, /a: number;/);
  assert.match(out, /b\?: string;/);
  assert.match(zod([{ a: 1 }, { a: 2, b: 'x' }]), /b: z\.string\(\)\.optional\(\)/);
});

test('array element unions are parenthesised, including nullable objects', () => {
  assert.match(ts({ v: [1, 'a'] }), /v: \(string \| number\)\[\];/);
  assert.match(ts({ v: [{ a: 1 }, null] }, { style: 'inline' }), /v: \(\{\n\s+a: number;\n\s+\} \| null\)\[\];/);
  assert.match(ts({ v: [{ a: 1 }, null] }), /v: \(VItem \| null\)\[\];/);
});

test('inherited Object.prototype names are treated as ordinary keys', () => {
  const out = ts([{ constructor: 'x' }, {}]);
  assert.match(out, /constructor\?: string;/);
});

test('__proto__ keys use a computed property name', () => {
  const result = generateFromJson('{"__proto__":{"a":1}}', {});
  assert.match(result.typescript, /\["__proto__"\]: Proto;/);
  assert.match(result.zod, /\["__proto__"\]: ProtoSchema,/);
});

test('non-identifier keys are quoted', () => {
  assert.match(ts({ 'Content-Type': 'a', '1x': 1 }), /"Content-Type": string;\n {2}"1x": number;/);
});

test('empty arrays and objects fall back to permissive types', () => {
  const out = ts({ list: [], obj: {} });
  assert.match(out, /list: unknown\[\];/);
  assert.match(out, /obj: Record<string, unknown>;/);
  assert.match(zod({ obj: {} }), /obj: z\.record\(z\.string\(\), z\.unknown\(\)\)/);
});

test('null-only values become null / z.null()', () => {
  assert.match(ts({ a: null }), /a: null;/);
  assert.match(zod({ a: null }), /a: z\.null\(\)/);
});

test('array root is aliased and elements use the singular name', () => {
  const out = ts([{ id: 1 }], { rootName: 'Users' });
  assert.match(out, /export interface User \{/);
  assert.match(out, /export type Users = User\[\];/);
});

test('envelope lists on the root are named after the root', () => {
  const out = ts({ data: [{ id: 1 }], meta: { page: 1 } }, { rootName: 'Users' });
  assert.match(out, /export interface User \{/);
  assert.match(out, /data: User\[\];/);
  assert.match(ts({ results: [{ id: 1 }] }, { rootName: 'Search' }), /results: SearchItem\[\];/);
});

test('primitive roots become type aliases', () => {
  assert.equal(ts('x'), 'export type Root = string;\n');
  assert.match(zod(42), /export const RootSchema = z\.number\(\);/);
});

test('identical nested shapes share one declaration', () => {
  const out = ts({ home: { city: 'a' }, work: { city: 'b' } });
  assert.equal(out.match(/export interface/g)?.length, 2);
  assert.match(out, /home: Home;\n {2}work: Home;/);
});

test('colliding names are disambiguated with the parent name', () => {
  const out = ts({ a: { item: { x: 1 } }, b: { item: { y: 's' } } });
  assert.match(out, /export interface Item \{\n {2}x: number;/);
  assert.match(out, /export interface BItem \{\n {2}y: string;/);
});

test('inline style emits a single declaration', () => {
  const out = ts({ a: { b: { c: 1 } } }, { style: 'inline' });
  assert.equal(out.match(/export /g)?.length, 1);
});

test('string formats follow the selected Zod version', () => {
  const sample = { at: '2024-01-01T10:00:00Z', day: '2024-01-01', mail: 'a@b.io', site: 'https://x.dev', id: '9b2f0c1e-3d4a-4b5c-8d9e-0f1a2b3c4d5e' };
  const v4 = zod(sample);
  assert.match(v4, /at: z\.iso\.datetime\(\{ offset: true \}\)/);
  assert.match(v4, /day: z\.iso\.date\(\)/);
  assert.match(v4, /mail: z\.email\(\)/);
  assert.match(v4, /site: z\.url\(\)/);
  assert.match(v4, /id: z\.uuid\(\)/);
  const v3 = zod(sample, { zodVersion: '3' });
  assert.match(v3, /at: z\.string\(\)\.datetime\(\{ offset: true \}\)/);
  assert.match(v3, /mail: z\.string\(\)\.email\(\)/);
});

test('formats are dropped when samples disagree or detection is off', () => {
  assert.match(zod([{ m: 'a@b.io' }, { m: 'nope' }]), /m: z\.string\(\)/);
  assert.match(zod({ m: 'a@b.io' }, { detectFormats: false }), /m: z\.string\(\)/);
});

test('integer detection is opt-in', () => {
  assert.match(zod({ n: 1 }), /n: z\.number\(\),/);
  assert.match(zod({ n: 1 }, { detectIntegers: true }), /n: z\.number\(\)\.int\(\)/);
  assert.match(zod({ n: [1, 1.5] }, { detectIntegers: true }), /n: z\.array\(z\.number\(\)\)/);
});

test('indent option is respected', () => {
  assert.equal(ts({ a: 1 }, { indent: '\t' }), 'export interface Root {\n\ta: number;\n}\n');
});

test('zod output exports inferred types; combined output does not duplicate them', () => {
  const result = generateFromJson('{"a":{"b":1}}', { rootName: 'Thing' });
  assert.match(result.zod, /export type Thing = z\.infer<typeof ThingSchema>;/);
  assert.match(result.zod, /export type A = z\.infer<typeof ASchema>;/);
  assert.doesNotMatch(result.combined, /z\.infer/);
  assert.match(result.combined, /export interface Thing/);
  assert.match(result.combined, /export const ThingSchema/);
});

test('fetcher helper interpolates env placeholders and validates with the schema', () => {
  const { combined } = generateFromJson('{"a":1}', {
    rootName: 'Thing',
    fetcher: { url: 'https://api.x.dev/things/{{ID}}?k={{ API_KEY }}', method: 'post' },
  });
  assert.match(combined, /fetch\(`https:\/\/api\.x\.dev\/things\/\$\{process\.env\.ID\}\?k=\$\{process\.env\.API_KEY\}`, \{ method: 'POST', \.\.\.init \}\)/);
  assert.match(combined, /return ThingSchema\.parse\(await res\.json\(\)\);/);
});

test('naming helpers', () => {
  assert.equal(toPascalCase('user_profile-data'), 'UserProfileData');
  assert.equal(toPascalCase('createdAt'), 'CreatedAt');
  assert.equal(toPascalCase('2fa'), 'T2fa');
  assert.equal(toPascalCase('string'), 'StringType');
  assert.equal(singularize('categories'), 'category');
  assert.equal(singularize('addresses'), 'address');
  assert.equal(singularize('status'), 'status');
  assert.equal(singularize('users'), 'user');
});

test('root name is derived from the URL path', () => {
  assert.equal(rootNameFromUrl('https://api.x.dev/v2/users/42', false), 'User');
  assert.equal(rootNameFromUrl('https://api.x.dev/v2/users', true), 'Users');
  assert.equal(rootNameFromUrl('https://api.x.dev/users', false), 'Users');
  assert.equal(rootNameFromUrl('{{BASE}}/repos/{{OWNER}}/issues?state=open', true), 'Issues');
  assert.equal(rootNameFromUrl('https://api.x.dev/order-items/9b2f0c1e-3d4a-4b5c-8d9e-0f1a2b3c4d5e', false), 'OrderItem');
  assert.equal(rootNameFromUrl('https://api.x.dev/', false), undefined);
});
