// classify_sentiment — a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The model reads ONLY the provided text and returns one of three sentiment labels
// plus a confidence. The verifier is cheap and deterministic: it asserts the label is
// one of the allowed enum values and that confidence is a real number in [0, 1].

import { z } from "zod";
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { combine, check, schemaVerdict } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "classify_sentiment",
  description: "Classify the overall sentiment of a piece of text as positive, negative, or neutral.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You are a sentiment classifier. Judge the overall sentiment of the user-provided text ONLY. " +
    "Never use outside knowledge, memory, or assumptions beyond what the text expresses. " +
    "Return exactly one label from {positive, negative, neutral} and a confidence in the range 0..1.",
  promptTemplate:
    "Classify the overall sentiment of the text below as exactly one of: positive, negative, neutral. " +
    "Base the decision ONLY on what the text itself expresses. " +
    "Also return a confidence between 0 and 1 reflecting how certain the classification is.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      label: { type: "string", enum: ["positive", "negative", "neutral"] },
      confidence: { type: "number" },
    },
    required: ["label", "confidence"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

const LABELS = ["positive", "negative", "neutral"] as const;

const Out = z.object({
  label: z.enum(LABELS),
  confidence: z.number(),
});

export async function verify(output: unknown, _input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  const parsed = schemaVerdict(Out, output);
  if (!parsed.ok) return parsed;
  const o = output as z.infer<typeof Out>;

  return combine(
    check("label-enum", (LABELS as readonly string[]).includes(o.label),
      `label '${o.label}' must be one of positive, negative, neutral`),
    check("confidence-number", typeof o.confidence === "number" && Number.isFinite(o.confidence),
      `confidence '${o.confidence}' must be a finite number`),
    check("confidence-range", o.confidence >= 0 && o.confidence <= 1,
      `confidence ${o.confidence} must be in the range 0..1`),
  );
}
