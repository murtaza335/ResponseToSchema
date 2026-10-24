import * as vscode from 'vscode';
import { RequestSpec } from './core/curl';
import { redactRequest } from './core/redact';
import { getConfig } from './config';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  status?: number;
  request: RequestSpec;
}

const STORAGE_KEY = 'responseToSchema.history';

/**
 * Per-workspace request history. Secrets typed in literally (auth fields,
 * sensitive headers, query parameters and body fields) are blanked before
 * anything touches disk; `{{VAR}}` placeholders are kept. See core/redact.
 */
export class RequestHistory {
  constructor(private readonly state: vscode.Memento) {}

  list(): HistoryEntry[] {
    return this.state.get<HistoryEntry[]>(STORAGE_KEY, []);
  }

  async add(request: RequestSpec, status?: number): Promise<void> {
    const max = getConfig().get<number>('history.maxEntries', 50);
    if (max <= 0) return;
    const redacted = redactRequest(request);
    const sameRequest = (e: HistoryEntry): boolean => e.request.method === redacted.method && e.request.url === redacted.url;
    const entries = [
      { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now(), status, request: redacted },
      ...this.list().filter((e) => !sameRequest(e)),
    ].slice(0, max);
    await this.state.update(STORAGE_KEY, entries);
  }

  get(id: string): HistoryEntry | undefined {
    return this.list().find((e) => e.id === id);
  }

  async clear(): Promise<void> {
    await this.state.update(STORAGE_KEY, []);
  }
}
