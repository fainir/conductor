// run-eval.ts — THE NUMBER.
// Runs each task two ways and reports the reliability delta:
//   baseline  = a single naive call (default system prompt, no schema, no verify/retry)
//   conductor = full solve() (hermetic + schema + mechanical verify + retry + fallback)
//
//   REPEATS=3 npx tsx eval/run-eval.ts

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCommands } from "../src/registry.js";
import { solve } from "../src/solve.js";
import { tryParseJson } from "../src/cc.js";

interface Task { input: { text: string }; expect: { name: string; email: string } }

const root = resolve(import.meta.dirname, "..");
const tasks = JSON.parse(readFileSync(resolve(root, "eval/tasks/contacts.json"), "utf8")) as Task[];
const registry = await loadCommands(resolve(root, "commands"));
const REPEATS = Number(process.env.REPEATS ?? 2);

// "naive use of Claude": default system prompt (the pollution source), no schema, parse JSON from prose.
// Kept hermetic on settings only, so the operator's own hooks don't hang the eval.
function naive(text: string): Promise<{ email: unknown; cost: number }> {
  return new Promise((res) => {
    const child = spawn(
      "claude",
      [
        "-p",
        `Extract the contact's name and email from this text and reply with JSON {"name":..,"email":..}: ${text}`,
        "--output-format", "json",
        "--tools", "",
        "--setting-sources", "",
        "--no-session-persistence",
        "--model", "sonnet",
      ],
      { env: process.env },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", () => {
      try {
        const env = JSON.parse(out);
        const parsed = tryParseJson(env.result) as any;
        res({ email: parsed?.email, cost: env.total_cost_usd ?? 0 });
      } catch {
        res({ email: undefined, cost: 0 });
      }
    });
    child.on("error", () => res({ email: undefined, cost: 0 }));
  });
}

const emailMatch = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

let n = 0, bOk = 0, cOk = 0, bCost = 0, cCost = 0;

for (let r = 0; r < REPEATS; r++) {
  for (const t of tasks) {
    n++;
    const b = await naive(t.input.text);
    const bHit = emailMatch(b.email, t.expect.email);
    bOk += bHit ? 1 : 0;
    bCost += b.cost;

    const c = await solve(
      { registry, command: "extract_contact", goal: "extract contact", telemetryFile: resolve(root, "projects/eval/telemetry.jsonl"), cwd: root },
      t.input,
    );
    const cHit = c.ok && emailMatch(c.output?.email, t.expect.email);
    cOk += cHit ? 1 : 0;
    cCost += c.costUsd;

    console.log(
      `[${String(n).padStart(2)}] baseline=${bHit ? "OK" : "XX"} (${b.email ?? "-"})  ` +
      `conductor=${cHit ? "OK" : "XX"} (${c.output?.email ?? "-"}) via=${c.command}${c.attempts > 1 ? ` x${c.attempts}` : ""}`,
    );
  }
}

const pct = (x: number) => `${((100 * x) / n).toFixed(0)}%`;
console.log(`\n=== RESULTS over ${n} runs (${tasks.length} tasks x ${REPEATS}) ===`);
console.log(`baseline (naive call)   success=${pct(bOk)}   cost=$${bCost.toFixed(4)}`);
console.log(`conductor               success=${pct(cOk)}   cost=$${cCost.toFixed(4)}`);
console.log(`reliability delta       ${cOk - bOk >= 0 ? "+" : ""}${(((cOk - bOk) * 100) / n).toFixed(0)} points`);
