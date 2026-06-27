// slugify — a PURE command (deterministic body, no model, cacheable).
// Shows the other end of the gradient: no LLM, so it's 100% reliable and free.
// Its verifier is a trivial mechanical check.

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "slugify",
  description: "Convert a string into a URL-safe slug.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { slug: { type: "string" } },
    required: ["slug"],
    additionalProperties: false,
  },
  fallbacks: [], // pure + deterministic: it cannot fail, so no fallback needed
  effectful: false,
};

export async function run(input: { text: string }): Promise<{ slug: string }> {
  const slug = input.text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return { slug };
}

export async function verify(output: { slug: string }, _input: unknown, _ctx: SolveContext): Promise<Verdict> {
  return combine(
    check("non-empty", typeof output?.slug === "string" && output.slug.length > 0, "slug must be a non-empty string"),
    check("url-safe", /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(output?.slug ?? ""), `slug '${output?.slug}' has invalid characters`),
  );
}
