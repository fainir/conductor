// to_snake_case - a PURE command. Verifier recomputes the canonical form and asserts equality.
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

function toSnake(text: string): string {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1_$2") // split camelCase boundaries
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1_$2") // split acronyms: XMLHttp -> XML_Http
    .replace(/[^\p{L}\p{N}]+/gu, "_") // runs of anything but letters/digits -> underscore
    .replace(/^_+|_+$/g, "") // trim
    .toLowerCase();
}

export const manifest: CommandManifest = {
  name: "to_snake_case",
  description: "Convert a string to snake_case.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  outputSchema: { type: "object", properties: { snake: { type: "string" } }, required: ["snake"], additionalProperties: false },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { text: string }): Promise<{ snake: string }> {
  return { snake: toSnake(input.text) };
}

export async function verify(output: { snake: string }, input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  return combine(
    check("string", typeof output?.snake === "string", "snake must be a string"),
    check("recompute", output?.snake === toSnake(input.text), "snake does not match the canonical snake_case of the input"),
  );
}
