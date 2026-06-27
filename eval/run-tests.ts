// run-tests.ts — runs every command against its tests/cases.json through the full
// solve() loop (so the verifier, retries, and fallback all participate).
//   npx tsx eval/run-tests.ts            # all commands
//   npx tsx eval/run-tests.ts slugify    # one command
//
// A case passes if solve() succeeds (verifier ok) AND, when an "expect" is given,
// the output matches it exactly. Pure commands carry exact expects; stochastic
// commands usually rely on the verifier alone.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadCommands } from "../src/registry.js";
import { solve } from "../src/solve.js";

interface Case { input: any; expect?: any }

const root = resolve(import.meta.dirname, "..");
const registry = await loadCommands(resolve(root, "commands"));
const telemetry = resolve(root, "projects/tests/telemetry.jsonl");
const filter = process.argv[2];

let totalPass = 0;
let totalFail = 0;

for (const [name] of registry) {
  if (filter && name !== filter) continue;
  const casesFile = resolve(root, "commands", name, "tests/cases.json");
  if (!existsSync(casesFile)) {
    console.log(`-- ${name}: no tests`);
    continue;
  }
  let cases: Case[];
  try {
    cases = JSON.parse(readFileSync(casesFile, "utf8"));
  } catch {
    console.log(`XX ${name}: invalid cases.json`);
    totalFail++;
    continue;
  }

  let pass = 0;
  for (const [i, c] of cases.entries()) {
    const res = await solve({ registry, command: name, goal: name, telemetryFile: telemetry, cwd: root }, c.input);
    let ok = res.ok;
    let why = res.verdict?.feedback ?? "";
    if (ok && c.expect !== undefined && JSON.stringify(res.output) !== JSON.stringify(c.expect)) {
      ok = false;
      why = `expected ${JSON.stringify(c.expect)} got ${JSON.stringify(res.output)}`;
    }
    if (ok) pass++;
    else console.log(`   X ${name}[${i}] via=${res.command}: ${why}`);
  }
  totalPass += pass;
  totalFail += cases.length - pass;
  console.log(`${pass === cases.length ? "OK" : "XX"} ${name}: ${pass}/${cases.length}`);
}

console.log(`\nTOTAL: ${totalPass} passed, ${totalFail} failed`);
process.exit(totalFail > 0 ? 1 : 0);
