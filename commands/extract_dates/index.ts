// extract_dates - a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// The model reads ONLY the provided text and returns every date it references,
// normalized to ISO format YYYY-MM-DD. The verifier is cheap and deterministic:
// it asserts the result is an array of strings, each matching the ISO shape AND
// representing a real calendar date that round-trips through the Date constructor.

import { z } from "zod";
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { combine, check, schemaVerdict } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "extract_dates",
  description: "Extract every date referenced in a piece of text, normalized to ISO format YYYY-MM-DD.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You extract dates from the user-provided text ONLY. Read the 'text' field from the appended INPUT JSON. " +
    "Never use outside knowledge, memory, the current date, or any ambient context. " +
    "Return every date that is actually referenced in the text, each normalized to ISO format YYYY-MM-DD. " +
    "Do not invent, infer, or complete dates that are not present. If the text references no dates, return an empty array.",
  promptTemplate:
    "Read the 'text' field from the INPUT JSON appended below. Extract every date that is actually referenced in that text. " +
    "Normalize each date to ISO format YYYY-MM-DD (four-digit year, two-digit month, two-digit day). " +
    "Use ONLY what literally appears in the text - never use the current date or any outside knowledge. " +
    "If no dates are referenced, return an empty array. " +
    "Return an object with a single key 'dates' whose value is the array of ISO date strings.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      dates: { type: "array", items: { type: "string" } },
    },
    required: ["dates"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const Out = z.object({
  dates: z.array(z.string()),
});

/** True when d is a syntactically and calendrically valid ISO date that round-trips. */
function isRealIsoDate(d: string): boolean {
  if (!ISO_RE.test(d)) return false;
  const dt = new Date(d + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return false;
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}` === d;
}

export async function verify(output: unknown, _input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  const parsed = schemaVerdict(Out, output);
  if (!parsed.ok) return parsed;
  const o = output as z.infer<typeof Out>;

  if (!Array.isArray(o.dates)) {
    return { ok: false, score: 0, feedback: "dates: must be an array of ISO date strings" };
  }

  const firstInvalid = o.dates.find((d) => !isRealIsoDate(d));
  return combine(
    check(
      "dates-valid",
      firstInvalid === undefined,
      `'${firstInvalid}' is not a valid YYYY-MM-DD calendar date`,
    ),
  );
}
