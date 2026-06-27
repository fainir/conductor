// dedupe_lines — a PURE command. Splits the input text on "\n", keeps the first
// occurrence of each line while preserving order, and returns the deduped list.
// The verifier RECOMPUTES the dedupe from the input and asserts equality, plus
// enforces that there are no duplicates and every line is a member of the split input.

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

function dedupe(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

export const manifest: CommandManifest = {
  name: "dedupe_lines",
  description: "Split text on newlines and keep the first occurrence of each line, preserving order.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lines: { type: "array", items: { type: "string" } },
    },
    required: ["lines"],
    additionalProperties: false,
  },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { text: string }): Promise<{ lines: string[] }> {
  return { lines: dedupe(input.text) };
}

export async function verify(
  output: { lines: string[] },
  input: { text: string },
  _ctx: SolveContext,
): Promise<Verdict> {
  const lines = (output as { lines: unknown }).lines;
  if (!Array.isArray(lines)) {
    return { ok: false, score: 0, feedback: "array: lines must be an array of strings" };
  }
  const allStrings = lines.every((l) => typeof l === "string");
  const source = input.text.split("\n");
  const sourceSet = new Set(source);
  const expected = dedupe(input.text);
  return combine(
    check("strings", allStrings, "every element of lines must be a string"),
    check(
      "no-duplicates",
      new Set(lines).size === lines.length,
      "lines must not contain any duplicate values",
    ),
    check(
      "members",
      lines.every((l) => sourceSet.has(l as string)),
      "every line must be a member of input.text.split('\\n')",
    ),
    check(
      "recompute",
      JSON.stringify(lines) === JSON.stringify(expected),
      "lines must equal the input split on newlines with the first occurrence of each line kept in order",
    ),
  );
}
