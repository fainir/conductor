import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/schema.js";
import { library } from "../src/library.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = {
  type: "object",
  properties: {
    text: { type: "string" },
    max: { type: "number", minimum: 0 },
    k: { type: "integer", minimum: 1 },
    tags: { type: "array", items: { type: "string" }, minItems: 1 },
    label: { type: "string", enum: ["a", "b"] },
    maybe: { type: ["string", "null"] },
    any: {},
  },
  required: ["text"],
  additionalProperties: false,
};

test("validate: a conforming value has no errors", () => {
  assert.deepEqual(validate(schema, { text: "x", max: 0, k: 3, tags: ["t"], label: "a", maybe: null, any: { deep: [1] } }), []);
});

test("validate: missing required, wrong types and unexpected keys are all reported with paths", () => {
  assert.deepEqual(validate(schema, { max: "5", extra: 1 }), [
    "input: missing required property 'text'",
    "input.max: expected number, got string",
    "input: unexpected property 'extra' (allowed: text, max, k, tags, label, maybe, any)",
  ]);
});

test("validate: integer, minimum, minItems, enum and item types", () => {
  assert.deepEqual(validate(schema, { text: "x", k: 1.5 }), ["input.k: expected integer, got number"]);
  assert.deepEqual(validate(schema, { text: "x", max: -1, k: 0 }), ["input.max: must be >= 0, got -1", "input.k: must be >= 1, got 0"]);
  assert.deepEqual(validate(schema, { text: "x", tags: [] }), ["input.tags: must have at least 1 item(s), got 0"]);
  assert.deepEqual(validate(schema, { text: "x", tags: ["ok", 2] }), ["input.tags[1]: expected string, got number"]);
  assert.deepEqual(validate(schema, { text: "x", label: "c" }), ['input.label: must be one of "a", "b"']);
  assert.deepEqual(validate(schema, { text: "x", maybe: 3 }), ["input.maybe: expected string or null, got number"]);
});

test("validate: non-objects, arrays and null at the top level", () => {
  assert.deepEqual(validate(schema, null), ["input: expected object, got null"]);
  assert.deepEqual(validate(schema, ["text"]), ["input: expected object, got array"]);
  assert.deepEqual(validate(schema, "text"), ["input: expected object, got string"]);
  assert.deepEqual(validate({ type: "number" }, Number.NaN), ["input: expected number, got number"]);
});

test("validate: every shipped case input satisfies its command's inputSchema", () => {
  for (const [name, c] of library()) {
    const file = resolve(import.meta.dirname, "..", "commands", name, "tests/cases.json");
    for (const [i, k] of (JSON.parse(readFileSync(file, "utf8")) as { input: unknown }[]).entries()) {
      assert.deepEqual(validate(c.manifest.inputSchema, k.input), [], `${name}[${i}]`);
    }
  }
});

test("validate: every pure command's output satisfies its own outputSchema", async () => {
  for (const [name, c] of library()) {
    if (!c.run) continue;
    const file = resolve(import.meta.dirname, "..", "commands", name, "tests/cases.json");
    for (const k of JSON.parse(readFileSync(file, "utf8")) as { input: unknown }[]) {
      const out = await c.run(k.input, { goal: name, depth: 0, trace: [] });
      assert.deepEqual(validate(c.manifest.outputSchema, out, "output"), [], name);
    }
  }
});
