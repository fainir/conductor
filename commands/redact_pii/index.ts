// redact_pii — a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The model rewrites the input text, replacing every email address and phone
// number with the literal token [REDACTED]. The verifier is cheap and
// deterministic: it asserts no PII-looking token survives in the output, and
// that genuine redaction happened when the input actually contained PII.

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { EMAIL_FIND, PHONE_FIND, combine, check } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "redact_pii",
  description: "Replace every email address and phone number in the input text with [REDACTED], leaving all other text unchanged.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You redact personally identifiable information from the user-provided text ONLY. " +
    "Use only the text given in this request; never add, invent, or rely on outside knowledge, memory, or any other context. " +
    "Replace EVERY email address and EVERY phone number that appears in the text with the literal token [REDACTED]. " +
    "Leave every other character of the text exactly as it is — do not paraphrase, reorder, summarize, or change anything else.",
  promptTemplate:
    "Rewrite the text below, replacing every email address and every phone number with the literal token [REDACTED]. " +
    "Leave all other text unchanged. Return the full rewritten text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { redacted: { type: "string" } },
    required: ["redacted"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

export async function verify(output: unknown, input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  const o = output as { redacted?: unknown };
  const redacted = o?.redacted;

  // Type/shape check first so later checks can assume a string.
  if (typeof redacted !== "string" || redacted.length === 0) {
    return { ok: false, score: 0, feedback: "non-empty-string: redacted must be a non-empty string" };
  }

  const inputHadPii = EMAIL_FIND.test(input.text) || PHONE_FIND.test(input.text);

  return combine(
    check("no-email", EMAIL_FIND.test(redacted) === false,
      "an email address still appears in the output; replace every email with [REDACTED]"),
    check("no-phone", PHONE_FIND.test(redacted) === false,
      "a phone number still appears in the output; replace every phone number with [REDACTED]"),
    check("redaction-token", !inputHadPii || redacted.includes("[REDACTED]"),
      "the input contained PII but the output has no [REDACTED] token; PII must be replaced with the literal token [REDACTED]"),
  );
}
