import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findImportInsertLine } from '../src/core/imports';

const at = (source: string): number => findImportInsertLine(source.split('\n'));

test('empty and import-free files insert at the top', () => {
  assert.equal(at(''), 0);
  assert.equal(at('const a = 1;\n'), 0);
});

test('goes after the last import, including multi-line and type imports', () => {
  assert.equal(at("import a from 'a';\nimport type { B } from 'b';\n\nconst x = 1;"), 2);
  assert.equal(at("import {\n  a,\n  b,\n} from 'ab';\nimport 'side-effect';\nconst x = 1;"), 5);
  assert.equal(at("import * as fs from 'fs'\nconst x = 1;"), 1);
});

test('respects shebangs, directives and comments', () => {
  assert.equal(at("#!/usr/bin/env node\nimport a from 'a';\ncode();"), 2);
  assert.equal(at("'use client';\n\nimport a from 'a';\ncode();"), 3);
  assert.equal(at("'use client';\ncode();"), 1);
  assert.equal(at("/* license\n * text */\n// note\nimport a from 'a';\ncode();"), 4);
});

test('never lands inside code, and ignores imports that appear later', () => {
  assert.equal(at("code();\nimport a from 'a';"), 0);
  assert.equal(at("import a from 'a';\nconst lazy = import('./x');"), 1);
});
