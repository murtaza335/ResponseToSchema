const Module = require('module');
const http = require('http');
const path = require('path');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');

// Smoke test of the bundled extension (dist/extension.js) against a mocked
// `vscode` module and a local HTTP server. Run with `npm run test:host`.
const repoRoot = path.resolve(__dirname, '..');
const extPath = path.join(repoRoot, 'dist', 'extension.js');
const wsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'r2s-ws-'));
fs.writeFileSync(path.join(wsPath, '.env'), 'API_KEY=sekret\nexport TOKEN="tok123"\n');

// The page drops messages posted before its script is running, as the real webview does.
let pageReady = false;
const posted = []; let onMsg; const commands = {}; const shown = []; let clipboard = '';
const memento = () => { const m = new Map(); return { get: (k, d) => m.has(k) ? m.get(k) : d, update: async (k, v) => { m.set(k, v); } }; };
const Uri = { file: (p) => ({ fsPath: p, path: p, scheme: 'file' }), joinPath: (u, ...p) => Uri.file(path.join(u.fsPath, ...p)) };
const config = { get: (k, d) => d };
class Position { constructor(line, character) { this.line = line; this.character = character; } }

// Minimal editable text buffer standing in for a TextEditor.
function fakeEditor(text, cursor) {
  const doc = { isClosed: false, getText: () => text, get lineCount() { return text.split('\n').length; }, lineAt: (i) => { const l = text.split('\n')[i]; return { range: { end: new Position(i, l.length) } }; } };
  const editor = { document: doc, viewColumn: 1, selections: [{ start: cursor }] };
  editor.edit = async (cb) => {
    cb({ insert: (pos, t) => apply(pos, t), replace: (sel, t) => apply(sel.start, t) });
    return true;
  };
  function apply(pos, t) {
    const lines = text.split('\n');
    const offset = lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character;
    text = text.slice(0, offset) + t + text.slice(offset);
    if (editor.selections[0].start.line >= pos.line && t.includes('\n') && pos.character === 0) editor.selections[0].start = new Position(editor.selections[0].start.line + t.split('\n').length - 1, editor.selections[0].start.character);
  }
  doc.__editor = editor;
  editor.text = () => text;
  return editor;
}

const vscode = {
  Position, Uri, ViewColumn: { Active: -1, Beside: -2 },
  commands: { registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; }, executeCommand: async () => {} },
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    registerWebviewPanelSerializer: () => ({ dispose() {} }),
    showErrorMessage: (m) => shown.push(['err', m]), showWarningMessage: (m) => shown.push(['warn', m]), showInformationMessage: (m) => shown.push(['info', m]),
    showInputBox: async (o) => o.value,
    showTextDocument: async (doc) => { shown.push(['doc', doc.content]); return doc.__editor || {}; },
    createWebviewPanel: () => ({
      webview: { cspSource: 'vscode-resource:', asWebviewUri: (u) => u.fsPath, html: '', options: {},
        onDidReceiveMessage: (fn) => { onMsg = (m) => { if (m.type === 'ready') pageReady = true; return fn(m); }; return { dispose() {} }; },
        postMessage: async (m) => { if (pageReady) posted.push(m); } },
      onDidDispose: () => ({ dispose() {} }), onDidChangeViewState: () => ({ dispose() {} }), reveal() {}, visible: true,
    }),
  },
  workspace: {
    workspaceFolders: [{ uri: Uri.file(wsPath), name: 'ws', index: 0 }],
    getWorkspaceFolder: () => undefined,
    getConfiguration: () => config,
    asRelativePath: (u) => path.relative(wsPath, u.fsPath),
    fs: { readFile: async (u) => fs.readFileSync(u.fsPath), writeFile: async () => {} },
    openTextDocument: async (o) => o,
  },
  env: { clipboard: { readText: async () => clipboard, writeText: async (t) => { clipboard = t; } } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : origLoad.call(this, req, ...rest); };

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/html')) { res.setHeader('content-type', 'text/html'); return res.end('<h1>hi</h1>'); }
  if (req.url.startsWith('/bom')) { res.setHeader('content-type', 'application/json'); return res.end('\uFEFF{"a":1}'); }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ seen: { key: req.headers['x-api-key'], auth: req.headers['authorization'], path: req.url },
    data: [{ id: 1, email: 'a@b.io' }, { id: 2, email: 'c@d.io', nick: 'x' }] }));
});

