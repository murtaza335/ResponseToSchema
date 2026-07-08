import * as vscode from 'vscode';
import { ApiSchemaArchitectPanel, ExecuteRequestPayload, WebviewToHostMessage } from './webviewProvider';
import { resolveEnvTokens } from './envResolver';
import { jsonToTypeScript, jsonToZod } from './transformerEngine';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('api-schema-architect.openDashboard', () => {
    const panel = ApiSchemaArchitectPanel.createOrShow(context.extensionUri, (message: WebviewToHostMessage) => {
      void handleWebviewMessage(message, panel);
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // No explicit teardown is required; VS Code disposes registered
  // subscriptions (including the panel's message listener) automatically.
}

async function handleWebviewMessage(message: WebviewToHostMessage, panel: ApiSchemaArchitectPanel): Promise<void> {
  if (message.type === 'executeRequest') {
    await executeRequest(message.payload, panel);
  }
}

/**
 * Runs entirely in the Extension Host so it is not subject to the Webview's
 * CORS/sandbox restrictions. Resolves `{{VAR}}` tokens against the workspace
 * `.env` file, performs the HTTP call, and — on success — pipes the raw JSON
 * body into the transformer engine and opens the generated code beside the
 * panel.
 */
async function executeRequest(payload: ExecuteRequestPayload, panel: ApiSchemaArchitectPanel): Promise<void> {
  try {
    const resolvedUrl = await resolveEnvTokens(payload.url);

    if (!resolvedUrl || resolvedUrl.trim().length === 0) {
      throw new Error('Request URL is empty.');
    }

    const resolvedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload.headers)) {
      resolvedHeaders[key] = await resolveEnvTokens(value);
    }

    const requestInit: RequestInit = {
      method: payload.method,
      headers: resolvedHeaders,
    };

    if (payload.method !== 'GET' && payload.body && payload.body.trim().length > 0) {
      requestInit.body = await resolveEnvTokens(payload.body);
    }

    const response = await fetch(resolvedUrl, requestInit);
    const rawText = await response.text();

    if (!response.ok) {
      panel.postMessage({ type: 'requestError', error: `HTTP ${response.status} ${response.statusText}` });
      void vscode.window.showWarningMessage(
        `API Schema Architect: request completed with HTTP ${response.status}. Attempting to generate types from the response body anyway.`
      );
    } else {
      panel.postMessage({ type: 'requestSuccess', status: response.status });
    }

    await openGeneratedCode(rawText);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred during the request.';
    panel.postMessage({ type: 'requestError', error: errorMessage });
    void vscode.window.showErrorMessage(`API Schema Architect: ${errorMessage}`);
  }
}

/**
 * Generates the TypeScript interface and Zod schema for the given raw JSON
 * response text, combines them into a single document, and opens it in a
 * new editor tab beside the currently active editor/panel.
 */
async function openGeneratedCode(rawJson: string): Promise<void> {
  const tsInterface = jsonToTypeScript(rawJson);
  const zodSchema = jsonToZod(rawJson);

  const combinedContent = ["import { z } from 'zod';", '', tsInterface.trim(), '', zodSchema.trim(), ''].join('\n');

  const document = await vscode.workspace.openTextDocument({
    content: combinedContent,
    language: 'typescript',
  });

  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
  });
}
