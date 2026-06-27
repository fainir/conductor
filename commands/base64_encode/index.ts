// base64_encode - a PURE command. Verifier round-trips (decode must equal input).
import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
import { check, combine } from "../../src/verify.js";

export const manifest: CommandManifest = {
  name: "base64_encode",
  description: "Encode a UTF-8 string to base64.",
  determinism: "pure",
  trust: "human-verified",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  outputSchema: { type: "object", properties: { encoded: { type: "string" } }, required: ["encoded"], additionalProperties: false },
  fallbacks: [],
  effectful: false,
};

export async function run(input: { text: string }): Promise<{ encoded: string }> {
  return { encoded: Buffer.from(input.text, "utf8").toString("base64") };
}

export async function verify(output: { encoded: string }, input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
  return combine(
    check("string", typeof output?.encoded === "string", "encoded must be a string"),
    check("round-trip", Buffer.from(output?.encoded ?? "", "base64").toString("utf8") === input.text, "encoded does not decode back to the input"),
  );
}
