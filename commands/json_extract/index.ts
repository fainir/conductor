// json_extract — a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The model extracts a caller-specified set of fields from the input text into an
// open object "data". The reliability move is structural: the verifier asserts that
// "data" is a real (non-null, non-array) object and that EVERY requested field is
// present as a key, with a null value when the field is absent from the text.

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "json_extract",
  description:
    "Extract a caller-specified list of fields from a blob of text into a JSON object. " +
    "Each requested field becomes a key; the value is null when the field is absent from the text.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You extract structured data from the user-provided text ONLY. Use exclusively what literally appears " +
    "in the text — never outside knowledge, memory, assumptions, or the operator's own identity. " +
    "Return a JSON object 'data' whose keys are exactly the requested field names. " +
    "If a requested field does not appear in the text, set its value to null.",
  promptTemplate:
    "From the text below, extract the requested fields into an object 'data'. " +
    "Include one key for EVERY requested field, spelled exactly as requested. " +
    "Use ONLY information that literally appears in the text; any field that is absent must be null. " +
    "Do not invent, infer beyond the text, or add extra keys.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      fields: { type: "array", items: { type: "string" } },
    },
    required: ["text", "fields"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      // "data" is an OPEN object: its keys are determined at runtime by input.fields.
      data: { type: "object" },
    },
    required: ["data"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

export async function verify(
  output: unknown,
  input: { text: string; fields: string[] },
  _ctx: SolveContext,
): Promise<Verdict> {
  const o = output as { data?: unknown };
  const data = o?.data;

  const isObject =
    typeof data === "object" && data !== null && !Array.isArray(data);

  const shapeCheck = check(
    "data-is-object",
    isObject,
    "output.data must be a non-null, non-array object",
  );
  if (shapeCheck) return shapeCheck;

  const keys = data as Record<string, unknown>;
  const missing = input.fields.find((f) => !Object.prototype.hasOwnProperty.call(keys, f));

  return combine(
    check(
      "all-fields-present",
      missing === undefined,
      `requested field '${missing}' is missing from output.data (use null if it is absent from the text)`,
    ),
  );
}
