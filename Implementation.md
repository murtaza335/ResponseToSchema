# Implementation Guide: ResponseToSchema

Internal engineering notes for contributors. User-facing docs live in `README.md`; launch and distribution plans in `DISTRIBUTION.md`.

## 1. Layout

```
src/
  core/                 Pure TypeScript, no `vscode` import. Unit-tested directly.
    infer.ts            JSON samples -> TypeNode tree (merging, optionality, formats)
    generate.ts         TypeNode -> naming plan -> TypeScript / Zod / fetch helper
    naming.ts           PascalCase, singularize, root name from URL, safe keys
    curl.ts             Shell tokenizer + cURL flag parser -> RequestSpec
    env.ts              .env parser and {{VAR}} substitution
    redact.ts           Strips literal secrets (headers, auth, URL query, JSON/form body) before history is saved
    imports.ts          Where a new top-level import belongs in a file (after imports/directives)
  config.ts             Settings -> GenerateOptions / PanelOptions
  http.ts               Env resolution, auth, fetch with timeout/cancel, error mapping
  history.ts            Per-workspace history with secret redaction
  output.ts             Insert at cursor / open / save / copy
  panel.ts              Webview host: message routing, state, regeneration
  extension.ts          Activation and command registration
media/
  panel.js, panel.css   Webview UI (plain JS, DOM-built, strict CSP, theme variables)
test/
  generate.test.ts      Engine behaviour
  roundtrip.test.ts     Generated Zod (v4 + v3) parses each fixture; generated TS typechecks against it
  curl-env.test.ts      cURL and .env parsing
  redact.test.ts        History redaction
  imports.test.ts       Import insertion point
  host-smoke.js         Bundled extension against a mocked `vscode` + local HTTP server
```

`core/` has no `vscode` dependency on purpose, so it can ship later as an npm library, a CLI, or an MCP tool without changes.

## 2. Generation pipeline

```
JSON text ─ JSON.parse ─▶ inferType([value]) ─▶ TypeNode tree
                                                  │
                                       planNames(root, rootName, style)
                                                  │  (one plan, shared)
                                ┌─────────────────┴─────────────────┐
                           TsEmitter                            ZodEmitter
                      interfaces + root alias          schemas + z.infer aliases
```

### Inference (`infer.ts`)
- `inferType(samples)` buckets every sample by kind. A node can hold several kinds at once (string + number + null …), which become a union.
- Objects: keys are the ordered union of all samples' own keys (`hasOwnProperty`, so `constructor`/`toString` keys are safe). A key missing from any sample is `optional`.
- Arrays: elements of *all* arrays seen at that position are pooled (capped by `arraySampleLimit` per array) and inferred together.
- String formats apply only when every sample matches. The regexes are deliberately a subset of what both Zod 3 and Zod 4 accept (e.g. datetimes need seconds and a `Z`/`±hh:mm` offset).

### Naming (`planNames`)
- Post-order walk, so children are declared before parents. Zod `const`s must be defined before use.
- Candidates: field key → PascalCase. Array elements → singular (`orders` → `Order`, otherwise `XItem`). Envelope lists on the root (`data`, `items`, `results`, …) take the root's singular name.
- Identical structures (same `signature()`) reuse one name. Name collisions are prefixed with the parent name, then numbered.
- `inline` style names only the root.

### Emission (`generate.ts`)
- TypeScript: array elements with more than one member are parenthesised (`(A | null)[]`), decided structurally, not by string inspection.
- Zod: `z.union([...])` for multiple members, `.nullable()` for null, `.optional()` for optional keys. `z.record(z.string(), z.unknown())` for empty objects is valid in both v3 and v4.
- Outputs: `typescript` (interfaces), `zod` (schemas + `z.infer` aliases, standalone), `combined` (interfaces + schemas, no aliases, to avoid duplicate identifiers).
- `__proto__` keys are emitted as computed keys, because `__proto__:` in an object literal sets the prototype.

## 3. Extension host

- All network I/O happens in the extension host (`http.ts`). The webview only collects form state and renders results, so it is never subject to webview CORS.
- `{{VAR}}` tokens are resolved from the env file of the active file's workspace folder. Unresolved tokens abort the send with a message naming them.
- After a response, the host keeps the parsed value. Changing panel options posts `regenerate`, which re-runs generation without refetching.
- History is stored in `workspaceState`. `core/redact.ts` blanks literal secrets (auth fields, sensitive headers, URL query/userinfo, JSON and form body fields) before storage; `{{VAR}}` placeholders are kept. Other body formats are stored as typed.
- Every webview message goes through `safeHandle`, so a throwing handler posts an `error` message instead of leaving the UI on "Sending…".

## 4. Maintenance rules

1. Every change to inference or emission must keep `npm test` green. The round-trip suite is the contract: the generated schema must parse the source JSON with real Zod 4 and Zod 3, and the generated TypeScript must accept it.
2. Add a fixture under `test/fixtures/` for every bug report involving a specific payload.
3. Never use `innerHTML` with data in `media/panel.js`. Build nodes with the `h()` helper.
4. Keep `@types/vscode` pinned to the `engines.vscode` minimum, or `vsce` refuses to package.
