// @ts-check
/* Webview UI for ResponseToSchema. Talks to the extension host via postMessage;
 * never performs network requests itself. All DOM is built with textContent,
 * never innerHTML, because header values and responses are untrusted. */
(function () {
  const vscode = acquireVsCodeApi();
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  /** @type {any} */
  const saved = vscode.getState() || {};
  const state = {
    request: saved.request || emptyRequest(),
    options: saved.options || null,
    requestTab: saved.requestTab || 'headers',
    outputTab: saved.outputTab || 'schema',
    sending: false,
    code: '',
    response: null,
  };

  function emptyRequest() {
    return {
      method: 'GET',
      url: '',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      body: '',
      auth: { type: 'none' },
    };
  }

  // ---------------------------------------------------------------------------
  // Tiny DOM helper
  // ---------------------------------------------------------------------------

  /**
   * @param {string} tag
   * @param {Record<string, any>} [props]
   * @param {...(Node|string|null|undefined|false)} children
   */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'className') el.className = value;
      else if (key in el && key !== 'list') /** @type {any} */ (el)[key] = value;
      else if (value !== false) el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child);
    }
    return el;
  }

  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  function persist() {
    vscode.setState({ request: state.request, options: state.options, requestTab: state.requestTab, outputTab: state.outputTab });
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const app = $('app');
  app.append(
    h('header', { className: 'bar' },
      h('select', { id: 'method', title: 'HTTP method', onchange: onFieldChange }, ...METHODS.map((m) => h('option', { value: m }, m))),
      h('input', {
        id: 'url', type: 'text', spellcheck: false, autocomplete: 'off',
        placeholder: 'https://api.example.com/users/1   or paste a cURL command',
        oninput: onFieldChange, onpaste: onUrlPaste,
      }),
      h('button', { id: 'send', className: 'primary', title: 'Send (Ctrl+Enter)', onclick: onSendClick }, 'Send')
    ),
    h('div', { className: 'subbar' },
      h('span', { id: 'envInfo', className: 'muted' }),
      h('span', { className: 'muted sep' }, '·'),
      h('a', { href: '#', id: 'fromClipboard', onclick: onClipboardClick, title: 'Generate types from JSON or a cURL command on the clipboard' }, 'Use clipboard JSON'),
      h('span', { className: 'spacer' }),
      h('select', { id: 'history', title: 'Recent requests', onchange: onHistoryChange })
    ),

    h('section', { className: 'card' },
      h('nav', { className: 'tabs', id: 'requestTabs' },
        tabButton('requestTab', 'headers', 'Headers', h('span', { id: 'headerCount', className: 'badge' })),
        tabButton('requestTab', 'auth', 'Auth'),
        tabButton('requestTab', 'body', 'Body')
      ),
      h('div', { className: 'pane', 'data-pane': 'headers' },
        h('div', { id: 'headerRows', className: 'kv' }),
        h('button', { className: 'ghost', onclick: () => { state.request.headers.push({ key: '', value: '', enabled: true }); renderHeaders(true); } }, '+ Add header')
      ),
      h('div', { className: 'pane', 'data-pane': 'auth' },
        h('div', { className: 'row' },
          h('select', { id: 'authType', onchange: onAuthTypeChange },
            h('option', { value: 'none' }, 'No auth'),
            h('option', { value: 'bearer' }, 'Bearer token'),
            h('option', { value: 'basic' }, 'Basic auth'))
        ),
        h('div', { id: 'authFields', className: 'stack' }),
        h('p', { className: 'muted small' }, 'Tip: use {{VARIABLE}} placeholders resolved from your .env file. Auth values, sensitive headers and fields named like token, password or api_key are blanked in request history.')
      ),
      h('div', { className: 'pane', 'data-pane': 'body' },
        h('textarea', { id: 'body', rows: 8, spellcheck: false, placeholder: '{\n  "name": "Ada"\n}', oninput: onFieldChange }),
        h('div', { className: 'row end' }, h('button', { className: 'ghost', onclick: formatBody }, 'Format JSON'))
      )
    ),

    h('section', { className: 'card output' },
      h('div', { className: 'options' },
        h('label', null, 'Root type',
          h('input', { id: 'rootName', type: 'text', placeholder: 'auto', spellcheck: false, oninput: debounce(onOptionsChange, 250) })),
        h('label', null, 'Output',
          select('outputMode', [['combined', 'Zod + TypeScript'], ['zod', 'Zod only'], ['typescript', 'TypeScript only']])),
        h('label', null, 'Style',
          select('style', [['named', 'Named types'], ['inline', 'Inline']])),
        h('label', null, 'Zod',
          select('zodVersion', [['4', 'v4'], ['3', 'v3']])),
        h('label', { className: 'check', title: 'Append a typed fetch function that validates the response' },
          h('input', { id: 'includeFetcher', type: 'checkbox', onchange: onOptionsChange }), 'fetch helper')
      ),
      h('div', { id: 'status', className: 'status' }),
      h('nav', { className: 'tabs' },
        tabButton('outputTab', 'schema', 'Schema'),
        tabButton('outputTab', 'response', 'Response'),
        tabButton('outputTab', 'headers', 'Response headers')
      ),
      h('div', { className: 'pane', 'data-pane': 'schema' },
        h('div', { id: 'empty', className: 'empty' },
          h('h2', null, 'Send a request to generate types'),
          h('p', null, 'The JSON response becomes a TypeScript interface and a matching Zod schema. Type names come from the URL; change the root name above.'),
          h('ul', null,
            h('li', null, 'Paste a cURL command into the URL bar to fill in the whole request.'),
            h('li', null, 'No API handy? Copy any JSON and click "Use clipboard JSON".'),
            h('li', null, 'Press Ctrl+Enter to send.'))
        ),
        h('pre', { id: 'code', className: 'code', tabIndex: 0 }),
        h('div', { id: 'actions', className: 'row actions' },
          h('button', { className: 'primary', onclick: () => action('insert'), title: 'Insert at the cursor in the last active editor' }, 'Insert at cursor'),
          h('button', { onclick: () => action('copy') }, 'Copy'),
          h('button', { onclick: () => action('open') }, 'Open in editor'),
          h('button', { onclick: () => action('save') }, 'Save as…'))
      ),
      h('div', { className: 'pane', 'data-pane': 'response' }, h('pre', { id: 'responseBody', className: 'code', tabIndex: 0 })),
      h('div', { className: 'pane', 'data-pane': 'headers' }, h('table', { id: 'responseHeaders', className: 'headers' }))
    ),
    h('div', { id: 'toast', className: 'toast', role: 'status' })
  );

  /** @param {'requestTab'|'outputTab'} group @param {string} id @param {string} label @param {Node} [extra] */
  function tabButton(group, id, label, extra) {
    return h('button', {
      className: 'tab', 'data-group': group, 'data-tab': id,
      onclick: () => { state[group] = id; persist(); renderTabs(); },
    }, label, extra);
  }

  /** @param {string} id @param {[string, string][]} options */
  function select(id, options) {
    return h('select', { id, onchange: onOptionsChange }, ...options.map(([value, label]) => h('option', { value }, label)));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function renderTabs() {
    for (const group of ['requestTab', 'outputTab']) {
      const active = state[group];
      document.querySelectorAll(`.tab[data-group="${group}"]`).forEach((tab) => {
        const el = /** @type {HTMLElement} */ (tab);
        el.classList.toggle('active', el.dataset.tab === active);
        const pane = el.closest('section')?.querySelector(`.pane[data-pane="${el.dataset.tab}"]`);
        pane?.classList.toggle('active', el.dataset.tab === active);
      });
    }
  }

  function renderRequest() {
    const r = state.request;
    /** @type {HTMLSelectElement} */ ($('method')).value = r.method;
    /** @type {HTMLInputElement} */ ($('url')).value = r.url;
    /** @type {HTMLTextAreaElement} */ ($('body')).value = r.body;
    /** @type {HTMLSelectElement} */ ($('authType')).value = r.auth.type;
    renderHeaders(false);
    renderAuth();
  }

  /** @param {boolean} focusLast */
  function renderHeaders(focusLast) {
    const container = $('headerRows');
    container.replaceChildren(
      ...state.request.headers.map((header, index) =>
        h('div', { className: 'kv-row' + (header.enabled ? '' : ' disabled') },
          h('input', { type: 'checkbox', checked: header.enabled, title: 'Enabled', onchange: (/** @type {any} */ e) => { header.enabled = e.target.checked; renderHeaders(false); persist(); } }),
          h('input', { type: 'text', value: header.key, placeholder: 'Header', spellcheck: false, oninput: (/** @type {any} */ e) => { header.key = e.target.value; updateHeaderCount(); persist(); } }),
          h('input', { type: 'text', value: header.value, placeholder: 'Value', spellcheck: false, oninput: (/** @type {any} */ e) => { header.value = e.target.value; persist(); } }),
          h('button', { className: 'icon', title: 'Remove header', 'aria-label': 'Remove header', onclick: () => { state.request.headers.splice(index, 1); renderHeaders(false); persist(); } }, '×')
        )
      )
    );
    updateHeaderCount();
    if (focusLast) /** @type {HTMLInputElement|null} */ (container.querySelector('.kv-row:last-child input[type=text]'))?.focus();
  }

  function updateHeaderCount() {
    const count = state.request.headers.filter((/** @type {any} */ x) => x.enabled && x.key.trim()).length;
    $('headerCount').textContent = count ? String(count) : '';
  }

  function renderAuth() {
    const auth = state.request.auth;
    const field = (/** @type {string} */ key, /** @type {string} */ placeholder, type = 'text') =>
      h('input', { type, value: auth[key] || '', placeholder, spellcheck: false, oninput: (/** @type {any} */ e) => { auth[key] = e.target.value; persist(); } });
    const fields = $('authFields');
    if (auth.type === 'bearer') fields.replaceChildren(field('token', 'Token or {{API_TOKEN}}'));
    else if (auth.type === 'basic') fields.replaceChildren(field('username', 'Username'), field('password', 'Password', 'password'));
    else fields.replaceChildren();
  }

  function renderOptions() {
    const o = state.options;
    if (!o) return;
    /** @type {HTMLInputElement} */ ($('rootName')).value = o.rootName;
    /** @type {HTMLSelectElement} */ ($('outputMode')).value = o.outputMode;
    /** @type {HTMLSelectElement} */ ($('style')).value = o.style;
    /** @type {HTMLSelectElement} */ ($('zodVersion')).value = o.zodVersion;
    /** @type {HTMLInputElement} */ ($('includeFetcher')).checked = o.includeFetcher;
  }

  function renderSending() {
    const button = $('send');
    button.textContent = state.sending ? 'Cancel' : 'Send';
    button.classList.toggle('danger', state.sending);
    if (state.sending) setStatus([h('span', { className: 'spinner' }), 'Sending…'], '');
  }

  /** @param {(Node|string)[]} parts @param {string} kind */
  function setStatus(parts, kind) {
    const status = $('status');
    status.className = 'status ' + kind;
    status.replaceChildren(...parts);
  }

  /** @param {any} r */
  function renderResponse(r) {
    state.response = r;
    if (r.source === 'clipboard') {
      setStatus([h('span', { className: 'pill ok' }, 'Clipboard'), h('span', { className: 'muted' }, 'Generated from clipboard JSON')], '');
    } else {
      setStatus([
        h('span', { className: 'pill ' + (r.ok ? 'ok' : 'bad') }, `${r.status} ${r.statusText || ''}`.trim()),
        h('span', { className: 'muted' }, `${r.timeMs} ms`),
        h('span', { className: 'muted' }, formatBytes(r.sizeBytes)),
        r.contentType ? h('span', { className: 'muted' }, r.contentType.split(';')[0]) : null,
      ], '');
    }
    const body = $('responseBody');
    body.replaceChildren(r.isJson ? highlight(r.body, 'json') : document.createTextNode(r.body || '(empty body)'));
    if (r.truncated) body.append(h('span', { className: 'muted' }, '\n… preview truncated'));
    $('responseHeaders').replaceChildren(
      ...r.headers.map((/** @type {[string,string]} */ [k, v]) => h('tr', null, h('th', null, k), h('td', null, v)))
    );
  }

  /** @param {string} code */
  function renderCode(code) {
    state.code = code;
    $('empty').hidden = !!code;
    $('code').hidden = !code;
    $('actions').hidden = !code;
    $('code').replaceChildren(highlight(code, 'ts'));
  }

  /** @param {any[]} history */
  function renderHistory(history) {
    const select = /** @type {HTMLSelectElement} */ ($('history'));
    select.replaceChildren(
      h('option', { value: '' }, history.length ? `History (${history.length})` : 'No history'),
      ...history.map((entry) => h('option', { value: entry.id, title: entry.label }, `${entry.status ? entry.status + '  ' : ''}${truncate(entry.label, 70)}`)),
      history.length ? h('option', { value: '__clear' }, 'Clear history') : null
    );
    select.disabled = history.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Syntax highlighting (builds text nodes and spans, no innerHTML)
  // ---------------------------------------------------------------------------

  const TS_TOKENS = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(export|interface|type|const|import|from|async|function|return|await|if|throw|new|typeof)\b|\b(string|number|boolean|null|unknown|Record|Promise|RequestInit|true|false)\b|\b(z)\b|\b([A-Z][A-Za-z0-9_]*)/g;
  const JSON_TOKENS = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  const HIGHLIGHT_LIMIT = 120_000;

  /** @param {string} text @param {'ts'|'json'} lang */
  function highlight(text, lang) {
    const fragment = document.createDocumentFragment();
    const source = text.length > HIGHLIGHT_LIMIT ? text.slice(0, HIGHLIGHT_LIMIT) : text;
    const regex = lang === 'ts' ? TS_TOKENS : JSON_TOKENS;
    regex.lastIndex = 0;
    let last = 0;
    let match;
    while ((match = regex.exec(source))) {
      if (match.index > last) fragment.append(source.slice(last, match.index));
      let cls = '';
      if (lang === 'ts') {
        cls = match[1] ? 'tok-comment' : match[2] ? 'tok-string' : match[3] ? 'tok-keyword' : match[4] ? 'tok-type' : match[5] ? 'tok-zod' : 'tok-name';
        fragment.append(h('span', { className: cls }, match[0]));
      } else if (match[1]) {
        fragment.append(h('span', { className: match[2] ? 'tok-key' : 'tok-string' }, match[1]));
        if (match[2]) fragment.append(match[2]);
      } else {
        fragment.append(h('span', { className: match[3] ? 'tok-number' : 'tok-keyword' }, match[0]));
      }
      last = regex.lastIndex;
    }
    fragment.append(source.slice(last));
    if (source !== text) fragment.append(text.slice(HIGHLIGHT_LIMIT));
    return fragment;
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  function onFieldChange() {
    state.request.method = /** @type {HTMLSelectElement} */ ($('method')).value;
    state.request.url = /** @type {HTMLInputElement} */ ($('url')).value;
    state.request.body = /** @type {HTMLTextAreaElement} */ ($('body')).value;
    persist();
  }

  /** @param {ClipboardEvent} event */
  function onUrlPaste(event) {
    const text = event.clipboardData?.getData('text') || '';
    if (/^\s*curl(\.exe)?\s/i.test(text)) {
      event.preventDefault();
      vscode.postMessage({ type: 'importCurl', text });
    }
  }

  function onAuthTypeChange() {
    const type = /** @type {HTMLSelectElement} */ ($('authType')).value;
    state.request.auth = type === 'bearer' ? { type, token: '' } : type === 'basic' ? { type, username: '', password: '' } : { type: 'none' };
    renderAuth();
    persist();
  }

  function readOptions() {
    return {
      rootName: /** @type {HTMLInputElement} */ ($('rootName')).value.trim(),
      outputMode: /** @type {HTMLSelectElement} */ ($('outputMode')).value,
      style: /** @type {HTMLSelectElement} */ ($('style')).value,
      zodVersion: /** @type {HTMLSelectElement} */ ($('zodVersion')).value,
      includeFetcher: /** @type {HTMLInputElement} */ ($('includeFetcher')).checked,
    };
  }

  function onOptionsChange() {
    state.options = readOptions();
    persist();
    vscode.postMessage({ type: 'regenerate', options: state.options });
  }

  function onSendClick() {
    if (state.sending) {
      vscode.postMessage({ type: 'cancel' });
      return;
    }
    onFieldChange();
    if (!state.request.url.trim()) {
      toast('Enter a URL first.', true);
      $('url').focus();
      return;
    }
    vscode.postMessage({ type: 'send', request: state.request, options: readOptions() });
  }

  /** @param {Event} event */
  function onClipboardClick(event) {
    event.preventDefault();
    vscode.postMessage({ type: 'useClipboard', options: readOptions() });
  }

  function onHistoryChange() {
    const select = /** @type {HTMLSelectElement} */ ($('history'));
    const id = select.value;
    select.value = '';
    if (id === '__clear') vscode.postMessage({ type: 'clearHistory' });
    else if (id) vscode.postMessage({ type: 'loadHistory', id });
  }

  function formatBody() {
    try {
      state.request.body = JSON.stringify(JSON.parse(state.request.body), null, 2);
      /** @type {HTMLTextAreaElement} */ ($('body')).value = state.request.body;
      persist();
    } catch (err) {
      toast('Body is not valid JSON.', true);
    }
  }

  /** @param {string} name */
  function action(name) {
    vscode.postMessage({ type: 'action', action: name });
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      onSendClick();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'init':
        if (!state.options) state.options = message.options;
        if (!saved.request && message.request) state.request = message.request;
        renderOptions();
        renderRequest();
        renderHistory(message.history);
        persist();
        break;
      case 'env':
        $('envInfo').textContent = message.env.path ? `${message.env.path} · ${message.env.count} variable${message.env.count === 1 ? '' : 's'}` : 'No .env file';
        $('envInfo').title = 'Variables available as {{NAME}} in the URL, headers, auth and body';
        break;
      case 'loadRequest':
        state.request = message.request;
        renderRequest();
        persist();
        if (state.request.body && state.request.method !== 'GET') { state.requestTab = 'body'; renderTabs(); }
        break;
      case 'sending':
        state.sending = true;
        renderSending();
        break;
      case 'response':
        state.sending = false;
        renderSending();
        renderResponse(message.response);
        break;
      case 'generated':
        if (message.error) {
          renderCode('');
          toast(message.error, true);
          state.outputTab = 'response';
          renderTabs();
        } else {
          renderCode(message.code);
          /** @type {HTMLInputElement} */ ($('rootName')).placeholder = message.rootName;
          if (state.outputTab !== 'schema') { state.outputTab = 'schema'; renderTabs(); }
        }
        break;
      case 'error':
        state.sending = false;
        renderSending();
        setStatus([h('span', { className: 'pill bad' }, 'Error'), message.message], 'error');
        break;
      case 'history':
        renderHistory(message.history);
        break;
      case 'toast':
        toast(message.message, false);
        break;
    }
  });

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  let toastTimer = 0;
  /** @param {string} text @param {boolean} isError */
  function toast(text, isError) {
    const el = $('toast');
    el.textContent = text;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, isError ? 6000 : 2500);
  }

  /** @param {number} bytes */
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /** @param {string} s @param {number} n */
  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /** @param {() => void} fn @param {number} ms */
  function debounce(fn, ms) {
    let t = 0;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  renderTabs();
  renderRequest();
  renderCode('');
  vscode.postMessage({ type: 'ready' });
})();
