// template_fill - a PURE command. Replaces every {{key}} token in the template
// with String(data[key]) when key is present in data, otherwise leaves the {{key}}
// token unchanged. The verifier RECOMPUTES the fill from the input and asserts that
// no unresolved {{placeholder}} remains.

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

const TOKEN = /\{\{(\w+)\}\}/g;
const UNRESOLVED = /\{\{\w+\}\}/;

function fill(template: string, data: Record<string, unknown>): string {
  return template.replace(TOKEN, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match,
  );
}

export const manifest: CommandManifest = {
  name: "template_fill",
  description: "Fill a template by replacing every {{key}} token with String(data[key]); unknown keys keep their {{key}} token.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: {
    type: "object",
    properties: {
      template: { type: "string" },
      data: { type: "object" },
    },
    required: ["template", "data"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      result: { type: "string" },
    },
    required: ["result"],
    additionalProperties: false,
  },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { template: string; data: Record<string, unknown> }): Promise<{ result: string }> {
  return { result: fill(input.template, input.data) };
}

export async function verify(
  output: { result: string },
  input: { template: string; data: Record<string, unknown> },
  _ctx: SolveContext,
): Promise<Verdict> {
  const out = output as { result: string };
  const expected = fill(input.template, input.data);
  return combine(
    check("string", typeof out.result === "string", "result must be a string"),
    check(
      "recompute",
      typeof out.result === "string" && out.result === expected,
      "result must equal the template with each {{key}} replaced by String(data[key]) and unknown keys left unchanged",
    ),
    check(
      "no-unresolved",
      typeof out.result === "string" && UNRESOLVED.test(out.result) === false,
      "an unfilled {{placeholder}} remains in result - every {{key}} token must be resolved",
    ),
  );
}
