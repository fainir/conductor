// extract_keywords — a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The reliability move: the verifier is cheap, deterministic, and includes a
// *grounding* check — every returned keyword must actually appear, verbatim, in
// the source text (lowercased). That catches hallucinated or paraphrased terms
// that a raw model call would happily invent.

import { z } from "zod";
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { combine, check, schemaVerdict } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "extract_keywords",
  description: "Extract up to k salient keywords or short phrases that appear verbatim in the input text.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You extract keywords from the user-provided text ONLY. Never use outside knowledge, memory, " +
    "synonyms, or the operator's own context. Every keyword you return MUST appear verbatim (as a " +
    "substring) in the input text. Lowercase every keyword. Do not paraphrase, summarize, or invent terms.",
  promptTemplate:
    "Extract up to k (default 5) salient keywords or short phrases from the text below. " +
    "Each keyword MUST appear verbatim in the text and MUST be lowercased. " +
    "Prefer the most informative, content-bearing words or short phrases. Do not exceed k items.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      k: { type: "integer", minimum: 1 },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      keywords: { type: "array", items: { type: "string" } },
    },
    required: ["keywords"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

const Out = z.object({
  keywords: z.array(z.string()),
});

export async function verify(
  output: unknown,
  input: { text: string; k?: number },
  _ctx: SolveContext,
): Promise<Verdict> {
  const parsed = schemaVerdict(Out, output);
  if (!parsed.ok) return parsed;
  const o = output as z.infer<typeof Out>;

  const k = input.k ?? 5;
  const haystack = input.text.toLowerCase();

  // Find the first keyword that is not grounded in the source text.
  const firstUngrounded = o.keywords.find(
    (kw) => typeof kw !== "string" || kw.length === 0 || !haystack.includes(kw.toLowerCase()),
  );

  return combine(
    check("array", Array.isArray(o.keywords), "keywords must be an array"),
    check("count-min", o.keywords.length >= 1, "keywords must contain at least 1 item"),
    check("count-max", o.keywords.length <= k, `keywords must contain at most k=${k} items, got ${o.keywords.length}`),
    check(
      "non-empty-strings",
      o.keywords.every((kw) => typeof kw === "string" && kw.length > 0),
      "every keyword must be a non-empty string",
    ),
    // grounding: each keyword must appear verbatim (lowercased) in the source text.
    check(
      "grounded",
      firstUngrounded === undefined,
      `keyword '${firstUngrounded}' does not appear in the source text (hallucinated or paraphrased - keywords must be verbatim substrings)`,
    ),
  );
}
