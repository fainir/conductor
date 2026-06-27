// summarize — a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The verifier is cheap, deterministic, and input-independent on the sentence
// budget: it splits the *output* on sentence terminators and counts non-empty
// pieces, so a model that ignores max_sentences is caught without re-reading the
// source. The compression check (summary no longer than the source) catches the
// degenerate "summary" that just echoes the whole input.

import { z } from "zod";
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { combine, check, schemaVerdict } from "../../src/verify.js";

const DEFAULT_MAX_SENTENCES = 2;

export const manifest: CommandManifest = {
  name: "summarize",
  description: "Summarize a blob of text in at most a few sentences, using only the text itself.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You summarize the user-provided text ONLY. Use no outside knowledge, memory, or invented facts. " +
    "Every statement in your summary must be supported by the provided text. Respect the requested " +
    "sentence limit exactly and never exceed it. Return only the summary.",
  promptTemplate:
    "Summarize the `text` field of the INPUT below. Write at most `max_sentences` sentences " +
    "(if `max_sentences` is absent from the INPUT, use at most 2 sentences). Use ONLY information that " +
    "appears in the text - do not add, infer, or invent anything. Keep the summary shorter than the original text.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      max_sentences: { type: "integer", minimum: 1 },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      summary: { type: "string" },
    },
    required: ["summary"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

const Out = z.object({
  summary: z.string(),
});

/** Count sentences by splitting on terminal punctuation and keeping non-empty pieces. */
function countSentences(s: string): number {
  return s
    .split(/[.!?]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

export async function verify(
  output: unknown,
  input: { text: string; max_sentences?: number },
  _ctx: SolveContext,
): Promise<Verdict> {
  const parsed = schemaVerdict(Out, output);
  if (!parsed.ok) return parsed;
  const o = output as z.infer<typeof Out>;

  const maxSentences = input.max_sentences ?? DEFAULT_MAX_SENTENCES;
  const sentenceCount = countSentences(o.summary);

  return combine(
    check("non-empty", o.summary.trim().length > 0, "summary must be a non-empty string"),
    check(
      "sentence-budget",
      sentenceCount <= maxSentences,
      `summary has ${sentenceCount} sentence(s) but the limit is ${maxSentences}`,
    ),
    check(
      "compression",
      o.summary.length <= input.text.length,
      `summary (${o.summary.length} chars) must be no longer than the source text (${input.text.length} chars)`,
    ),
  );
}
