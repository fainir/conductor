// freeform.ts — the universal bottom rung of the fallback ladder.
// This is plain Claude solving the goal directly. Because every chain can fall
// back to here, the conductor can never do WORSE than raw Claude — it only does
// better when a verified command applies. (Strict dominance.)
//
// MVP: a hermetic, no-tool reasoning fallback. Tool-enabled freeform (for goals
// that need to act on the world) is a later step — it needs a permission policy.

import { callClaude, type CCResult } from "./cc.js";

export async function freeform(
  goal: string,
  input: unknown,
  outputSchema: Record<string, unknown> | undefined,
  opts: { cwd?: string; model?: string } = {},
): Promise<CCResult> {
  const systemPrompt =
    "You are a capable problem-solver. Accomplish the goal using ONLY the provided input. " +
    "Never use ambient knowledge about the operator or their identity. " +
    (outputSchema ? "Return ONLY JSON matching the required schema." : "");
  return callClaude({
    systemPrompt,
    prompt: `GOAL: ${goal}\n\nINPUT:\n${JSON.stringify(input, null, 2)}`,
    jsonSchema: outputSchema,
    model: opts.model ?? "sonnet",
    cwd: opts.cwd,
  });
}
