/**
 * Structural inference: turns parsed JSON samples into a small type tree
 * (`TypeNode`) that both emitters consume. Keeping inference separate from
 * emission is what guarantees the TypeScript and Zod outputs never drift.
 */

export type StringFormat = 'datetime' | 'date' | 'email' | 'uuid' | 'url';

export interface InferOptions {
  /** Max elements inspected per array (0 = all). */
  arraySampleLimit: number;
  /** Detect ISO date/datetime, email, uuid and url strings. */
  detectFormats: boolean;
  /** Mark numbers as integers when every sample is a whole number. */
  detectIntegers: boolean;
}

export interface FieldNode {
  key: string;
  optional: boolean;
  type: TypeNode;
}

export interface ObjectNode {
  fields: FieldNode[];
}

export interface TypeNode {
  nullable: boolean;
  string?: { format?: StringFormat };
  number?: { integer: boolean };
  boolean?: true;
  object?: ObjectNode;
  /** Element type of an array. */
  array?: TypeNode;
}

export const DEFAULT_INFER_OPTIONS: InferOptions = {
  arraySampleLimit: 1000,
  detectFormats: true,
  detectIntegers: false,
};

const FORMAT_TESTS: Array<[StringFormat, RegExp]> = [
  // Seconds and a `Z`/`±hh:mm` offset are required so both Zod 3 and Zod 4 accept the value.
  ['datetime', /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/],
  ['date', /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i],
  ['email', /^[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/],
  ['url', /^https?:\/\/[^\s/$.?#].[^\s]*$/],
];

export function inferType(samples: unknown[], options: InferOptions): TypeNode {
  const node: TypeNode = { nullable: false };
  const strings: string[] = [];
  const numbers: number[] = [];
  const objects: Record<string, unknown>[] = [];
  const arrays: unknown[][] = [];

  for (const value of samples) {
    if (value === null) node.nullable = true;
    else if (Array.isArray(value)) arrays.push(value);
    else if (typeof value === 'object') objects.push(value as Record<string, unknown>);
    else if (typeof value === 'string') strings.push(value);
    else if (typeof value === 'number') numbers.push(value);
    else if (typeof value === 'boolean') node.boolean = true;
  }

  if (strings.length > 0) {
    node.string = options.detectFormats ? { format: detectFormat(strings) } : {};
  }
  if (numbers.length > 0) {
    node.number = { integer: options.detectIntegers && numbers.every(Number.isInteger) };
  }
  if (objects.length > 0) {
    node.object = inferObject(objects, options);
  }
  if (arrays.length > 0) {
    const limit = options.arraySampleLimit;
    const elements: unknown[] = [];
    for (const arr of arrays) {
      elements.push(...(limit > 0 ? arr.slice(0, limit) : arr));
    }
    node.array = inferType(elements, options);
  }

  return node;
}

function inferObject(samples: Record<string, unknown>[], options: InferOptions): ObjectNode {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const obj of samples) {
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const fields = keys.map((key): FieldNode => {
    const values: unknown[] = [];
    let optional = false;
    for (const obj of samples) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) values.push(obj[key]);
      else optional = true;
    }
    return { key, optional, type: inferType(values, options) };
  });

  return { fields };
}

function detectFormat(values: string[]): StringFormat | undefined {
  for (const [format, regex] of FORMAT_TESTS) {
    if (values.every((v) => regex.test(v) && passesSemanticCheck(format, v))) {
      return format;
    }
  }
  return undefined;
}

function passesSemanticCheck(format: StringFormat, value: string): boolean {
  if (format === 'datetime' || format === 'date') return isRealCalendarDate(value);
  if (format === 'url') {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

/** `Date.parse` happily rolls 2024-02-31 over to March, whereas Zod rejects it. */
function isRealCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

/** Number of distinct members a node will render as (null counts as one). */
export function memberCount(node: TypeNode): number {
  let count = 0;
  if (node.string) count++;
  if (node.number) count++;
  if (node.boolean) count++;
  if (node.object) count++;
  if (node.array) count++;
  if (node.nullable) count++;
  return count;
}

/** Stable structural signature, used to de-duplicate identical named types. */
export function signature(node: TypeNode): string {
  const parts: string[] = [];
  if (node.string) parts.push(`s:${node.string.format ?? ''}`);
  if (node.number) parts.push(`n:${node.number.integer ? 'i' : ''}`);
  if (node.boolean) parts.push('b');
  if (node.object) {
    parts.push(`o{${node.object.fields.map((f) => `${JSON.stringify(f.key)}${f.optional ? '?' : ''}:${signature(f.type)}`).join(',')}}`);
  }
  if (node.array) parts.push(`a[${signature(node.array)}]`);
  if (node.nullable) parts.push('null');
  return parts.join('|');
}
