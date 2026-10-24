import * as vscode from 'vscode';
import { GenerateResult } from './core/generate';
import { OutputMode } from './config';
import { findImportInsertLine } from './core/imports';

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

/**
 * Inserts at the cursor. The zod import goes with the other imports at the top
 * of the file (and is skipped when the file already imports zod), never into
 * the middle of code. Returns false when nothing could be inserted.
 */
export async function insertIntoEditor(code: string, target = vscode.window.activeTextEditor ?? lastTextEditor): Promise<boolean> {
  if (!target || target.document.isClosed) return false;

  const document = target.document;
  const hasImport = code.startsWith(`${ZOD_IMPORT}\n`);
  const body = hasImport ? code.slice(ZOD_IMPORT.length).replace(/^\n+/, '') : code;
  const needsImport = hasImport && !/from\s+['"]zod['"]/.test(document.getText());

  const editor = await vscode.window.showTextDocument(document, target.viewColumn);

  if (needsImport) {
    const line = findImportInsertLine(document.getText().split(/\r?\n/));
    const atEndOfFile = line >= document.lineCount;
    const position = atEndOfFile ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(line, 0);
    const text = atEndOfFile ? `\n${ZOD_IMPORT}\n` : `${ZOD_IMPORT}\n`;
    if (!(await editor.edit((edit) => edit.insert(position, text)))) return false;
  }

  return editor.edit((edit) => {
    for (const selection of editor.selections) edit.replace(selection, body);
  });
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
