import * as vscode from 'vscode';

/**
 * Resolves `{{VAR_NAME}}` style tokens inside a string (typically a URL, header
 * value, or body payload) against key/value pairs found in a `.env` file at
 * the root of the first workspace folder.
 *
 * If no workspace folder or `.env` file is present, or a given token has no
 * matching key, the original `{{VAR_NAME}}` token is left untouched in the
 * output so the caller can surface a clear failure instead of silently
 * sending a broken request.
 */
export async function resolveEnvTokens(inputUrl: string): Promise<string> {
  const tokenRegex = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

  if (!tokenRegex.test(inputUrl)) {
    return inputUrl;
  }
  tokenRegex.lastIndex = 0;

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return inputUrl;
  }

  const rootUri = workspaceFolders[0].uri;
  const envUri = vscode.Uri.joinPath(rootUri, '.env');

  let envMap: Map<string, string>;

  try {
    const fileBytes = await vscode.workspace.fs.readFile(envUri);
    const fileContent = Buffer.from(fileBytes).toString('utf8');
    envMap = parseEnvContent(fileContent);
  } catch {
    // .env does not exist or could not be read. Leave tokens as-is so the
    // caller can decide whether an unresolved token should block the request.
    return inputUrl;
  }

  return inputUrl.replace(tokenRegex, (match: string, tokenName: string): string => {
    const value = envMap.get(tokenName);
    return value !== undefined ? value : match;
  });
}

/**
 * Parses the raw text content of a `.env` file into a Map of key/value pairs.
 * Supports `KEY=value`, `export KEY=value`, comment lines starting with `#`,
 * blank lines, and single/double quoted values.
 */
function parseEnvContent(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  const lineRegex = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const match = line.match(lineRegex);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2];

    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'") && value.length >= 2;

    if (isDoubleQuoted || isSingleQuoted) {
      value = value.substring(1, value.length - 1);
    }

    result.set(key, value);
  }

  return result;
}
