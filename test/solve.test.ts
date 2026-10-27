// The reliable loop (execute -> verify -> retry-with-feedback -> fallback) and
// pipeline composition, driven against the fake claude CLI.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { library } from "../src/library.js";
import { solve } from "../src/solve.js";
import { runPipeline } from "../src/pipeline.js";
import { installFakeClaude, structured, promptOf, flag } from "./helpers/fake-claude.js";

const fake = installFakeClaude();
after(() => fake.uninstall());
beforeEach(() => fake.reset());

const registry = library();
const summarizeInput = { text: "The wing opened in spring. It holds rare manuscripts. Visits are supervised.", max_sentences: 1 };
const goodSummary = { summary: "A wing of rare manuscripts opened in spring." };
const tooLong = { summary: "A wing opened. It has manuscripts. Visits are supervised." };

function telemetry(): string {
  return join(mkdtempSync(join(tmpdir(), "conductor-telemetry-")), "telemetry.jsonl");
}
function entries(file: string): any[] {
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

test("pure command: runs in code, costs nothing, logs one telemetry entry", async () => {
  const file = telemetry();
  const res = await solve({ registry, command: "slugify", telemetryFile: file }, { text: "Hello, World!" });
  assert.deepEqual(res.output, { slug: "hello-world" });
  assert.equal(res.ok, true);
  assert.equal(res.command, "slugify");
  assert.equal(res.attempts, 1);
  assert.equal(res.costUsd, 0);
  assert.equal(fake.calls().length, 0);
  const log = entries(file);
  assert.equal(log.length, 1);
  assert.equal(log[0].command, "slugify");
  assert.equal(log[0].ok, true);
});

test("stochastic command: one hermetic call constrained by the command's own prompt and schema", async () => {
  fake.queue(structured(goodSummary, 0.002));
  const res = await solve({ registry, command: "summarize" }, summarizeInput);
  assert.equal(res.ok, true);
  assert.deepEqual(res.output, goodSummary);
  assert.equal(res.attempts, 1);
  assert.equal(res.costUsd, 0.002);

  const [call] = fake.calls();
  const m = registry.get("summarize")!.manifest;
  assert.equal(flag(call, "--system-prompt"), m.systemPrompt);
  assert.equal(flag(call, "--json-schema"), JSON.stringify(m.outputSchema));
  assert.equal(flag(call, "--model"), "sonnet");
  assert.equal(flag(call, "--tools"), "");
  assert.ok(promptOf(call).startsWith(m.promptTemplate!));
  assert.ok(promptOf(call).includes(JSON.stringify(summarizeInput, null, 2)));
});

test("a failed verification is retried with the verifier's feedback in the prompt", async () => {
  const file = telemetry();
  fake.queue(structured(tooLong), structured(goodSummary));
  const res = await solve({ registry, command: "summarize", telemetryFile: file }, summarizeInput);
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  const calls = fake.calls();
  assert.equal(calls.length, 2);
  assert.ok(!promptOf(calls[0]).includes("FAILED VERIFICATION"));
  assert.match(promptOf(calls[1]), /YOUR PREVIOUS ANSWER FAILED VERIFICATION:\nsentence-budget: summary has 3 sentence\(s\) but the limit is 1/);
  assert.deepEqual(entries(file).map((e) => [e.command, e.ok, e.attempts]), [["summarize", false, 1], ["summarize", true, 2]]);
});

test("after maxAttempts the ladder falls back to freeform, whose output must still pass the verifier", async () => {
  fake.queue(structured(tooLong), structured(tooLong), structured(goodSummary));
  const res = await solve({ registry, command: "summarize" }, summarizeInput);
  assert.equal(res.ok, true);
  assert.equal(res.command, "freeform");
  assert.equal(res.fellBackTo, "summarize");
  const calls = fake.calls();
  assert.equal(calls.length, 3);
  assert.match(flag(calls[2], "--system-prompt") ?? "", /capable problem-solver/);
  assert.equal(flag(calls[2], "--json-schema"), JSON.stringify(registry.get("summarize")!.manifest.outputSchema));
});

test("freeform output that fails the contract is reported as a failure, not passed through", async () => {
  fake.queue(structured(tooLong), structured(tooLong), structured(tooLong));
  const res = await solve({ registry, command: "summarize" }, summarizeInput);
  assert.equal(res.ok, false);
  assert.equal(res.command, "freeform");
  assert.match(res.verdict.feedback ?? "", /sentence-budget/);
});

test("a model call that errors counts as 'no output produced' and is retried", async () => {
  fake.queue({ envelope: { is_error: true, result: "overloaded", total_cost_usd: 0 } }, structured(goodSummary));
  const res = await solve({ registry, command: "summarize" }, summarizeInput);
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.match(promptOf(fake.calls()[1]), /no output produced/);
});

test("an unknown command throws", async () => {
  await assert.rejects(solve({ registry, command: "nope" }, {}), /Unknown command: nope/);
});

test("runPipeline threads each verified output into the next step's input", async () => {
  const r = await runPipeline(
    registry,
    [
      { command: "slugify", input: (s) => ({ text: s.title }), as: "slug" },
      { command: "truncate", input: (s) => ({ text: s.slug.slug, max: 8 }), as: "short" },
    ],
    { title: "Reliable Verified Tool Calls" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.state.slug.slug, "reliable-verified-tool-calls");
  assert.equal(r.state.short.text, "reliabl…");
  assert.deepEqual(r.steps.map((s) => [s.command, s.ok, s.via]), [["slugify", true, "slugify"], ["truncate", true, "truncate"]]);
  assert.equal(r.costUsd, 0);
});

test("runPipeline stops at a failed required step, and stores null for a failed optional one", async () => {
  const optional = await runPipeline(
    registry,
    [
      { command: "normalize_phone", input: () => ({ phone: "n/a" }), as: "phone", optional: true },
      { command: "slugify", input: () => ({ text: "Still Runs" }), as: "slug" },
    ],
    {},
  );
  assert.equal(optional.ok, true);
  assert.equal(optional.state.phone, null);
  assert.equal(optional.state.slug.slug, "still-runs");

  const required = await runPipeline(
    registry,
    [
      { command: "normalize_phone", input: () => ({ phone: "n/a" }), as: "phone" },
      { command: "slugify", input: () => ({ text: "Never Runs" }), as: "slug" },
    ],
    {},
  );
  assert.equal(required.ok, false);
  assert.equal(required.failedAt, "normalize_phone");
  assert.equal(required.state.slug, undefined);
});
