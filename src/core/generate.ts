/**
 * Emits TypeScript and Zod source from an inferred `TypeNode` tree.
 *
 * A single naming plan is computed first and shared by both emitters, so a
 * nested object called `Address` in the interfaces is always `AddressSchema`
 * in the Zod output, in the same declaration order.
 */

import { DEFAULT_INFER_OPTIONS, InferOptions, ObjectNode, TypeNode, inferType, memberCount, signature } from './infer';
import { elementName, toPascalCase, toSafeKey } from './naming';

export type TypeStyle = 'named' | 'inline';
export type ZodVersion = '3' | '4';

export interface GenerateOptions extends InferOptions {
  rootName: string;
  /** `named` hoists every nested object into its own declaration. */
  style: TypeStyle;
  zodVersion: ZodVersion;
  indent: string;
  /** When set, a typed `fetchX()` helper that validates with Zod is appended. */
  fetcher?: { url: string; method: string };
}

export interface GenerateResult {
  ok: boolean;
  error?: string;
  rootName: string;
  /** Interfaces only. */
  typescript: string;
  /** Zod schemas plus `z.infer` type aliases. */
  zod: string;
  /** Interfaces plus schemas, ready to drop into a file. */
  combined: string;
}

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  ...DEFAULT_INFER_OPTIONS,
  rootName: 'Root',
  style: 'named',
  zodVersion: '4',
  indent: '  ',
};

