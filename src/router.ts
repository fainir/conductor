// router.ts — pick a command for a goal.
// MVP: structured pick from the enumerated command list (constrained decision,
// not free text). The next phase weights this by reliability scores from telemetry.

import type { CommandModule } from "./types.js";
import { callClaude } from "./cc.js";

export async function route(goal: string, registry: Map<string, CommandModule>): Promise<string | null> {
  const candidates = [...registry.values()].map((c) => ({ name: c.manifest.name, description: c.manifest.description }));
  if (candidates.length === 0) return "freeform";
  if (candidates.length === 1) return candidates[0].name;

  const enumNames = [...candidates.map((c) => c.name), "freeform"];
  const r = await callClaude<{ command: string; reason: string }>({
    systemPrompt:
      "You are a router. Choose the single best command for the goal, or 'freeform' if none clearly fits. " +
      "Choose ONLY from the enumerated names. Use no outside knowledge.",
    prompt: `GOAL: ${goal}\n\nCOMMANDS:\n${candidates.map((c) => `- ${c.name}: ${c.description}`).join("\n")}`,
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
