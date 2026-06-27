// telemetry.ts — every solve node is logged here, in code, so it can't be skipped.
// This is the substrate for reliability-aware routing (next phase) and RL reward (later).

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface TelemetryEntry {
  ts: string;
  command: string;
  ok: boolean;
  attempts: number;
  fellBackTo?: string;
  costUsd: number;
  latencyMs: number;
  depth: number;
  verdict?: { ok: boolean; score?: number; reason?: string; feedback?: string };
}

export function logEntry(file: string, entry: TelemetryEntry): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + "\n");
}

export interface CommandScore { runs: number; ok: number; rate: number; avgCostUsd: number }

/** Rolling per-command reliability from the telemetry log. The router will consume this. */
export function scores(file: string): Record<string, CommandScore> {
  if (!existsSync(file)) return {};
  const agg: Record<string, { runs: number; ok: number; cost: number }> = {};
  for (const line of readFileSync(file, "utf8").trim().split("\n").filter(Boolean)) {
    try {
      const e = JSON.parse(line) as TelemetryEntry;
      const a = (agg[e.command] ??= { runs: 0, ok: 0, cost: 0 });
      a.runs++;
      if (e.ok) a.ok++;
      a.cost += e.costUsd;
    } catch { /* skip malformed line */ }
  }
  const out: Record<string, CommandScore> = {};
  for (const [k, v] of Object.entries(agg)) {
    out[k] = { runs: v.runs, ok: v.ok, rate: v.ok / v.runs, avgCostUsd: v.cost / v.runs };
  }
  return out;
}
