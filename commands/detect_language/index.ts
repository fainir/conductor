// detect_language - a STOCHASTIC command. Verifier enforces an ISO 639-1 two-letter code.
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "detect_language",
  description: "Detect the natural language of text.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You detect the natural language of the user-provided text. Use only the text. " +
    "Return the language name and its ISO 639-1 two-letter lowercase code.",
  promptTemplate:
    "Detect the language of the INPUT text. Return the language (English name) and code " +
    "(ISO 639-1 two-letter lowercase, e.g. en, fr, es, de).",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { language: { type: "string" }, code: { type: "string" } },
    required: ["language", "code"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

export async function verify(output: { language: string; code: string }, _input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  return combine(
    check("language", typeof output?.language === "string" && output.language.trim().length > 0, "language must be a non-empty string"),
    check("code", typeof output?.code === "string" && /^[a-z]{2}$/.test(output.code), "code must be a 2-letter ISO 639-1 lowercase code"),
  );
}
