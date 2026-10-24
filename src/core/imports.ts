/**
 * Finds where a new top-level `import` belongs in a source file: after the
 * shebang, any `'use client'`-style directives and the existing imports
 * (including multi-line ones), never in the middle of code.
 */

const IMPORT_END = /\bfrom\s*['"][^'"]*['"]\s*;?\s*(\/\/.*)?$/;
const DIRECTIVE = /^(['"])use [a-z ]+\1\s*;?$/;

export function findImportInsertLine(lines: string[]): number {
  let insertAt = 0;
  let inImport = false;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();

    if (inBlockComment) {
      if (text.includes('*/')) inBlockComment = false;
      continue;
    }
    if (inImport) {
      if (IMPORT_END.test(text)) {
        inImport = false;
        insertAt = i + 1;
      }
      continue;
    }
    if (i === 0 && text.startsWith('#!')) {
      insertAt = 1;
      continue;
    }
    if (text === '' || text.startsWith('//')) continue;
    if (text.startsWith('/*')) {
      if (!text.includes('*/')) inBlockComment = true;
      continue;
    }
    if (DIRECTIVE.test(text)) {
      insertAt = i + 1;
      continue;
    }
    if (/^import(\s|\{|\*)/.test(text)) {
      if (IMPORT_END.test(text) || /^import\s+['"]/.test(text)) insertAt = i + 1;
      else inImport = true;
      continue;
    }
    break;
  }

  return insertAt;
}
