"use strict";
/**
 * Pure, dependency-free JSON -> TypeScript / JSON -> Zod transformation
 * pipelines.
 *
 * Design note: rather than pulling in `quicktype-core` (a large dependency
 * chain that is awkward to bundle inside a VS Code extension host and pulls
 * in its own CLI/IO assumptions), this module implements the recursive
 * structural walk directly. It produces a single root type per pipeline with
 * nested object literals inlined at the correct depth, which keeps the two
 * outputs trivially kept in sync (same traversal, same key order) and avoids
 * any risk of name collisions between generated nested interfaces.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonToTypeScript = jsonToTypeScript;
exports.jsonToZod = jsonToZod;
const INDENT_UNIT = '\t';
function jsonToTypeScript(jsonStr) {
    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    }
    catch (error) {
        return buildTsFallback(error);
    }
    try {
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            // Top level response is not a JSON object (e.g. a raw array or scalar).
            const inline = resolveTsType(parsed, 0, new WeakSet());
            return `export type RootResponse = ${inline};\n`;
        }
        const body = buildTsObjectBody(parsed, 1, new WeakSet());
        return `export interface RootResponse {\n${body}}\n`;
    }
    catch (error) {
        return buildTsFallback(error);
    }
}
function jsonToZod(jsonStr) {
    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    }
    catch (error) {
        return buildZodFallback(error);
    }
    try {
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            const inline = resolveZodType(parsed, 0, new WeakSet());
            return `export const RootResponseSchema = ${inline};\n\nexport type RootResponseType = z.infer<typeof RootResponseSchema>;\n`;
        }
        const body = buildZodObjectBody(parsed, 1, new WeakSet());
        return `export const RootResponseSchema = z.object({\n${body}});\n\nexport type RootResponseType = z.infer<typeof RootResponseSchema>;\n`;
    }
    catch (error) {
        return buildZodFallback(error);
    }
}
// ---------------------------------------------------------------------------
// TypeScript interface generation
// ---------------------------------------------------------------------------
function buildTsObjectBody(value, depth, visited) {
    guardAgainstCycle(value, visited);
    const indent = INDENT_UNIT.repeat(depth);
    let body = '';
    for (const [key, val] of Object.entries(value)) {
        const safeKey = toSafeKey(key);
        const propType = resolveTsType(val, depth, visited);
        body += `${indent}${safeKey}: ${propType};\n`;
    }
    return body;
}
function resolveTsType(value, depth, visited) {
    if (value === null) {
        return 'string | null';
    }
    if (Array.isArray(value)) {
        return resolveTsArrayType(value, depth, visited);
    }
    if (typeof value === 'object') {
        const body = buildTsObjectBody(value, depth + 1, visited);
        const indent = INDENT_UNIT.repeat(depth);
        return `{\n${body}${indent}}`;
    }
    return primitiveTsType(value);
}
function resolveTsArrayType(arr, depth, visited) {
    if (arr.length === 0) {
        return 'unknown[]';
    }
    const firstNonNull = arr.find((item) => item !== null);
    if (firstNonNull === undefined) {
        // Every element sampled was null.
        return '(string | null)[]';
    }
    if (Array.isArray(firstNonNull)) {
        return `${resolveTsArrayType(firstNonNull, depth, visited)}[]`;
    }
    if (typeof firstNonNull === 'object') {
        const body = buildTsObjectBody(firstNonNull, depth + 1, visited);
        const indent = INDENT_UNIT.repeat(depth);
        return `{\n${body}${indent}}[]`;
    }
    return `${primitiveTsType(firstNonNull)}[]`;
}
function primitiveTsType(value) {
    switch (typeof value) {
        case 'string':
            return 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        default:
            return 'unknown';
    }
}
function buildTsFallback(error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
        `// Error: Unable to generate TypeScript interface.`,
        `// ${message}`,
        `export interface RootResponse {`,
        `${INDENT_UNIT}[key: string]: unknown;`,
        `}`,
        '',
    ].join('\n');
}
// ---------------------------------------------------------------------------
// Zod schema generation
// ---------------------------------------------------------------------------
function buildZodObjectBody(value, depth, visited) {
    guardAgainstCycle(value, visited);
    const indent = INDENT_UNIT.repeat(depth);
    let body = '';
    for (const [key, val] of Object.entries(value)) {
        const safeKey = toSafeKey(key);
        const propSchema = resolveZodType(val, depth, visited);
        body += `${indent}${safeKey}: ${propSchema},\n`;
    }
    return body;
}
function resolveZodType(value, depth, visited) {
    if (value === null) {
        // Deterministic rule: a null leaf becomes an unknown, nullable field
        // since there is no sampled type information to narrow it further.
        return 'z.unknown().nullable()';
    }
    if (Array.isArray(value)) {
        return resolveZodArrayType(value, depth, visited);
    }
    if (typeof value === 'object') {
        const body = buildZodObjectBody(value, depth + 1, visited);
        const indent = INDENT_UNIT.repeat(depth);
        return `z.object({\n${body}${indent}})`;
    }
    return primitiveZodType(value);
}
function resolveZodArrayType(arr, depth, visited) {
    if (arr.length === 0) {
        return 'z.array(z.unknown())';
    }
    const firstNonNull = arr.find((item) => item !== null);
    if (firstNonNull === undefined) {
        return 'z.array(z.unknown().nullable())';
    }
    if (Array.isArray(firstNonNull)) {
        return `z.array(${resolveZodArrayType(firstNonNull, depth, visited)})`;
    }
    if (typeof firstNonNull === 'object') {
        const body = buildZodObjectBody(firstNonNull, depth + 1, visited);
        const indent = INDENT_UNIT.repeat(depth);
        return `z.array(z.object({\n${body}${indent}}))`;
    }
    return `z.array(${primitiveZodType(firstNonNull)})`;
}
function primitiveZodType(value) {
    switch (typeof value) {
        case 'string':
            return 'z.string()';
        case 'number':
            return 'z.number()';
        case 'boolean':
            return 'z.boolean()';
        default:
            return 'z.unknown()';
    }
}
function buildZodFallback(error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
        `// Error: Unable to generate Zod schema.`,
        `// ${message}`,
        `export const RootResponseSchema = z.object({});`,
        '',
        `export type RootResponseType = z.infer<typeof RootResponseSchema>;`,
        '',
    ].join('\n');
}
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function guardAgainstCycle(value, visited) {
    if (visited.has(value)) {
        throw new Error('Circular reference detected in JSON input; cannot generate a finite type.');
    }
    visited.add(value);
}
function toSafeKey(key) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
//# sourceMappingURL=transformerEngine.js.map