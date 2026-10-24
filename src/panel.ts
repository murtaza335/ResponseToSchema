import * as vscode from 'vscode';
import { RequestSpec, isCurlCommand, parseCurl } from './core/curl';
import { GenerateResult, generateFromValue } from './core/generate';
import { rootNameFromUrl, toPascalCase } from './core/naming';
import { PanelOptions, defaultPanelOptions, generateOptions } from './config';
import { RequestHistory } from './history';
import { HttpResult, loadEnv, sendRequest } from './http';
import { insertIntoEditor, openInEditor, pickOutput, saveToFile } from './output';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'send'; request: RequestSpec; options: PanelOptions }
  | { type: 'cancel' }
  | { type: 'importCurl'; text: string }
  | { type: 'regenerate'; options: PanelOptions }
  | { type: 'useClipboard'; options: PanelOptions }
  | { type: 'action'; action: 'copy' | 'open' | 'insert' | 'save' }
  | { type: 'loadHistory'; id: string }
  | { type: 'clearHistory' }
  | { type: 'openSettings' };

/** Largest response body sent to the webview for display; generation always uses the full body. */
const PREVIEW_LIMIT = 300_000;

export class SchemaPanel {
  public static readonly viewType = 'responseToSchema.panel';
  private static current: SchemaPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private options: PanelOptions = defaultPanelOptions();
  private lastRequest: RequestSpec | undefined;
  private lastValue: unknown;
  private hasValue = false;
  private lastResult: GenerateResult | undefined;
  private inflight: AbortController | undefined;
  /** False until the webview script has loaded; earlier postMessage calls are silently lost. */
  private webviewReady = false;
  private pendingRequest: RequestSpec | undefined;

