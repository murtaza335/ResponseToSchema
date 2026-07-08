"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiSchemaArchitectPanel = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Owns the single "API Schema Architect" Webview panel: its lifecycle,
 * message bridge, and the raw HTML/CSS/JS shell that renders the request
 * builder form. All actual HTTP work happens in the Extension Host
 * (see extension.ts) — this class never performs network I/O itself.
 */
class ApiSchemaArchitectPanel {
    static createOrShow(extensionUri, onMessage) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (ApiSchemaArchitectPanel.currentPanel) {
            ApiSchemaArchitectPanel.currentPanel.panel.reveal(column);
            return ApiSchemaArchitectPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(ApiSchemaArchitectPanel.viewType, 'API Schema Architect', column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        ApiSchemaArchitectPanel.currentPanel = new ApiSchemaArchitectPanel(panel, onMessage);
        return ApiSchemaArchitectPanel.currentPanel;
    }
    constructor(panel, onMessage) {
        this.disposables = [];
        this.panel = panel;
        this.panel.webview.html = this.getHtmlForWebview();
        this.panel.webview.onDidReceiveMessage((message) => onMessage(message), null, this.disposables);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }
    postMessage(message) {
        void this.panel.webview.postMessage(message);
    }
    dispose() {
        ApiSchemaArchitectPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
    getHtmlForWebview() {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net;"
/>
<script type="module" nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@vscode/webview-ui-toolkit@1.4.0/dist/toolkit.min.js"></script>
<link rel="stylesheet" nonce="${nonce}" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" />
<title>API Schema Architect</title>
<style>
  body {
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    padding: 16px;
  }
  .row { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
  .header-row { display: flex; gap: 8px; margin-bottom: 6px; }
  textarea, input, select {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 6px;
    font-family: var(--vscode-editor-font-family);
    font-size: 13px;
  }
  #urlInput { flex: 1; }
  #headersContainer { margin-bottom: 12px; }
  .section-title { font-weight: 600; margin: 14px 0 6px 0; }
  #statusLine { margin-top: 10px; font-size: 12px; opacity: 0.85; }
  button.icon-btn {
    background-color: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 2px;
    padding: 4px 8px;
    cursor: pointer;
  }
  #sendButton {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 2px;
    padding: 6px 16px;
    cursor: pointer;
  }
  #sendButton:hover { background-color: var(--vscode-button-hoverBackground); }
  #sendButton:disabled { opacity: 0.6; cursor: default; }
</style>
</head>
<body>
  <h2>API Schema Architect</h2>

  <div class="row">
    <select id="methodSelect">
      <option value="GET">GET</option>
      <option value="POST">POST</option>
      <option value="PUT">PUT</option>
      <option value="DELETE">DELETE</option>
    </select>
    <input id="urlInput" type="text" placeholder="https://api.example.com/resource?token={{API_TOKEN}}" />
    <button id="sendButton">Send</button>
  </div>

  <div class="section-title">Headers</div>
  <div id="headersContainer"></div>
  <button class="icon-btn" id="addHeaderButton">+ Add Header</button>

  <div class="section-title" id="bodySectionTitle">Body</div>
  <textarea id="bodyInput" rows="6" style="width:100%;" placeholder='{ "example": true }'></textarea>

  <div id="statusLine">Idle.</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const methodSelect = document.getElementById('methodSelect');
    const urlInput = document.getElementById('urlInput');
    const bodyInput = document.getElementById('bodyInput');
    const bodySectionTitle = document.getElementById('bodySectionTitle');
    const headersContainer = document.getElementById('headersContainer');
    const addHeaderButton = document.getElementById('addHeaderButton');
    const sendButton = document.getElementById('sendButton');
    const statusLine = document.getElementById('statusLine');

    function addHeaderRow(key, value) {
      const row = document.createElement('div');
      row.className = 'header-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.placeholder = 'Header-Name';
      keyInput.className = 'header-key';
      keyInput.value = key || '';

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.placeholder = 'value';
      valueInput.className = 'header-value';
      valueInput.value = value || '';

      const removeButton = document.createElement('button');
      removeButton.className = 'icon-btn';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => row.remove());

      row.appendChild(keyInput);
      row.appendChild(valueInput);
      row.appendChild(removeButton);
      headersContainer.appendChild(row);
    }

    function updateBodyVisibility() {
      const isGet = methodSelect.value === 'GET';
      bodyInput.style.display = isGet ? 'none' : 'block';
      bodySectionTitle.style.display = isGet ? 'none' : 'block';
    }

    function collectHeaders() {
      const headers = {};
      const rows = headersContainer.querySelectorAll('.header-row');
      rows.forEach((row) => {
        const key = row.querySelector('.header-key').value.trim();
        const value = row.querySelector('.header-value').value;
        if (key.length > 0) {
          headers[key] = value;
        }
      });
      return headers;
    }

    methodSelect.addEventListener('change', updateBodyVisibility);
    addHeaderButton.addEventListener('click', () => addHeaderRow('', ''));

    sendButton.addEventListener('click', () => {
      if (!urlInput.value || urlInput.value.trim().length === 0) {
        statusLine.textContent = 'Enter a URL before sending.';
        return;
      }

      statusLine.textContent = 'Sending request...';
      sendButton.disabled = true;

      vscode.postMessage({
        type: 'executeRequest',
        payload: {
          method: methodSelect.value,
          url: urlInput.value,
          headers: collectHeaders(),
          body: methodSelect.value === 'GET' ? '' : bodyInput.value
        }
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'requestSuccess') {
        statusLine.textContent = 'Success (' + message.status + '). Generated code opened beside this panel.';
        sendButton.disabled = false;
      } else if (message.type === 'requestError') {
        statusLine.textContent = 'Error: ' + message.error;
        sendButton.disabled = false;
      }
    });

    addHeaderRow('Content-Type', 'application/json');
    updateBodyVisibility();
  </script>
</body>
</html>`;
    }
}
exports.ApiSchemaArchitectPanel = ApiSchemaArchitectPanel;
ApiSchemaArchitectPanel.viewType = 'apiSchemaArchitect.dashboard';
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=webviewProvider.js.map