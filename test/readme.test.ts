// The README's tool tables are checked against the code, so they cannot drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { library } from "../src/library.js";
import type { CommandModule } from "../src/types.js";

const readme = readFileSync(resolve(import.meta.dirname, "..", "README.md"), "utf8");
const registry = library();

/** "text, max_sentences?" - required properties bare, optional ones with "?". */
function signature(c: CommandModule): string {
  const s = c.manifest.inputSchema as { properties: Record<string, unknown>; required?: string[] };
  return Object.keys(s.properties).map((k) => (s.required?.includes(k) ? k : `${k}?`)).join(", ");
}

test("README: the tool tables list exactly the registered commands", () => {
  const names = [...readme.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual([...names].sort(), [...registry.keys()].sort());
});

test("README: each tool row shows the command's real input and description", () => {
  for (const [name, c] of registry) {
    const expected = `| \`${name}\` | \`${signature(c)}\` | ${c.manifest.description} |`;
    assert.ok(readme.includes(expected), `the README row for ${name} must start with:\n${expected}`);
  }
});

test("README: pure and model-backed tools are in their own tables", () => {
  const modelSection = readme.indexOf("### Model-backed tools");
  assert.ok(modelSection > 0);
  for (const [name, c] of registry) {
    const at = readme.indexOf(`| \`${name}\` |`);
    assert.equal(at > modelSection, c.manifest.determinism === "stochastic", name);
  }
});
