/**
 * `.env` parsing and `{{VAR}}` substitution. Pure so it can be unit tested;
 * the VS Code side only reads the file.
 */

const TOKEN_REGEX = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

export function parseEnv(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lineRegex = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const match = lineRegex.exec(line);
    if (!match) continue;

    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === '`') && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    } else {
      // Unquoted values may carry a trailing ` # comment`.
      value = value.replace(/\s+#.*$/, '');
    }
    result.set(match[1], value);
  }

  return result;
}

export function findTokens(input: string): string[] {
  const names = new Set<string>();
  for (const m of input.matchAll(TOKEN_REGEX)) names.add(m[1]);
  return [...names];
}

/** Replaces known tokens; unknown ones are returned in `missing` and left in place. */
export function substituteTokens(input: string, vars: Map<string, string>): { value: string; missing: string[] } {
  const missing = new Set<string>();
  const value = input.replace(TOKEN_REGEX, (match: string, name: string) => {
    const v = vars.get(name);
    if (v === undefined) {
      missing.add(name);
      return match;
    }
    return v;
  });
  return { value, missing: [...missing] };
}
