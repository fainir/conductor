// extract_contact — a STOCHASTIC command (model-driven) with a MECHANICAL verifier.
// Demonstrates the core reliability move: the verifier is cheap, deterministic, and
// includes a *grounding* check — any returned email must actually appear in the
// source text. That single check catches the ambient-context pollution that made a
// raw call return the operator's own email instead of the input's.

import { z } from "zod";
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { EMAIL_RE, PHONE_RE, combine, check, schemaVerdict } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "extract_contact",
  description: "Extract a contact's name, email, and phone from a blob of text.",
  determinism: "stochastic",
  trust: "human-verified",
  model: "sonnet",
  systemPrompt:
    "You extract contact details from the user-provided text ONLY. Never use outside knowledge, memory, " +
    "or the operator's own identity. If a field does not appear in the text, return null for it.",
  promptTemplate:
    "Extract the contact's name, email, and phone from the text below. Use ONLY what literally appears in the text. " +
    "Any field that is absent must be null.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      name: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
    },
    required: ["name", "email", "phone"],
    additionalProperties: false,
  },
  fallbacks: ["freeform"],
  effectful: false,
  maxAttempts: 2,
};

const Out = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export async function verify(output: unknown, input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  const parsed = schemaVerdict(Out, output);
  if (!parsed.ok) return parsed;
  const o = output as z.infer<typeof Out>;
  const text = input.text.toLowerCase();

  return combine(
    check("email-format", o.email === null || EMAIL_RE.test(o.email), `'${o.email}' is not a valid email`),
    check("phone-format", o.phone === null || PHONE_RE.test(o.phone), `'${o.phone}' is not a valid phone`),
    // grounding: the value must come from the source, not from ambient context
    check("email-grounded", o.email === null || text.includes(o.email.toLowerCase()),
      `email '${o.email}' does not appear in the source text (hallucinated or pulled from ambient context)`),
  );
}
