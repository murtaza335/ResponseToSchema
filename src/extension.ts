import * as path from 'path';
import * as vscode from 'vscode';
import { isCurlCommand, parseCurl } from './core/curl';
import { generateFromJson } from './core/generate';
import { toPascalCase } from './core/naming';
import { OutputMode, generateOptions, getConfig } from './config';
import { RequestHistory } from './history';
import { insertIntoEditor, openInEditor, pickOutput, trackActiveEditor } from './output';
import { SchemaPanel } from './panel';

export function activate(context: vscode.ExtensionContext): void {
  const history = new RequestHistory(context.workspaceState);
  trackActiveEditor(context);

  const register = (id: string, run: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(`responseToSchema.${id}`, run));
  };

  register('openPanel', () => SchemaPanel.show(context, history));

  register('importCurl', async () => {
    const clip = (await vscode.env.clipboard.readText()).trim();
    const text = isCurlCommand(clip)
      ? clip
      : await vscode.window.showInputBox({ prompt: 'Paste a cURL command', placeHolder: "curl 'https://api.example.com/users' -H 'Accept: application/json'" });
    if (!text) return;
    try {
      const request = parseCurl(text);
      SchemaPanel.show(context, history).loadRequest(request);
    } catch (error) {
      void vscode.window.showErrorMessage(`ResponseToSchema: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  register('generateFromSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    const fallbackName = editor.document.isUntitled ? 'Root' : path.parse(editor.document.fileName).name;
    await generateAndOpen(text, fallbackName);
  });

  register('generateFromFile', async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) return;
    const text = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
    await generateAndOpen(text, path.parse(target.fsPath).name);
  });

  register('pasteJsonAsCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage('ResponseToSchema: open a file to paste into.');
      return;
    }
    const code = await generateFromText(await vscode.env.clipboard.readText(), 'Root');
    if (code) await insertIntoEditor(code, editor);
  });

  register('clearHistory', async () => {
    await history.clear();
    void vscode.window.showInformationMessage('ResponseToSchema: request history cleared.');
  });

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(SchemaPanel.viewType, {
      deserializeWebviewPanel: async (panel) => SchemaPanel.revive(panel, context, history),
    })
  );
}

export function deactivate(): void {
  // Everything is registered on context.subscriptions.
}

async function generateAndOpen(text: string, fallbackName: string): Promise<void> {
  const code = await generateFromText(text, fallbackName);
  if (code) await openInEditor(code);
}

/** Validates JSON, asks for the root type name, and returns code in the configured output mode. */
async function generateFromText(text: string, fallbackName: string): Promise<string | undefined> {
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
  } catch (error) {
    void vscode.window.showErrorMessage(`ResponseToSchema: not valid JSON. ${error instanceof Error ? error.message : ''}`);
    return undefined;
  }

  const rootName = await vscode.window.showInputBox({
    prompt: 'Name for the root type',
    value: toPascalCase(fallbackName) || 'Root',
    validateInput: (v) => (toPascalCase(v) ? undefined : 'Enter a name containing letters or digits'),
  });
  if (rootName === undefined) return undefined;

  const result = generateFromJson(trimmed, generateOptions({ rootName }));
  return pickOutput(result, getConfig().get<OutputMode>('outputMode', 'combined'));
}
