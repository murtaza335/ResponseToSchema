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

const posted = []; let onMsg; const commands = {}; const shown = []; let clipboard = '';
const memento = () => { const m = new Map(); return { get: (k, d) => m.has(k) ? m.get(k) : d, update: async (k, v) => { m.set(k, v); } }; };
const Uri = { file: (p) => ({ fsPath: p, path: p, scheme: 'file' }), joinPath: (u, ...p) => Uri.file(path.join(u.fsPath, ...p)) };
const config = { get: (k, d) => d };
const vscode = {
  Uri, ViewColumn: { Active: -1, Beside: -2 },
  commands: { registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; }, executeCommand: async () => {} },
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    registerWebviewPanelSerializer: () => ({ dispose() {} }),
    showErrorMessage: (m) => shown.push(['err', m]), showWarningMessage: (m) => shown.push(['warn', m]), showInformationMessage: (m) => shown.push(['info', m]),
    showInputBox: async (o) => o.value,
    showTextDocument: async (doc) => { shown.push(['doc', doc.content]); return {}; },
    createWebviewPanel: () => ({
      webview: { cspSource: 'vscode-resource:', asWebviewUri: (u) => u.fsPath, html: '', options: {},
        onDidReceiveMessage: (fn) => { onMsg = fn; return { dispose() {} }; },
        postMessage: async (m) => { posted.push(m); } },
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
    onMsg({ type: 'send', request: { ...request, url: 'http://127.0.0.1:1/' }, options: opts });
    console.log('ok refused:', (await wait(() => last('error'))).message);

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

    // editor command: generate from file
    shown.length = 0;
    await commands['responseToSchema.generateFromFile'](Uri.file(path.join(repoRoot, 'test/fixtures/github-user.json')));
    assert.match(shown.find((s) => s[0] === 'doc')[1], /export interface GithubUser/);
    console.log('ok generateFromFile');
    console.log('ALL HOST TESTS PASSED');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  server.close();
});
