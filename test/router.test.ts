// Telemetry scoring and reliability-weighted routing.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { library } from "../src/library.js";
import { route } from "../src/router.js";
import { logEntry, scores, type TelemetryEntry } from "../src/telemetry.js";
import { installFakeClaude, structured, promptOf, flag } from "./helpers/fake-claude.js";

const fake = installFakeClaude();
after(() => fake.uninstall());
beforeEach(() => fake.reset());

const dir = mkdtempSync(join(tmpdir(), "conductor-router-"));
const entry = (command: string, ok: boolean, costUsd = 0): TelemetryEntry => ({
  ts: "2026-01-01T00:00:00.000Z", command, ok, attempts: 1, costUsd, latencyMs: 1, depth: 0,
});

test("logEntry creates parent directories and appends one JSON line per entry", () => {
  const file = join(dir, "nested/deeper/telemetry.jsonl");
  logEntry(file, entry("slugify", true));
  logEntry(file, entry("slugify", false));
  assert.ok(existsSync(file));
  assert.equal(scores(file).slugify.runs, 2);
});

test("scores: per-command runs, successes, rate and average cost; malformed lines are skipped", () => {
  const file = join(dir, "scores.jsonl");
  writeFileSync(
    file,
    [entry("summarize", true, 0.01), entry("summarize", false, 0.03), entry("summarize", true, 0.02), entry("slugify", true)]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n{not json\n\n",
  );
  const s = scores(file);
  assert.deepEqual(Object.keys(s).sort(), ["slugify", "summarize"]);
  assert.equal(s.summarize.runs, 3);
  assert.equal(s.summarize.ok, 2);
  assert.equal(s.summarize.rate, 2 / 3);
  assert.ok(Math.abs(s.summarize.avgCostUsd - 0.02) < 1e-12);
  assert.deepEqual(s.slugify, { runs: 1, ok: 1, rate: 1, avgCostUsd: 0 });
});

test("scores: a missing file means no telemetry yet", () => {
  assert.deepEqual(scores(join(dir, "missing.jsonl")), {});
});

test("route: the router sees each command's measured reliability and picks from an enum", async () => {
  const file = join(dir, "route.jsonl");
  for (const ok of [true, false]) logEntry(file, entry("slugify", ok));
  fake.queue(structured({ command: "slugify", reason: "makes slugs" }));

  const registry = library();
  const picked = await route("make a url slug", registry, { telemetryFile: file });
  assert.equal(picked, "slugify");

  const [call] = fake.calls();
  assert.equal(flag(call, "--model"), "haiku");
  const prompt = promptOf(call);
  assert.match(prompt, /^GOAL: make a url slug/);
  assert.match(prompt, /- slugify: Convert a string into a URL-safe slug\. \(reliability 50% over 2 runs\)/);
  assert.match(prompt, /- summarize: .*\(no telemetry yet\)/);
  const schema = JSON.parse(flag(call, "--json-schema")!);
  assert.deepEqual(schema.properties.command.enum, [...registry.keys(), "freeform"]);
});

test("route: trivial registries need no model call", async () => {
  assert.equal(await route("anything", new Map()), "freeform");
  const one = new Map([["slugify", library().get("slugify")!]]);
  assert.equal(await route("anything", one), "slugify");
  assert.equal(fake.calls().length, 0);
});

test("route: a failed router call returns null", async () => {
  fake.queue({ envelope: { is_error: true, result: "down", total_cost_usd: 0 } });
  assert.equal(await route("x", library()), null);
});
