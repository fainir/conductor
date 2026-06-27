// translate - a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The model translates the provided text into the requested target language using
// ONLY the supplied text. The verifier is cheap and deterministic: it asserts the
// translation is a non-empty string and stays within a sane length bound so a
// runaway or explanatory answer is rejected.

import { z } from "zod";
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { combine, check, schemaVerdict } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "translate",
  description: "Translate a piece of text into a given target language.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You are a translator. Read the user-provided INPUT JSON, which has fields 'text' and 'target_language'. " +
    "Translate the value of 'text' into the language named by 'target_language'. " +
    "Use ONLY the provided text - never add outside knowledge, commentary, or content not present in it. " +
    "Output only the translation itself, with no notes, labels, quotes, or explanations.",
  promptTemplate:
    "Translate the 'text' field of the INPUT JSON below into the language named by the 'target_language' field. " +
    "Use ONLY what the text says. Return only the translated text - no notes, no labels, no surrounding quotes. " +
    "Put the result in the 'translation' field of the output.\nINPUT:\n",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      target_language: { type: "string" },
    },
    required: ["text", "target_language"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      translation: { type: "string" },
    },
    required: ["translation"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

const Out = z.object({
  translation: z.string(),
});

export async function verify(
  output: unknown,
  input: { text: string; target_language: string },
  _ctx: SolveContext,
): Promise<Verdict> {
  const parsed = schemaVerdict(Out, output);
  if (!parsed.ok) return parsed;
  const o = output as z.infer<typeof Out>;
  const bound = input.text.length * 5 + 20;

  return combine(
    check("translation-string", typeof o.translation === "string",
      "translation must be a string"),
    check("translation-nonempty", o.translation.trim().length > 0,
      "translation must not be empty"),
    check("translation-length", o.translation.length <= bound,
      `translation length ${o.translation.length} exceeds the sane bound of ${bound} (likely contains notes or extra text)`),
  );
}