const wait = (pred, ms = 3000) => new Promise((resolve, reject) => {
  const t0 = Date.now(); const tick = () => { const v = pred(); if (v) return resolve(v); if (Date.now() - t0 > ms) return reject(new Error('timeout')); setTimeout(tick, 10); }; tick();
});
const last = (type) => [...posted].reverse().find((m) => m.type === type);
const opts = { rootName: '', outputMode: 'combined', style: 'named', zodVersion: '4', includeFetcher: true };

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ctx = { subscriptions: [], workspaceState: memento(), globalState: memento(), extensionUri: Uri.file(repoRoot), extension: { id: 'murtaza335.response-to-schema' } };
    require(extPath).activate(ctx);
    assert.deepEqual(Object.keys(commands).sort(), ['responseToSchema.clearHistory', 'responseToSchema.generateFromFile', 'responseToSchema.generateFromSelection', 'responseToSchema.importCurl', 'responseToSchema.openPanel', 'responseToSchema.pasteJsonAsCode']);
    // cold start: Import cURL creates the panel, and the request must survive until the webview is ready
    clipboard = "curl -X PUT 'http://x.dev/a' -u ada:pw --json '{\"r\":1}'";
    await commands['responseToSchema.importCurl']();
    assert.equal(posted.filter((m) => m.type === 'loadRequest').length, 0, 'nothing can be delivered before the page is ready');
    onMsg({ type: 'ready' });
    const cold = await wait(() => last('loadRequest'));
    assert.equal(cold.request.method, 'PUT');
    assert.deepEqual(cold.request.auth, { type: 'basic', username: 'ada', password: 'pw' });
    console.log('ok cold-start Import cURL is delivered once the webview is ready');
    posted.length = 0;

    commands['responseToSchema.openPanel']();
    onMsg({ type: 'ready' });
    const env = await wait(() => last('env'));
    assert.deepEqual(env.env, { path: '.env', count: 2 });
    console.log('ok activation + env', env.env);

    // send with env placeholders
    const request = { method: 'GET', url: `${base}/v1/users?page=1`, headers: [{ key: 'X-Api-Key', value: '{{API_KEY}}', enabled: true }, { key: 'X-Off', value: 'no', enabled: false }], body: '', auth: { type: 'bearer', token: 'literal-secret' } };
    onMsg({ type: 'send', request, options: opts });
    const gen = await wait(() => last('generated'));
    const resp = last('response').response;
    const seen = JSON.parse(resp.body).seen;
    assert.equal(seen.key, 'sekret'); assert.equal(seen.auth, 'Bearer literal-secret');
    assert.equal(resp.status, 200); assert.ok(resp.isJson);
    assert.equal(gen.rootName, 'Users');
    assert.match(gen.code, /export interface User \{/); assert.match(gen.code, /nick\?: string;/); assert.match(gen.code, /email: z\.email\(\)/);
    assert.match(gen.code, /export async function fetchUsers/);
    console.log('ok send + generate, root =', gen.rootName);

    // history redaction
    const hist = ctx.workspaceState.get('responseToSchema.history', []);
    assert.equal(hist.length, 1); assert.equal(hist[0].request.auth.token, ''); assert.equal(hist[0].request.headers[0].value, '{{API_KEY}}');
    console.log('ok history redacts literal secret, keeps placeholders');

    // regenerate with options
    posted.length = 0;
    onMsg({ type: 'regenerate', options: { ...opts, rootName: 'people', outputMode: 'zod', zodVersion: '3', includeFetcher: false } });
    const regen = await wait(() => last('generated'));
    assert.equal(regen.rootName, 'People'); assert.match(regen.code, /z\.string\(\)\.email\(\)/); assert.match(regen.code, /export type People = z\.infer/);
    console.log('ok regenerate without refetch');

    // actions
    onMsg({ type: 'action', action: 'copy' }); await wait(() => clipboard.includes('PeopleSchema'));
    onMsg({ type: 'action', action: 'open' }); await wait(() => shown.some((s) => s[0] === 'doc'));
    console.log('ok copy + open in editor');

    // unresolved variable
    posted.length = 0;
    onMsg({ type: 'send', request: { ...request, url: `${base}/{{MISSING}}` }, options: opts });
    const err = await wait(() => last('error'));
    assert.match(err.message, /Unresolved variable \{\{MISSING\}\} in \.env/);
    console.log('ok unresolved var:', err.message);

    // non-JSON
    posted.length = 0;
    onMsg({ type: 'send', request: { ...request, url: `${base}/html` }, options: opts });
    const g2 = await wait(() => last('generated'));
    assert.match(g2.error, /not JSON \(text\/html\)/);
    console.log('ok non-JSON:', g2.error);

    // connection refused
    posted.length = 0;
    onMsg({ type: 'send', request: { ...request, url: 'http://127.0.0.1:59999/' }, options: opts });
    const refused = (await wait(() => last('error'))).message;
    assert.match(refused, /Connection refused by 127\.0\.0\.1:59999/);
    console.log('ok refused:', refused);

    // ports on the fetch "bad ports" list get an explanation instead of "fetch failed"
    posted.length = 0;
    onMsg({ type: 'send', request: { ...request, url: 'http://127.0.0.1:6000/' }, options: opts });
    const badPort = (await wait(() => last('error'))).message;
    assert.match(badPort, /Port 6000 is on the fetch standard's blocked-ports list/);
    console.log('ok bad port:', badPort.slice(0, 60) + '…');

    // curl import
    posted.length = 0;
    onMsg({ type: 'importCurl', text: `curl '${base}/x' -H 'Authorization: Bearer abc' --json '{"a":1}'` });
    const lr = await wait(() => last('loadRequest'));
    assert.equal(lr.request.method, 'POST'); assert.deepEqual(lr.request.auth, { type: 'bearer', token: 'abc' });
    console.log('ok curl import');

    // clipboard JSON
    posted.length = 0; clipboard = '[{"a":1}]';
    onMsg({ type: 'useClipboard', options: { ...opts, rootName: '' } });
    const g3 = await wait(() => last('generated'));
    assert.equal(g3.rootName, 'Root'); assert.doesNotMatch(g3.code, /fetchRoot/);
    console.log('ok clipboard JSON');

    // history must not keep secrets from the URL or body
    await wait(() => true);
    posted.length = 0;
    onMsg({ type: 'send', request: { ...request, method: 'POST', url: `${base}/v1/login?api_key=ZZZ&page=1`, body: '{"user":"ada","password":"hunter2"}' }, options: opts });
    await wait(() => last('generated'));
    const stored = JSON.stringify(ctx.workspaceState.get('responseToSchema.history', []));
    assert.ok(!stored.includes('ZZZ') && !stored.includes('hunter2') && !stored.includes('literal-secret'), 'secret leaked into history: ' + stored);
    assert.ok(stored.includes('page=1') && stored.includes('ada'));
    console.log('ok history keeps no secrets from URL/body');

    // a response with a UTF-8 BOM is still JSON
    posted.length = 0;
    onMsg({ type: 'send', request: { ...request, url: `${base}/bom` }, options: opts });
    const bom = await wait(() => last('generated'));
    assert.match(bom.code, /a: number;/);
    console.log('ok BOM-prefixed JSON');

    // a throwing handler must reach the UI instead of hanging it
    posted.length = 0;
    const realRead = vscode.env.clipboard.readText;
    vscode.env.clipboard.readText = async () => { throw new Error('clipboard exploded'); };
    onMsg({ type: 'useClipboard', options: opts });
    assert.equal((await wait(() => last('error'))).message, 'clipboard exploded');
    vscode.env.clipboard.readText = realRead;
    console.log('ok handler failure surfaces as an error message');

    // insert at cursor: import goes with the other imports, body at the cursor
    clipboard = '{"id":1}';
    onMsg({ type: 'useClipboard', options: { ...opts, rootName: 'Thing', includeFetcher: false } });
    await wait(() => last('generated') && last('generated').rootName === 'Thing');
    let ed = fakeEditor("import a from 'a';\nimport {\n  b,\n} from 'b';\n\nfunction f() {\n  \n}\n", new Position(6, 2));
    vscode.window.activeTextEditor = ed;
    onMsg({ type: 'action', action: 'insert' });
    await wait(() => ed.text().includes('ThingSchema'));
    let lines = ed.text().split('\n');
    assert.equal(lines[4], "import { z } from 'zod';", ed.text());
    assert.ok(lines.indexOf('function f() {') > 4 && ed.text().indexOf('export interface Thing') > ed.text().indexOf('function f() {'), ed.text());
    assert.equal(ed.text().match(/from 'zod'/g).length, 1);
    // already importing zod: no second import
    ed = fakeEditor("import { z } from 'zod';\n", new Position(1, 0));
    vscode.window.activeTextEditor = ed;
    onMsg({ type: 'action', action: 'insert' });
    await wait(() => ed.text().includes('ThingSchema'));
    assert.equal(ed.text().match(/from 'zod'/g).length, 1, ed.text());
    // file that ends right after an import without a newline
    ed = fakeEditor("import a from 'a';", new Position(0, 0));
    vscode.window.activeTextEditor = ed;
    onMsg({ type: 'action', action: 'insert' });
    await wait(() => ed.text().includes('ThingSchema'));
    assert.match(ed.text(), /import a from 'a';\nimport \{ z \} from 'zod';\n$/, ed.text());
    vscode.window.activeTextEditor = undefined;
    console.log('ok insert at cursor places the zod import with the other imports');

    // editor command: generate from file
    shown.length = 0;
    await commands['responseToSchema.generateFromFile'](Uri.file(path.join(repoRoot, 'test/fixtures/github-user.json')));
    assert.match(shown.find((s) => s[0] === 'doc')[1], /export interface GithubUser/);
    console.log('ok generateFromFile');
    console.log('ALL HOST TESTS PASSED');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  server.close();
});
