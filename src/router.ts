// router.ts — pick a command for a goal, weighted by MEASURED reliability.
//
// Routing is the new bottleneck once the loop is reliable, so we constrain it:
// the model picks from an enumerated list (not free text), and each candidate is
// annotated with its empirical success rate from telemetry. When several commands
// could fit, the router is told to prefer the more reliable one.

import type { CommandModule } from "./types.js";
import { callClaude } from "./cc.js";
import { scores } from "./telemetry.js";

export async function route(
  goal: string,
  registry: Map<string, CommandModule>,
  opts: { telemetryFile?: string } = {},
): Promise<string | null> {
  const sc = opts.telemetryFile ? scores(opts.telemetryFile) : {};
  const candidates = [...registry.values()].map((c) => {
    const s = sc[c.manifest.name];
    return { name: c.manifest.name, description: c.manifest.description, rate: s?.rate, runs: s?.runs ?? 0 };
  });
  if (candidates.length === 0) return "freeform";
  if (candidates.length === 1) return candidates[0].name;

  const enumNames = [...candidates.map((c) => c.name), "freeform"];
  const lines = candidates.map((c) => {
    const rel = c.runs > 0 ? ` (reliability ${(c.rate! * 100).toFixed(0)}% over ${c.runs} runs)` : " (no telemetry yet)";
    return `- ${c.name}: ${c.description}${rel}`;
  });

  const r = await callClaude<{ command: string; reason: string }>({
    systemPrompt:
      "You are a router. Choose the single best command for the goal. When MULTIPLE commands could fit, " +
      "prefer the one with higher measured reliability. Choose 'freeform' only if none clearly fits. " +
      "Pick ONLY from the enumerated names. Use no outside knowledge.",
    prompt: `GOAL: ${goal}\n\nCOMMANDS (with measured reliability):\n${lines.join("\n")}`,
    jsonSchema: {
      type: "object",
      properties: { command: { type: "string", enum: enumNames }, reason: { type: "string" } },
      required: ["command", "reason"],
      additionalProperties: false,
    },
    model: "haiku",
  });
  return r.structured?.command ?? null;
}
