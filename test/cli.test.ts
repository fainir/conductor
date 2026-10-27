// The manual driver's argument handling. Only paths that exit before solve() are
// exercised, so no telemetry is written into the repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tsx = resolve(root, "node_modules/tsx/dist/cli.mjs");
const cli = (...args: string[]) => spawnSync(process.execPath, [tsx, "src/cli.ts", ...args], { cwd: root, encoding: "utf8" });

test("cli with no arguments lists the commands and usage", () => {
  const r = cli();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Commands: .*slugify/m);
  assert.match(r.stdout, /Usage: /);
});

test("cli rejects input that is not JSON with a readable message", () => {
  const r = cli("slugify", "{text: hello}");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: input must be a JSON object/m);
  assert.doesNotMatch(r.stderr, /at JSON\.parse/);
});

test("cli rejects an unknown command and lists the known ones", () => {
  const r = cli("slugifyy", '{"text":"x"}');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^error: unknown command 'slugifyy'\. Commands: .*slugify/m);
});
