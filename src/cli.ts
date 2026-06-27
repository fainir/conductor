// cli.ts — manual driver. Examples:
//   npx tsx src/cli.ts                                   # list commands
//   npx tsx src/cli.ts slugify '{"text":"Hello World!"}'
//   npx tsx src/cli.ts route "make a url slug" '{"text":"Hello World!"}'   # reliability-weighted routing

import { resolve } from "node:path";
import { loadCommands } from "./registry.js";
import { solve } from "./solve.js";
import { route } from "./router.js";

const root = resolve(import.meta.dirname, "..");
const registry = await loadCommands(resolve(root, "commands"));
const telemetryFile = resolve(root, "projects/default/telemetry.jsonl");

const [, , a, b, c] = process.argv;
if (!a) {
  console.log("Commands:", [...registry.keys()].join(", ") || "(none)");
  console.log('Usage: cli.ts <command> <inputJson>   |   cli.ts route "<goal>" <inputJson>');
  process.exit(0);
}

if (a === "route") {
  const goal = b ?? "";
  const input = c ? JSON.parse(c) : {};
  const picked = await route(goal, registry, { telemetryFile });
  console.error(`router picked: ${picked}`);
  if (!picked || picked === "freeform") {
    console.log("no matching command for that goal");
    process.exit(0);
  }
  const res = await solve({ registry, command: picked, goal, telemetryFile, cwd: root }, input);
  console.log(JSON.stringify(res, null, 2));
} else {
  const input = b ? JSON.parse(b) : {};
  const res = await solve({ registry, command: a, goal: `run ${a}`, telemetryFile, cwd: root }, input);
  console.log(JSON.stringify(res, null, 2));
}
