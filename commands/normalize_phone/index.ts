// normalize_phone — a PURE command. Strips every non-digit from the input phone
// string and preserves a leading "+" when present, yielding a canonical
// "[+]digits" form. The verifier RECOMPUTES the normalization from the input and
// asserts equality, plus enforces the canonical shape /^\+?\d{6,15}$/.

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

const SHAPE = /^\+?\d{6,15}$/;

function normalize(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return plus + digits;
}

export const manifest: CommandManifest = {
  name: "normalize_phone",
  description: "Normalize a phone string to canonical '[+]digits' form by stripping non-digit characters.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: {
    type: "object",
    properties: { phone: { type: "string" } },
    required: ["phone"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { normalized: { type: "string" } },
    required: ["normalized"],
    additionalProperties: false,
  },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { phone: string }): Promise<{ normalized: string }> {
  return { normalized: normalize(input.phone) };
}

export async function verify(
  output: { normalized: string },
  input: { phone: string },
  _ctx: SolveContext,
): Promise<Verdict> {
  return combine(
    check("string", typeof output.normalized === "string", "normalized must be a string"),
    check(
      "recompute",
      output.normalized === normalize(input.phone),
      "normalized must equal the input with non-digits stripped and a leading '+' preserved",
    ),
    check(
      "shape",
      SHAPE.test(output.normalized),
      "normalized must match /^\\+?\\d{6,15}$/ (an optional leading '+' followed by 6-15 digits)",
    ),
  );
}
