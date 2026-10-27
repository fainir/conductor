// cli.ts - manual driver. Examples:
//   npx tsx src/cli.ts                                   # list commands
//   npx tsx src/cli.ts slugify '{"text":"Hello World!"}'
//   npx tsx src/cli.ts route "make a url slug" '{"text":"Hello World!"}'   # reliability-weighted routing
// Exits 1 when the result fails verification.

import { resolve } from "node:path";
import { loadCommands } from "./registry.js";
import { solve } from "./solve.js";
import { route } from "./router.js";

const root = resolve(import.meta.dirname, "..");
const registry = await loadCommands(resolve(root, "commands"));
const telemetryFile = resolve(root, "projects/default/telemetry.jsonl");

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseInput(arg: string | undefined): unknown {
  if (arg === undefined) return {};
  try {
    return JSON.parse(arg);
  } catch (e: any) {
    fail(`input must be a JSON object, e.g. '{"text":"Hello World"}' (${e.message})`);
  }
}

const [, , a, b, c] = process.argv;
if (!a) {
  console.log("Commands:", [...registry.keys()].join(", ") || "(none)");
  console.log('Usage: cli.ts <command> <inputJson>   |   cli.ts route "<goal>" <inputJson>');
  process.exit(0);
}

if (a === "route") {
  const goal = b ?? "";
  const input = parseInput(c);
  const picked = await route(goal, registry, { telemetryFile });
  console.error(`router picked: ${picked}`);
  if (!picked || picked === "freeform") {
    console.log("no matching command for that goal");
    process.exit(0);
  }
  const res = await solve({ registry, command: picked, goal, telemetryFile, cwd: root }, input);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
} else {
  if (!registry.has(a)) fail(`unknown command '${a}'. Commands: ${[...registry.keys()].join(", ")}`);
  const input = parseInput(b);
  const res = await solve({ registry, command: a, goal: `run ${a}`, telemetryFile, cwd: root }, input);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}
