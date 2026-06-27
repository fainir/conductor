// registry.ts — loads commands from the commands/ directory.
// ENFORCES the core invariant: a command with no verifier cannot be registered.
// This single rule is what separates this from "a pile of skills".

import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CommandModule } from "./types.js";

export async function loadCommands(dir: string): Promise<Map<string, CommandModule>> {
  const map = new Map<string, CommandModule>();
  if (!existsSync(dir)) return map;

  for (const name of readdirSync(dir)) {
    const cmdDir = join(dir, name);
    if (!statSync(cmdDir).isDirectory()) continue;
    const index = join(cmdDir, "index.ts");
    if (!existsSync(index)) continue;

    const mod = await import(pathToFileURL(index).href);
    const { manifest, verify, run } = mod;

    if (!manifest) throw new Error(`Command '${name}': missing 'manifest' export.`);
    if (manifest.name !== name) throw new Error(`Command '${name}': manifest.name '${manifest.name}' must equal the directory name.`);
    if (typeof verify !== "function") {
      throw new Error(`Command '${name}': MANDATORY 'verify' export missing. A command cannot be registered without a verifier.`);
    }
    map.set(name, { manifest, verify, run });
  }
  return map;
}
