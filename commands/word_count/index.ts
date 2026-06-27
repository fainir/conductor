import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "word_count",
  description: "Count the words and characters in a string. Words are whitespace-separated tokens of the trimmed text; chars is the raw length of the input.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      words: { type: "integer", minimum: 0 },
      chars: { type: "integer", minimum: 0 },
    },
    required: ["words", "chars"],
    additionalProperties: false,
  },
  fallbacks: [],
  effectful: false,
};

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export async function run(input: { text: string }): Promise<{ words: number; chars: number }> {
  return {
    words: countWords(input.text),
    chars: input.text.length,
  };
}

export async function verify(
  output: { words: number; chars: number },
  input: { text: string },
  _ctx: SolveContext,
): Promise<Verdict> {
  const expectedWords = countWords(input.text);
  const expectedChars = input.text.length;
  return combine(
    check("words-number", typeof output.words === "number", "words must be a number"),
    check("chars-number", typeof output.chars === "number", "chars must be a number"),
    check("words-integer", Number.isInteger(output.words), "words must be an integer"),
    check("chars-integer", Number.isInteger(output.chars), "chars must be an integer"),
    check("words-nonneg", output.words >= 0, "words must be >= 0"),
    check("chars-nonneg", output.chars >= 0, "chars must be >= 0"),
    check(
      "words-correct",
      output.words === expectedWords,
      "words must equal the number of whitespace-separated tokens of the trimmed input (" + expectedWords + ")",
    ),
    check(
      "chars-correct",
      output.chars === expectedChars,
      "chars must equal the raw length of the input (" + expectedChars + ")",
    ),
  );
}
