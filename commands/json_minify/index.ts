// json_minify - a PURE command. Verifier confirms output is JSON equivalent to the input.
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";

export const manifest: CommandManifest = {
  name: "json_minify",
  description: "Minify a JSON string by removing insignificant whitespace.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: { type: "object", properties: { json: { type: "string" } }, required: ["json"], additionalProperties: false },
  outputSchema: { type: "object", properties: { minified: { type: "string" } }, required: ["minified"], additionalProperties: false },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { json: string }): Promise<{ minified: string }> {
  return { minified: JSON.stringify(JSON.parse(input.json)) };
}

export async function verify(output: { minified: string }, input: { json: string }, _ctx: SolveContext): Promise<Verdict> {
  if (typeof output?.minified !== "string") return { ok: false, feedback: "minified must be a string" };
  let a: string;
  let b: string;
  try { a = JSON.stringify(JSON.parse(input.json)); } catch { return { ok: false, feedback: "input json is not valid JSON" }; }
  try { b = JSON.stringify(JSON.parse(output.minified)); } catch { return { ok: false, feedback: "minified is not valid JSON" }; }
  if (a !== b) return { ok: false, feedback: "minified is not equivalent to the input json" };
  return { ok: true, score: 1 };
}
