# API Schema Architect

A VS Code extension that fires real HTTP requests from a Webview panel and
instantly generates a matching TypeScript interface + Zod schema from the
JSON response, opened side-by-side in a new editor tab.

## Getting started

```bash
npm install --save-dev @types/vscode @types/node typescript
npm install zod   # runtime dependency used only by the *generated* code
npm run compile
```

Press `F5` in VS Code (with this folder open as the extension project) to
launch an Extension Development Host, then run the command
**"API Schema Architect: Open Dashboard"** from the Command Palette.

## Architecture

- **`src/extension.ts`** — activation, command registration, and the
  Extension Host side of the IPC bridge. All `fetch` calls happen here, not
  in the Webview, so they are never subject to the Webview's CORS/sandbox
  restrictions.
- **`src/webviewProvider.ts`** — owns the `WebviewPanel` and its raw
  HTML/CSS/JS shell (method select, URL field, dynamic header grid, body
  textarea). The Webview only collects form state and calls
  `acquireVsCodeApi().postMessage(...)`; it never performs the request
  itself.
- **`src/envResolver.ts`** — scans `.env` at the first workspace folder root
  and substitutes `{{VAR_NAME}}` tokens in the URL, headers, and body before
  the request is dispatched.
- **`src/transformerEngine.ts`** — pure functions `jsonToTypeScript` and
  `jsonToZod` that recursively walk a parsed JSON value and emit a
  `RootResponse` interface / `RootResponseSchema` Zod schema, with
  `.nullable()` / `string | null` applied per the deterministic null rule and
  a `WeakSet`-based cycle guard so unmappable circular structures fail
  cleanly instead of hanging.

## Design decisions worth knowing about

- **No `quicktype-core` dependency.** `quicktype-core` is a large dependency
  chain (its own CLI assumptions, language-target abstractions, IO shims)
  that is awkward to bundle cleanly inside a VS Code extension host and would
  add real weight and version-compatibility risk for a feature this scoped.
  `transformerEngine.ts` implements the same JSON → types walk directly with
  plain recursion, which keeps the TypeScript and Zod outputs trivially kept
  in sync (same traversal, same key order, same depth) and has zero runtime
  dependencies of its own. Swapping in `quicktype-core` later is a contained
  change limited to this one file.
- **Inlined nested types, not separate named interfaces.** Nested objects are
  emitted as inline object literals / inline `z.object({...})` at the correct
  indentation depth rather than hoisted into separately named
  `interface Foo123 { ... }` declarations. This avoids any name-collision
  bookkeeping for repeated key names at different depths and matches the
  spec's requirement of a single `RootResponse` top-level name.
- **Bundling for production.** The `main` field points at `./dist/extension.js`.
  For a real publish you'll want to add `esbuild` or `webpack` to bundle
  `src/` into a single `dist/extension.js`; `tsc` alone (as wired in
  `package.json` for now) emits one JS file per TS file into `dist/`, which
  works fine for local development (`F5`) but isn't a packaging setup.
