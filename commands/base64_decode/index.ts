// base64_decode - a PURE command. Verifier round-trips (re-encode must equal input, padding-normalized).
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "base64_decode",
  description: "Decode a base64 string to UTF-8 text.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: { type: "object", properties: { encoded: { type: "string" } }, required: ["encoded"], additionalProperties: false },
  outputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { encoded: string }): Promise<{ text: string }> {
  return { text: Buffer.from(input.encoded, "base64").toString("utf8") };
}

export async function verify(output: { text: string }, input: { encoded: string }, _ctx: SolveContext): Promise<Verdict> {
  const norm = (s: string) => s.replace(/=+$/, "");
  const reencoded = Buffer.from(output?.text ?? "", "utf8").toString("base64");
  return combine(
    check("string", typeof output?.text === "string", "text must be a string"),
    check("round-trip", norm(reencoded) === norm(input.encoded), "text does not re-encode to the input base64"),
  );
}