  static show(context: vscode.ExtensionContext, history: RequestHistory): SchemaPanel {
    if (SchemaPanel.current) {
      SchemaPanel.current.panel.reveal();
      return SchemaPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(SchemaPanel.viewType, 'ResponseToSchema', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    SchemaPanel.current = new SchemaPanel(panel, context, history);
    return SchemaPanel.current;
  }

  static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, history: RequestHistory): void {
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
    SchemaPanel.current = new SchemaPanel(panel, context, history);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly history: RequestHistory
  ) {
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((m: WebviewMessage) => void this.safeHandle(m), null, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.onDidChangeViewState(() => panel.visible && void this.postEnv(), null, this.disposables);
  }

  /** Loads a request into the form, e.g. from the "Import cURL" command. */
  loadRequest(request: RequestSpec): void {
    if (!this.webviewReady) {
      this.pendingRequest = request;
      return;
    }
    void this.panel.webview.postMessage({ type: 'loadRequest', request });
  }

  /** A throwing handler must still reset the webview, or it would stay on "Sending…". */
  private async safeHandle(message: WebviewMessage): Promise<void> {
    try {
      await this.handle(message);
    } catch (error) {
      this.post({ type: 'error', message: errorMessage(error) });
    }
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        const history = this.history.list();
        this.post({ type: 'init', options: this.options, history: summarize(history), request: history[0]?.request });
        this.webviewReady = true;
        if (this.pendingRequest) {
          this.loadRequest(this.pendingRequest);
          this.pendingRequest = undefined;
        }
        await this.postEnv();
        break;
      }
      case 'send':
        this.options = message.options;
        await this.send(message.request);
        break;
      case 'cancel':
        this.inflight?.abort();
        break;
      case 'importCurl':
        this.importCurl(message.text);
        break;
      case 'regenerate':
        this.options = message.options;
        this.regenerate();
        break;
      case 'useClipboard':
        this.options = message.options;
        await this.useClipboard();
        break;
      case 'action':
        await this.runAction(message.action);
        break;
      case 'loadHistory': {
        const entry = this.history.get(message.id);
        if (entry) this.loadRequest(entry.request);
        break;
      }
      case 'clearHistory':
        await this.history.clear();
        this.post({ type: 'history', history: [] });
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${this.context.extension.id}`);
        break;
    }
  }

  private async send(request: RequestSpec): Promise<void> {
    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    this.post({ type: 'sending' });

    let result: HttpResult;
    try {
      result = await sendRequest(request, controller.signal);
    } catch (error) {
      if (this.inflight === controller) this.post({ type: 'error', message: errorMessage(error) });
      return;
    } finally {
      if (this.inflight === controller) this.inflight = undefined;
    }

    this.lastRequest = request;
    await this.history.add(request, result.status);
    this.post({ type: 'history', history: summarize(this.history.list()) });

    const isJson = this.setBody(result.body);
    this.post({
      type: 'response',
      response: {
        status: result.status,
        statusText: result.statusText,
        ok: result.ok,
        timeMs: result.timeMs,
        sizeBytes: result.sizeBytes,
        contentType: result.contentType,
        headers: result.headers,
        body: isJson ? JSON.stringify(this.lastValue, null, 2).slice(0, PREVIEW_LIMIT) : result.body.slice(0, PREVIEW_LIMIT),
        truncated: result.body.length > PREVIEW_LIMIT,
        isJson,
      },
    });

    if (isJson) {
      this.regenerate();
    } else {
      const kind = result.contentType ? ` (${result.contentType.split(';')[0]})` : '';
      this.post({ type: 'generated', error: `Response is not JSON${kind}, so there is nothing to generate types from.` });
    }
  }

  private setBody(body: string): boolean {
    try {
      this.lastValue = JSON.parse(body.replace(/^\uFEFF/, ''));
      this.hasValue = true;
      return true;
    } catch {
      this.lastValue = undefined;
      this.hasValue = false;
      this.lastResult = undefined;
      return false;
    }
  }

  private async useClipboard(): Promise<void> {
    const text = (await vscode.env.clipboard.readText()).trim();
    if (!text) {
      this.post({ type: 'error', message: 'The clipboard is empty. Copy some JSON first.' });
      return;
    }
    if (isCurlCommand(text)) {
      this.importCurl(text);
      return;
    }
    if (!this.setBody(text)) {
      this.post({ type: 'error', message: 'The clipboard does not contain valid JSON (or a cURL command).' });
      return;
    }
    this.lastRequest = undefined;
    this.post({
      type: 'response',
      response: { source: 'clipboard', body: JSON.stringify(this.lastValue, null, 2).slice(0, PREVIEW_LIMIT), isJson: true, headers: [] },
    });
    this.regenerate();
  }

  private regenerate(): void {
    if (!this.hasValue) return;
    const derived = this.lastRequest ? rootNameFromUrl(this.lastRequest.url, Array.isArray(this.lastValue)) : undefined;
    const rootName = toPascalCase(this.options.rootName) || derived || 'Root';
    const fetcher =
      this.options.includeFetcher && this.lastRequest && this.options.outputMode !== 'typescript'
        ? { url: this.lastRequest.url, method: this.lastRequest.method }
        : undefined;

    this.lastResult = generateFromValue(
      this.lastValue,
      generateOptions({ rootName, style: this.options.style, zodVersion: this.options.zodVersion, fetcher })
    );
    this.post({ type: 'generated', code: pickOutput(this.lastResult, this.options.outputMode), rootName });
  }

  private importCurl(text: string): void {
    try {
      this.loadRequest(parseCurl(text));
      this.post({ type: 'toast', message: 'Imported cURL command.' });
    } catch (error) {
      this.post({ type: 'error', message: `Could not parse cURL: ${errorMessage(error)}` });
    }
  }

  private async runAction(action: 'copy' | 'open' | 'insert' | 'save'): Promise<void> {
    if (!this.lastResult) return;
    const code = pickOutput(this.lastResult, this.options.outputMode);
    if (action === 'copy') {
      await vscode.env.clipboard.writeText(code);
      this.post({ type: 'toast', message: 'Copied to clipboard.' });
    } else if (action === 'open') {
      await openInEditor(code);
    } else if (action === 'insert') {
      if (!(await insertIntoEditor(code))) {
        await openInEditor(code);
      }
    } else {
      await saveToFile(code, this.lastResult.rootName);
    }
  }

  private async postEnv(): Promise<void> {
    const env = await loadEnv();
    this.post({ type: 'env', env: { path: env.path, count: env.vars.size } });
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    SchemaPanel.current = undefined;
    this.inflight?.abort();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (file: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${media('panel.css')}" />
<title>ResponseToSchema</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${media('panel.js')}"></script>
</body>
</html>`;
  }
}

function summarize(entries: ReturnType<RequestHistory['list']>): Array<{ id: string; label: string; status?: number }> {
  return entries.map((e) => ({ id: e.id, label: `${e.request.method} ${e.request.url}`, status: e.status }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
