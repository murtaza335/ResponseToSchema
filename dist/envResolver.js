"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEnvTokens = resolveEnvTokens;
const vscode = __importStar(require("vscode"));
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
async function resolveEnvTokens(inputUrl) {
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
    let envMap;
    try {
        const fileBytes = await vscode.workspace.fs.readFile(envUri);
        const fileContent = Buffer.from(fileBytes).toString('utf8');
        envMap = parseEnvContent(fileContent);
    }
    catch {
        // .env does not exist or could not be read. Leave tokens as-is so the
        // caller can decide whether an unresolved token should block the request.
        return inputUrl;
    }
    return inputUrl.replace(tokenRegex, (match, tokenName) => {
        const value = envMap.get(tokenName);
        return value !== undefined ? value : match;
    });
}
/**
 * Parses the raw text content of a `.env` file into a Map of key/value pairs.
 * Supports `KEY=value`, `export KEY=value`, comment lines starting with `#`,
 * blank lines, and single/double quoted values.
 */
function parseEnvContent(content) {
    const result = new Map();
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
//# sourceMappingURL=envResolver.js.map