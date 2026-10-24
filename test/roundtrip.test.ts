/**
 * End-to-end guarantees for every fixture, against the real libraries:
 *   1. the generated Zod schema (v4 and v3 syntax) parses the original JSON;
 *   2. the generated TypeScript (combined output) typechecks with the
 *      original JSON assigned to the root type.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { generateFromJson, ZodVersion } from '../src/core/generate';

const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureDir = path.join(repoRoot, 'test', 'fixtures');
const fixtures = fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));

function runZod(code: string, version: ZodVersion): Record<string, { parse(v: unknown): unknown }> {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const zodModule = version === '4' ? require('zod') : require('zod/v3');
  const moduleExports: Record<string, never> = {};
  new Function('require', 'exports', js)((id: string) => (id === 'zod' ? zodModule : require(id)), moduleExports);
  return moduleExports;
}

function typecheck(code: string): string[] {
  const fileName = path.join(repoRoot, '__generated__.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: ['node'],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => (path.resolve(f) === fileName ? code : readFile(f));
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    path.resolve(f) === fileName ? ts.createSourceFile(f, code, lang) : getSourceFile(f, lang, ...rest);
  host.fileExists = ((exists) => (f: string) => path.resolve(f) === fileName || exists(f))(host.fileExists.bind(host));

  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName && path.resolve(d.file.fileName) === fileName)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

for (const fixture of fixtures) {
  const json = fs.readFileSync(path.join(fixtureDir, fixture), 'utf8');
  const value = JSON.parse(json);

  for (const style of ['named', 'inline'] as const) {
    for (const zodVersion of ['4', '3'] as const) {
      test(`${fixture} [${style}, zod ${zodVersion}] schema parses the source JSON`, () => {
        const result = generateFromJson(json, { rootName: 'Root', style, zodVersion });
        assert.ok(result.ok, result.error);
        const mod = runZod(result.zod, zodVersion);
        assert.deepEqual(mod.RootSchema.parse(value), value);
      });
    }

    test(`${fixture} [${style}] generated code typechecks against the source JSON`, () => {
      const result = generateFromJson(json, {
        rootName: 'Root',
        style,
        fetcher: { url: 'https://api.example.com/{{ID}}', method: 'GET' },
      });
      const code = `${result.combined}\nconst sample: Root = ${json.trim()};\nconst parsed: Root = RootSchema.parse(sample);\nvoid parsed;\n`;
      assert.deepEqual(typecheck(code), [], code);
    });
  }
}
