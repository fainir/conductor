// schema.ts - a small JSON Schema checker for command contracts.
// Covers exactly the keywords the manifests use: type (one or a list), enum,
// properties, required, additionalProperties: false, items, minimum, minItems.
// Unknown keywords are ignored, so a schema can carry extra annotations.

import type { JSONSchema } from "./types.js";

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function hasType(v: unknown, t: string): boolean {
  switch (t) {
    case "object": return typeOf(v) === "object";
    case "array": return Array.isArray(v);
    case "null": return v === null;
    case "integer": return Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    default: return typeof v === t;
  }
}

/** Every way `value` breaks `schema`, as readable "path: problem" lines. Empty means valid. */
export function validate(schema: JSONSchema, value: unknown, path = "input"): string[] {
  const s = schema as Record<string, any>;
  const errors: string[] = [];

  if (s.type !== undefined) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => hasType(value, t))) {
      return [`${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`];
    }
  }
  if (Array.isArray(s.enum) && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: must be one of ${s.enum.map((e: unknown) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof s.minimum === "number" && typeof value === "number" && value < s.minimum) {
    errors.push(`${path}: must be >= ${s.minimum}, got ${value}`);
  }

  if (Array.isArray(value)) {
    if (typeof s.minItems === "number" && value.length < s.minItems) {
      errors.push(`${path}: must have at least ${s.minItems} item(s), got ${value.length}`);
    }
    if (s.items && typeof s.items === "object") {
      value.forEach((item, i) => errors.push(...validate(s.items, item, `${path}[${i}]`)));
    }
  }

  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const props: Record<string, JSONSchema> = s.properties ?? {};
    for (const key of s.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) errors.push(`${path}: missing required property '${key}'`);
    }
    for (const [key, v] of Object.entries(obj)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) errors.push(...validate(props[key], v, `${path}.${key}`));
      else if (s.additionalProperties === false) {
        const allowed = Object.keys(props);
        errors.push(`${path}: unexpected property '${key}'${allowed.length ? ` (allowed: ${allowed.join(", ")})` : ""}`);
      }
    }
  }
  return errors;
}
