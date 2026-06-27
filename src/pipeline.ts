// pipeline.ts — the composition primitive.
// Deterministic sequencing of verified commands: each step's output is verified
// (inside solve) before the next step runs, so errors can't silently compound.
// This is the "deterministic skeleton + LLM-filled, verified nodes" pattern.

import type { CommandModule } from "./types.js";
import { solve } from "./solve.js";

export interface Step {
  command: string;
  /** Build this command's input from the accumulated state. */
  input: (state: Record<string, any>) => any;
  /** Key to store this step's output under (default: the command name). */
  as?: string;
  /** If true, a failed step stores null and the pipeline continues instead of aborting. */
  optional?: boolean;
}

export interface PipelineResult {
  ok: boolean;
  state: Record<string, any>;
  steps: { command: string; ok: boolean; via: string; attempts: number; costUsd: number }[];
  costUsd: number;
  failedAt?: string;
}

export async function runPipeline(
  registry: Map<string, CommandModule>,
  steps: Step[],
  initial: Record<string, any>,
  opts: { telemetryFile?: string; cwd?: string } = {},
): Promise<PipelineResult> {
  const state = { ...initial };
  const trace: PipelineResult["steps"] = [];
  let cost = 0;

  for (const step of steps) {
    const res = await solve(
      { registry, command: step.command, goal: step.command, telemetryFile: opts.telemetryFile, cwd: opts.cwd },
      step.input(state),
    );
    cost += res.costUsd;
    trace.push({ command: step.command, ok: res.ok, via: res.command, attempts: res.attempts, costUsd: res.costUsd });
    if (!res.ok && !step.optional) {
      return { ok: false, state, steps: trace, costUsd: cost, failedAt: step.command };
    }
    state[step.as ?? step.command] = res.ok ? res.output : null;
  }
  return { ok: true, state, steps: trace, costUsd: cost };
}
