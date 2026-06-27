// cli.ts — manual driver. Examples:
//   npx tsx src/cli.ts                              # list commands
//   npx tsx src/cli.ts slugify '{"text":"Hello World!"}'
//   npx tsx src/cli.ts extract_contact '{"text":"Call Sam at sam@acme.io"}'

import { resolve } from "node:path";
import { loadCommands } from "./registry.js";
import { solve } from "./solve.js";

const root = resolve(import.meta.dirname, "..");
const registry = await loadCommands(resolve(root, "commands"));

const [, , cmdName, inputJson] = process.argv;
if (!cmdName) {
  console.log("Available commands:", [...registry.keys()].join(", ") || "(none)");
  process.exit(0);
}

const input = inputJson ? JSON.parse(inputJson) : {};
const res = await solve(
  { registry, command: cmdName, goal: `run ${cmdName}`, telemetryFile: resolve(root, "projects/default/telemetry.jsonl"), cwd: root },
  input,
);
console.log(JSON.stringify(res, null, 2));
