// truncate - a PURE command. Shortens a string to at most `max` characters. When
// the text already fits it is returned unchanged; otherwise it is cut to
// (max - 1) characters and a single-character ellipsis "…" is appended so
// the total length never exceeds `max`. The verifier RECOMPUTES the truncation
// from the input and asserts the length bound.

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, Math.max(0, max)); // no room for an ellipsis
  return text.slice(0, max - 1) + "…";
}

export const manifest: CommandManifest = {
  name: "truncate",
  description: "Truncate text to at most `max` characters, appending a single-character ellipsis when it must be cut.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      max: { type: "number" },
    },
    required: ["text", "max"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { text: string; max: number }): Promise<{ text: string }> {
  return { text: truncate(input.text, input.max) };
}

export async function verify(
  output: { text: string },
  input: { text: string; max: number },
  _ctx: SolveContext,
): Promise<Verdict> {
  return combine(
    check("string", typeof output.text === "string", "text must be a string"),
    check(
      "length",
      typeof output.text === "string" && output.text.length <= input.max,
      "text length must be <= max (" + input.max + ")",
    ),
    check(
      "recompute",
      output.text === truncate(input.text, input.max),
      "text must equal the input truncated to max characters with a single-character ellipsis appended when cut",
    ),
  );
}
