// scores.ts — print the reliability scoreboard from accumulated telemetry.
// This is what the router consults; running it shows the data flywheel working.
//   npx tsx src/scores.ts   (or: npm run scores)

import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { scores } from "./telemetry.js";

const root = resolve(import.meta.dirname, "..");
const projDir = resolve(root, "projects");
const files = existsSync(projDir)
  ? readdirSync(projDir).map((d) => resolve(projDir, d, "telemetry.jsonl")).filter(existsSync)
  : [];

const merged: Record<string, { runs: number; ok: number; cost: number }> = {};
for (const f of files) {
  for (const [name, v] of Object.entries(scores(f))) {
    const m = (merged[name] ??= { runs: 0, ok: 0, cost: 0 });
    m.runs += v.runs;
    m.ok += v.ok;
    m.cost += v.avgCostUsd * v.runs;
  }
}

const rows = Object.entries(merged)
  .map(([name, m]) => ({ name, runs: m.runs, rate: m.ok / m.runs, avgCost: m.cost / m.runs }))
  .sort((a, b) => b.rate - a.rate || b.runs - a.runs);

if (rows.length === 0) {
  console.log("No telemetry yet. Run some commands or `npx tsx eval/run-tests.ts` first.");
  process.exit(0);
}

console.log(`reliability scoreboard (${files.length} telemetry file(s))\n`);
console.log("command".padEnd(20) + "runs".padStart(6) + "reliability".padStart(14) + "avg cost".padStart(12));
console.log("-".repeat(52));
for (const r of rows) {
  console.log(
    r.name.padEnd(20) +
      String(r.runs).padStart(6) +
      `${(r.rate * 100).toFixed(0)}%`.padStart(14) +
      `$${r.avgCost.toFixed(4)}`.padStart(12),
  );
}
