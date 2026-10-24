import * as vscode from 'vscode';
import { RequestSpec } from './core/curl';
import { parseEnv, substituteTokens } from './core/env';
import { getConfig } from './config';

export interface HttpResult {
  status: number;
  statusText: string;
  ok: boolean;
  timeMs: number;
  sizeBytes: number;
  contentType: string;
  headers: Array<[string, string]>;
  body: string;
}

export interface EnvInfo {
  /** Workspace-relative path shown in the UI, or undefined when no file was found. */
  path?: string;
  vars: Map<string, string>;
}

/** Folder used to resolve the env file: the active file's folder, else the first one. */
function workspaceFolder(): vscode.WorkspaceFolder | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  return (active && vscode.workspace.getWorkspaceFolder(active)) ?? vscode.workspace.workspaceFolders?.[0];
}

export async function loadEnv(): Promise<EnvInfo> {
  const folder = workspaceFolder();
  const relative = getConfig().get<string>('envFile', '.env');
  if (!folder || !relative) return { vars: new Map() };

  const uri = vscode.Uri.joinPath(folder.uri, relative);
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { path: vscode.workspace.asRelativePath(uri), vars: parseEnv(Buffer.from(bytes).toString('utf8')) };
  } catch {
    return { vars: new Map() };
  }
}

/** Applies env substitution and auth, failing loudly on unresolved `{{VAR}}` tokens. */
export async function resolveRequest(spec: RequestSpec): Promise<{ url: string; init: RequestInit }> {
  const env = await loadEnv();
  const missing = new Set<string>();
  const sub = (input: string): string => {
    const result = substituteTokens(input, env.vars);
    result.missing.forEach((m) => missing.add(m));
    return result.value;
  };

  const url = sub(spec.url.trim());
  const headers: Record<string, string> = {};
  for (const h of spec.headers) {
    if (h.enabled && h.key.trim()) headers[sub(h.key.trim())] = sub(h.value);
  }

  if (spec.auth.type === 'bearer' && spec.auth.token.trim()) {
    headers['Authorization'] = `Bearer ${sub(spec.auth.token.trim())}`;
  } else if (spec.auth.type === 'basic') {
    const credentials = `${sub(spec.auth.username)}:${sub(spec.auth.password)}`;
    headers['Authorization'] = `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
  }

  const allowsBody = spec.method !== 'GET' && spec.method !== 'HEAD';
  const body = allowsBody && spec.body.trim() ? sub(spec.body) : undefined;

  if (missing.size > 0) {
    const where = env.path ? `in ${env.path}` : `(no ${getConfig().get<string>('envFile', '.env')} file found in the workspace)`;
    throw new Error(`Unresolved variable${missing.size > 1 ? 's' : ''} ${[...missing].map((m) => `{{${m}}}`).join(', ')} ${where}.`);
  }
  if (!url) throw new Error('Enter a URL first.');
  if (!/^https?:\/\//i.test(url)) throw new Error(`URL must start with http:// or https:// (got "${url}").`);

  return { url, init: { method: spec.method, headers, body } };
}

export async function sendRequest(spec: RequestSpec, cancel: AbortSignal): Promise<HttpResult> {
  const { url, init } = await resolveRequest(spec);
  const timeoutMs = Math.max(1, getConfig().get<number>('requestTimeoutSeconds', 30)) * 1000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
  const onCancel = (): void => controller.abort(new Error('Request cancelled.'));
  cancel.addEventListener('abort', onCancel);

  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      timeMs: Date.now() - started,
      sizeBytes: buffer.byteLength,
      contentType: response.headers.get('content-type') ?? '',
      headers: [...response.headers.entries()],
      body: buffer.toString('utf8'),
    };
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw describeNetworkError(error, url);
  } finally {
    clearTimeout(timer);
    cancel.removeEventListener('abort', onCancel);
  }
}

/** Node's fetch reports "fetch failed" and hides the useful part in `cause`. */
function describeNetworkError(error: unknown, url: string): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code;
  const host = safeHost(url);
  if (code === 'ENOTFOUND') return new Error(`Could not resolve host ${host}.`);
  if (code === 'ECONNREFUSED') return new Error(`Connection refused by ${host}. Is the server running?`);
  if (cause?.message === 'bad port') {
    return new Error(`Port ${safePort(url)} is on the fetch standard's blocked-ports list (it includes 1, 22, 25, 6000 and 6665-6669, among others), so requests to it are refused. Run the server on a different port.`);
  }
  if (code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return new Error(`TLS certificate error from ${host} (${code}).`);
  return new Error(cause?.message ? `${error.message}: ${cause.message}` : error.message);
}

function safePort(url: string): string {
  try {
    return new URL(url).port || '(default)';
  } catch {
    return '(unknown)';
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

