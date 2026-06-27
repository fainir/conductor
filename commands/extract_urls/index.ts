// extract_urls - a PURE command. Scans the input text for http(s) URLs, dedupes
// them while preserving first-seen order, and returns the list. The verifier
// RECOMPUTES the extraction is well-formed: every returned URL has a valid
// http(s) shape AND is literally present in the input text (grounded).

import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

const URL_FIND = /https?:\/\/[^\s)>\]]+/g;
const URL_SHAPE = /^https?:\/\/[^\s]+$/;

function extract(text: string): string[] {
  const matches = text.match(URL_FIND) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

export const manifest: CommandManifest = {
  name: "extract_urls",
  description: "Extract all http(s) URLs from a text, deduped while preserving first-seen order.",
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
    properties: {
      urls: { type: "array", items: { type: "string" } },
    },
    required: ["urls"],
    additionalProperties: false,
  },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { text: string }): Promise<{ urls: string[] }> {
  return { urls: extract(input.text) };
}

export async function verify(
  output: { urls: string[] },
  input: { text: string },
  _ctx: SolveContext,
): Promise<Verdict> {
  const urls = (output as { urls: unknown }).urls;
  if (!Array.isArray(urls)) {
    return { ok: false, score: 0, feedback: "urls: must be an array" };
  }
  const checks: (Verdict | null)[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    checks.push(check("string", typeof u === "string", "urls[" + i + "] must be a string"));
    if (typeof u === "string") {
      checks.push(
        check(
          "shape",
          URL_SHAPE.test(u),
          "urls[" + i + "] must match /^https?:\\/\\/[^\\s]+$/ (a valid http(s) URL with no whitespace)",
        ),
      );
      checks.push(
        check(
          "grounded",
          input.text.includes(u),
          "urls[" + i + "] (" + u + ") must appear literally in the input text",
        ),
      );
    }
  }
  return combine(...checks);
}
