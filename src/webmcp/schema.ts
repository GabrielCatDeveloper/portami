// ============================================================
// JSON Schema helpers for WebMCP tools.
//
// `document.modelContext.registerTool` accepts a literal JSON
// Schema object. The types in `@mcp-b/webmcp-types` are deliberately
// loose (`type?: unknown`) so the runtime can accept either a
// plain object or a Schema literal. We keep the literals here so
// that:
//   - `type: "object" as const` and `type: "string" as const` etc.
//     don't pollute every tool definition;
//   - the test suite can introspect the same schema we register.
//
// The helpers below return the correct literal type so that
// `registerTool`'s overload picks up the input-inference overload
// and the `execute` callback receives a strongly-typed `args`.
// ============================================================

import type { InputSchema } from '@mcp-b/webmcp-types';

/** JSON Schema primitive types we emit in tool definitions. */
type JsonSchemaPrimitive =
  | { type: 'string'; enum?: readonly string[]; description?: string }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number }
  | { type: 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string };

/** Build an object schema literal. */
export function object(
  properties: Record<string, JsonSchemaPrimitive>,
  required: readonly string[] = [],
  description?: string,
): InputSchema {
  return {
    type: 'object',
    description,
    properties,
    required,
    additionalProperties: false,
  };
}

/** Build an empty (no-args) schema. */
export function empty(): InputSchema {
  return { type: 'object', properties: {}, additionalProperties: false };
}

/** String property helper. */
export function str(description?: string, enumValues?: readonly string[]): JsonSchemaPrimitive {
  return enumValues
    ? { type: 'string', description, enum: enumValues }
    : { type: 'string', description };
}

/** Number property helper. */
export function num(description?: string, opts?: { minimum?: number; maximum?: number }): JsonSchemaPrimitive {
  return { type: 'number', description, ...opts };
}

/** Integer property helper. */
export function int(description?: string, opts?: { minimum?: number; maximum?: number }): JsonSchemaPrimitive {
  return { type: 'integer', description, ...opts };
}

/** Boolean property helper. */
export function bool(description?: string): JsonSchemaPrimitive {
  return { type: 'boolean', description };
}
