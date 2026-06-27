// categorize — a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The model reads ONLY the provided text and a list of allowed categories, then
// returns the single best-fitting category copied verbatim. The verifier is cheap
// and deterministic: it asserts the returned category is a string AND is one of the
// allowed categories. Membership is the key grounding check — it catches a model
// that invents a label or paraphrases instead of choosing from the provided set.

import { z } from "zod";
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { combine, check, schemaVerdict } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "categorize",
  description: "Choose the single best-fitting category for a piece of text from a provided list of categories.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You are a text categorizer. Choose the single best category for the user-provided text using ONLY what the text " +
    "expresses. Never use outside knowledge, memory, or assumptions beyond what the text itself says. " +
    "You MUST return exactly one category, and it MUST be copied verbatim from the provided list of categories - " +
    "do not invent, rename, paraphrase, or pluralize any category.",
  promptTemplate:
    "Read the appended INPUT JSON. It has a 'text' field and a 'categories' field (an array of allowed category strings). " +
    "Choose the SINGLE category from 'categories' that best fits 'text'. " +
    "Return that category copied verbatim - it must be exactly one of the strings in the 'categories' array. " +
    "Base the decision ONLY on what the text itself expresses.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      categories: { type: "array", items: { type: "string" } },
    },
    required: ["text", "categories"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
    },
    required: ["category"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

const Out = z.object({
  category: z.string(),
});

export async function verify(
  output: unknown,
  input: { text: string; categories: string[] },
  _ctx: SolveContext,
): Promise<Verdict> {
  const parsed = schemaVerdict(Out, output);
  if (!parsed.ok) return parsed;
  const o = output as z.infer<typeof Out>;

  return combine(
    check("category-string", typeof o.category === "string",
      `category '${o.category}' must be a string`),
    // membership: the returned category must be one of the allowed categories
    check("category-member", input.categories.includes(o.category),
      `the returned category '${o.category}' is not one of the allowed categories`),
  );
}
