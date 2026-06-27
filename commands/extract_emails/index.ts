// extract_emails - a PURE command. Verifier checks format + grounding (each email appears in source).
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { EMAIL_RE } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "extract_emails",
  description: "Extract all email addresses from text.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { emails: { type: "array", items: { type: "string" } } },
    required: ["emails"],
    additionalProperties: false,
  },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { text: string }): Promise<{ emails: string[] }> {
  const matches = input.text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/g) ?? [];
  return { emails: [...new Set(matches)] };
}

export async function verify(output: { emails: string[] }, input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  if (!Array.isArray(output?.emails)) return { ok: false, feedback: "emails must be an array" };
  for (const e of output.emails) {
    if (typeof e !== "string" || !EMAIL_RE.test(e)) return { ok: false, feedback: `'${e}' is not a valid email` };
    if (!input.text.includes(e)) return { ok: false, feedback: `'${e}' does not appear in the source text` };
  }
  return { ok: true, score: 1 };
}
