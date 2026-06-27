// fix_json - a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The input text is malformed or loosely-formatted JSON (single quotes, trailing
// commas, code fences, unclosed brackets, etc.). The model repairs it into the
// intended JSON value and returns it under "json". The verifier is cheap and
// deterministic: it confirms the output is an object carrying a defined, non-null
// "json" value that is itself an object or array (the usual shape of fixed JSON).

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { combine, check } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "fix_json",
  description: "Repair malformed or loosely-formatted JSON text into a valid JSON value.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You repair broken JSON. Read ONLY the user-provided text and parse it into the JSON value it was " +
    "clearly meant to be. Fix common defects: single quotes, unquoted keys, trailing commas, surrounding " +
    "code fences or prose, and unclosed brackets or braces. Do not invent, add, drop, or guess fields or " +
    "values beyond what the text plainly implies. Never use outside knowledge or memory.",
  promptTemplate:
    "The INPUT JSON appended below has a field 'text' containing malformed or loosely-formatted JSON. " +
    "Parse that text into the JSON value it was intended to represent and return it under the key 'json'. " +
    "Use ONLY the content of 'text'; do not invent fields. If a bracket or brace is unclosed, close it to " +
    "form the most plausible value implied by the text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { json: {} },
    required: ["json"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

export async function verify(output: unknown, _input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  if (typeof output !== "object" || output === null) {
    return { ok: false, score: 0, feedback: "output must be a non-null object with a 'json' key" };
  }
  const o = output as { json?: unknown };

  return combine(
    check("json-present", o.json !== undefined && o.json !== null,
      "output.json must be defined and non-null"),
    check("json-shape", typeof o.json === "object" && o.json !== null,
      "output.json should be an object or array (the typical shape of repaired JSON)"),
  );
}
