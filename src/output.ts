import * as vscode from 'vscode';
import { GenerateResult } from './core/generate';
import { OutputMode } from './config';

const ZOD_IMPORT = "import { z } from 'zod';";

export function pickOutput(result: GenerateResult, mode: OutputMode): string {
  return mode === 'typescript' ? result.typescript : mode === 'zod' ? result.zod : result.combined;
}

/**
 * The panel takes focus away from text editors, so the last one the user
 * touched is tracked to know where "Insert" should go.
 */
let lastTextEditor: vscode.TextEditor | undefined;

export function trackActiveEditor(context: vscode.ExtensionContext): void {
  lastTextEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme !== 'output') lastTextEditor = editor;
    })
  );
}

export async function openInEditor(code: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ content: code, language: 'typescript' });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

/** Inserts at the cursor, dropping the zod import if the file already has one. */
export async function insertIntoEditor(code: string, target = vscode.window.activeTextEditor ?? lastTextEditor): Promise<boolean> {
  if (!target || target.document.isClosed) return false;
  const existing = target.document.getText();
  let text = code;
  if (/from\s+['"]zod['"]/.test(existing)) {
    text = text.replace(`${ZOD_IMPORT}\n\n`, '');
  }
  const editor = await vscode.window.showTextDocument(target.document, target.viewColumn);
  await editor.edit((edit) => {
    for (const selection of editor.selections) edit.replace(selection, text);
  });
  return true;
}

export async function saveToFile(code: string, rootName: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const fileName = `${rootName.charAt(0).toLowerCase()}${rootName.slice(1)}.schema.ts`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, fileName) : undefined,
    filters: { TypeScript: ['ts'] },
    saveLabel: 'Save Schema',
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(code, 'utf8'));
  await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}
