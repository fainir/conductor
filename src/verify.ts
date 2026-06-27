// verify.ts — helpers for building verifiers.
// Mechanical checks first (deterministic, free, trustworthy); LLM-judge only for
// genuinely semantic criteria. Checking is easier than doing — lean on it.

import type { ZodType } from "zod";
import type { Verdict } from "./types.js";
import { callClaude } from "./cc.js";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[+]?[\d][\d\s().\-]{6,}$/;

// Non-anchored detectors: "does a PII-looking token appear ANYWHERE in the text?"
// Useful for redaction verifiers (no email/phone should remain) and grounding.
export const EMAIL_FIND = /[^\s@]+@[^\s@]+\.[^\s@]+/;
export const PHONE_FIND = /\+?\d[\d\s().\-]{6,}\d/;

/** Pass-through helper: returns null when the predicate holds, else a failing Verdict. */
export function check(name: string, predicate: boolean, feedback: string): Verdict | null {
  return predicate ? null : { ok: false, score: 0, feedback: `${name}: ${feedback}` };
}

/** First failing check wins; otherwise ok. */
export function combine(...checks: (Verdict | null)[]): Verdict {
  for (const c of checks) if (c && !c.ok) return c;
  return { ok: true, score: 1 };
}

/** Validate output against a zod schema. */
export function schemaVerdict(schema: ZodType, output: unknown): Verdict {
  const r = schema.safeParse(output);
  if (r.success) return { ok: true, score: 1 };
  return { ok: false, score: 0, feedback: "schema: " + r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

/**
 * Independent LLM judge, framed to refute. Use sparingly and only for semantic
 * criteria that no mechanical check can express. Runs hermetically (no ambient context).
 */
export async function llmJudge(opts: { criteria: string; output: unknown; model?: string }): Promise<Verdict> {
  const schema = {
    type: "object",
    properties: { pass: { type: "boolean" }, reason: { type: "string" } },
    required: ["pass", "reason"],
    additionalProperties: false,
  };
  const r = await callClaude<{ pass: boolean; reason: string }>({
    systemPrompt:
      "You are a strict, skeptical verifier. Judge ONLY the provided output against the criteria, using no outside knowledge. Default to pass=false if the output does not CLEARLY satisfy every criterion.",
    prompt: `CRITERIA:\n${opts.criteria}\n\nOUTPUT TO JUDGE:\n${JSON.stringify(opts.output)}`,
    jsonSchema: schema,
    model: opts.model ?? "haiku",
  });
  if (!r.ok || !r.structured) return { ok: false, score: 0, feedback: "judge call failed: " + (r.error ?? "no output") };
  return {
    ok: r.structured.pass,
    score: r.structured.pass ? 1 : 0,
    reason: r.structured.reason,
    feedback: r.structured.pass ? undefined : r.structured.reason,
  };
}