export function generateFromJson(json: string, options: Partial<GenerateOptions> = {}): GenerateResult {
  const opts: GenerateOptions = { ...DEFAULT_GENERATE_OPTIONS, ...options };
  const rootName = toPascalCase(opts.rootName) || 'Root';

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Invalid JSON: ${message}`, rootName, typescript: '', zod: '', combined: '' };
  }

  return generateFromValue(parsed, { ...opts, rootName });
}

export function generateFromValue(value: unknown, opts: GenerateOptions): GenerateResult {
  const root = inferType([value], opts);
  const plan = planNames(root, opts.rootName, opts.style);
  const ts = new TsEmitter(plan, opts);
  const zod = new ZodEmitter(plan, opts);

  const interfaces = ts.declarations();
  const schemas = zod.declarations();
  const inferred = zod.inferredTypes();
  const importLine = "import { z } from 'zod';";
  const fetcher = opts.fetcher ? renderFetcher(opts.rootName, opts.fetcher, opts.indent) : '';

  const join = (...blocks: string[]): string => blocks.filter(Boolean).join('\n\n') + '\n';

  return {
    ok: true,
    rootName: opts.rootName,
    typescript: join(interfaces),
    zod: join(importLine, schemas, inferred, fetcher),
    combined: join(importLine, interfaces, schemas, fetcher),
  };
}

// ---------------------------------------------------------------------------
// Naming plan
// ---------------------------------------------------------------------------

interface NamePlan {
  root: TypeNode;
  rootName: string;
  /** True when the root is emitted as `interface Root` / `RootSchema = z.object(...)`. */
  rootDeclared: boolean;
  names: Map<ObjectNode, string>;
  /** Named objects in dependency order (children before parents). */
  order: Array<{ name: string; object: ObjectNode }>;
}

const ENVELOPE_KEYS = new Set(['data', 'items', 'results', 'records', 'rows', 'entries', 'list', 'content', 'nodes', 'hits', 'docs']);

function planNames(root: TypeNode, rootName: string, style: TypeStyle): NamePlan {
  const names = new Map<ObjectNode, string>();
  const order: NamePlan['order'] = [];
  const bySignature = new Map<string, string>();
  const taken = new Set<string>([rootName]);

  const claim = (object: ObjectNode, candidate: string, parentName: string, isRoot: boolean): void => {
    if (object.fields.length === 0) return;
    const sig = signature({ nullable: false, object });
    const existing = bySignature.get(sig);
    if (existing && !isRoot) {
      names.set(object, existing);
      return;
    }
    let name = candidate;
    if (!isRoot && taken.has(name)) {
      name = parentName + candidate;
      for (let n = 2; taken.has(name); n++) name = `${candidate}${n}`;
    }
    taken.add(name);
    bySignature.set(sig, name);
    names.set(object, name);
    order.push({ name, object });
  };

  const visit = (node: TypeNode, candidate: string, parentName: string, isRoot: boolean): void => {
    if (node.object) {
      for (const field of node.object.fields) {
        // `{ data: [...] }` envelopes: elements of a generic list on the root
        // are named after the root (`Users` -> `User`), not `DataItem`.
        const isEnvelopeList = isRoot && !!field.type.array && ENVELOPE_KEYS.has(field.key.toLowerCase());
        visit(field.type, isEnvelopeList ? candidate : toPascalCase(field.key) || 'Field', candidate, false);
      }
      if (style === 'named' || isRoot) claim(node.object, candidate, parentName, isRoot);
    }
    if (node.array) {
      visit(node.array, elementName(candidate), parentName, false);
    }
  };

  // A JSON document has a single root value, so the root is never a union:
  // an object root owns `rootName`, anything else becomes `type Root = ...`
  // and array elements take the singular form of the name.
  const rootIsObject = !!root.object;
  visit(root, rootName, '', rootIsObject);
  const rootDeclared = rootIsObject && names.has(root.object as ObjectNode);

  return { root, rootName, rootDeclared, names, order };
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

class TsEmitter {
  constructor(private readonly plan: NamePlan, private readonly opts: GenerateOptions) {}

  declarations(): string {
    const out: string[] = [];
    for (const { name, object } of this.plan.order) {
      out.push(`export interface ${name} ${this.objectBody(object, 0)}`);
    }
    if (!this.plan.rootDeclared) {
      out.push(`export type ${this.plan.rootName} = ${this.type(this.plan.root, 0)};`);
    }
    return out.join('\n\n');
  }

  private type(node: TypeNode, depth: number): string {
    const members: string[] = [];
    if (node.string) members.push('string');
    if (node.number) members.push('number');
    if (node.boolean) members.push('boolean');
    if (node.object) members.push(this.objectRef(node.object, depth));
    if (node.array) {
      const elem = this.type(node.array, depth);
      members.push(memberCount(node.array) > 1 ? `(${elem})[]` : `${elem}[]`);
    }
    if (node.nullable) members.push('null');
    return members.length > 0 ? members.join(' | ') : 'unknown';
  }

  private objectRef(object: ObjectNode, depth: number): string {
    const name = this.plan.names.get(object);
    if (name) return name;
    if (object.fields.length === 0) return 'Record<string, unknown>';
    return this.objectBody(object, depth);
  }

  private objectBody(object: ObjectNode, depth: number): string {
    const pad = this.opts.indent.repeat(depth + 1);
    const lines = object.fields.map((f) => `${pad}${toSafeKey(f.key)}${f.optional ? '?' : ''}: ${this.type(f.type, depth + 1)};`);
    return `{\n${lines.join('\n')}\n${this.opts.indent.repeat(depth)}}`;
  }
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const ZOD_FORMATS: Record<ZodVersion, Record<string, string>> = {
  '4': {
    datetime: 'z.iso.datetime({ offset: true })',
    date: 'z.iso.date()',
    email: 'z.email()',
    uuid: 'z.uuid()',
    url: 'z.url()',
  },
  '3': {
    datetime: 'z.string().datetime({ offset: true })',
    date: 'z.string().date()',
    email: 'z.string().email()',
    uuid: 'z.string().uuid()',
    url: 'z.string().url()',
  },
};

class ZodEmitter {
  constructor(private readonly plan: NamePlan, private readonly opts: GenerateOptions) {}

  declarations(): string {
    const out: string[] = [];
    for (const { name, object } of this.plan.order) {
      out.push(`export const ${name}Schema = ${this.objectBody(object, 0)};`);
    }
    if (!this.plan.rootDeclared) {
      out.push(`export const ${this.plan.rootName}Schema = ${this.schema(this.plan.root, 0)};`);
    }
    return out.join('\n\n');
  }

  inferredTypes(): string {
    const names = this.plan.order.map((d) => d.name);
    if (!this.plan.rootDeclared) names.push(this.plan.rootName);
    return names.map((n) => `export type ${n} = z.infer<typeof ${n}Schema>;`).join('\n');
  }

  private schema(node: TypeNode, depth: number): string {
    const members: string[] = [];
    if (node.string) {
      const format = node.string.format;
      members.push(format ? ZOD_FORMATS[this.opts.zodVersion][format] : 'z.string()');
    }
    if (node.number) members.push(node.number.integer ? 'z.number().int()' : 'z.number()');
    if (node.boolean) members.push('z.boolean()');
    if (node.object) members.push(this.objectRef(node.object, depth));
    if (node.array) members.push(`z.array(${this.schema(node.array, depth)})`);

    if (members.length === 0) return node.nullable ? 'z.null()' : 'z.unknown()';
    const base = members.length === 1 ? members[0] : `z.union([${members.join(', ')}])`;
    return node.nullable ? `${base}.nullable()` : base;
  }

  private objectRef(object: ObjectNode, depth: number): string {
    const name = this.plan.names.get(object);
    if (name) return `${name}Schema`;
    if (object.fields.length === 0) return 'z.record(z.string(), z.unknown())';
    return this.objectBody(object, depth);
  }

  private objectBody(object: ObjectNode, depth: number): string {
    const pad = this.opts.indent.repeat(depth + 1);
    const lines = object.fields.map((f) => {
      const schema = this.schema(f.type, depth + 1) + (f.optional ? '.optional()' : '');
      return `${pad}${toSafeKey(f.key)}: ${schema},`;
    });
    return `z.object({\n${lines.join('\n')}\n${this.opts.indent.repeat(depth)}})`;
  }
}

// ---------------------------------------------------------------------------
// Fetcher helper
// ---------------------------------------------------------------------------

function renderFetcher(rootName: string, fetcher: { url: string; method: string }, indent: string): string {
  // `{{API_KEY}}` placeholders become `process.env.API_KEY` interpolations.
  const escaped = fetcher.url.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${');
  const url = escaped.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, '${process.env.$1}');
  const method = fetcher.method.toUpperCase();
  const init = method === 'GET' ? 'init' : `{ method: '${method}', ...init }`;
  return [
    `export async function fetch${rootName}(init?: RequestInit): Promise<${rootName}> {`,
    `${indent}const res = await fetch(\`${url}\`, ${init});`,
    `${indent}if (!res.ok) throw new Error(\`${method} ${rootName} failed: \${res.status} \${res.statusText}\`);`,
    `${indent}return ${rootName}Schema.parse(await res.json());`,
    `}`,
  ].join('\n');
}
