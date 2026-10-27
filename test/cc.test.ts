import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ccArgs, callClaude, callClaudeRetry, tryParseJson } from "../src/cc.js";
import { installFakeClaude, structured, flag, promptOf } from "./helpers/fake-claude.js";

const fake = installFakeClaude();
after(() => fake.uninstall());
beforeEach(() => fake.reset());

test("ccArgs: hermetic defaults replace the system prompt and load no settings or tools", () => {
  const args = ccArgs({ prompt: "do it", systemPrompt: "you are a function" });
  assert.deepEqual(args, [
    "-p", "do it",
    "--output-format", "json",
    "--system-prompt", "you are a function",
    "--setting-sources", "",
    "--no-session-persistence",
    "--model", "sonnet",
    "--tools", "",
  ]);
});

test("ccArgs: optional flags are appended only when set", () => {
  const schema = { type: "object" };
  const args = ccArgs({
    prompt: "p", systemPrompt: "s", jsonSchema: schema, model: "haiku", tools: "Read",
    permissionMode: "plan", addDir: "/tmp/x", maxBudgetUsd: 0.5,
  });
  const call = { args, stdinClosed: true };
  assert.equal(flag(call, "--json-schema"), JSON.stringify(schema));
  assert.equal(flag(call, "--model"), "haiku");
  assert.equal(flag(call, "--tools"), "Read");
  assert.equal(flag(call, "--permission-mode"), "plan");
  assert.equal(flag(call, "--add-dir"), "/tmp/x");
  assert.equal(flag(call, "--max-budget-usd"), "0.5");
});

test("tryParseJson: plain, fenced, prose-wrapped and invalid text", () => {
  assert.deepEqual(tryParseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(tryParseJson('Here you go:\n```json\n{"a":[1,2]}\n```\nthanks'), { a: [1, 2] });
  assert.deepEqual(tryParseJson('The answer is {"ok": true} as requested.'), { ok: true });
  assert.deepEqual(tryParseJson("[1, 2, 3]"), [1, 2, 3]);
  assert.equal(tryParseJson(""), undefined);
  assert.equal(tryParseJson("no json here"), undefined);
  assert.equal(tryParseJson("{broken"), undefined);
});

test("callClaude: reads structured_output, cost and text from the envelope", async () => {
  fake.queue(structured({ name: "Sam" }, 0.0123));
  const r = await callClaude({ prompt: "extract", systemPrompt: "sys", jsonSchema: { type: "object" } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.structured, { name: "Sam" });
  assert.equal(r.costUsd, 0.0123);
  assert.equal(r.text, '{"name":"Sam"}');
  const [call] = fake.calls();
  assert.equal(promptOf(call), "extract");
  assert.equal(flag(call, "--system-prompt"), "sys");
});

test("callClaude: falls back to parsing JSON out of the result text when structured_output is absent", async () => {
  fake.queue({ envelope: { is_error: false, result: "```json\n{\"x\":2}\n```", total_cost_usd: 0 } });
  const r = await callClaude({ prompt: "p", systemPrompt: "s", jsonSchema: { type: "object" } });
  assert.deepEqual(r.structured, { x: 2 });
});

test("callClaude: an error envelope is not ok", async () => {
  fake.queue({ envelope: { is_error: true, result: "rate limited", total_cost_usd: 0 } });
  const r = await callClaude({ prompt: "p", systemPrompt: "s" });
  assert.equal(r.ok, false);
  assert.equal(r.isError, true);
});

test("callClaude: unparseable stdout is reported, not thrown", async () => {
  fake.queue({ raw: "this is not json", exitCode: 1 });
  const r = await callClaude({ prompt: "p", systemPrompt: "s" });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /unparseable envelope/);
});

test("callClaude: a hung process is killed after timeoutMs", async () => {
  fake.queue({ hangMs: 10_000 });
  const t0 = Date.now();
  const r = await callClaude({ prompt: "p", systemPrompt: "s", timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /timeout after 300ms/);
  assert.ok(Date.now() - t0 < 5000);
});

test("callClaudeRetry: retries when structured output is missing, then returns the good answer", async () => {
  fake.queue({ envelope: { is_error: false, result: "sorry, no json", total_cost_usd: 0 } }, structured({ ok: 1 }));
  const r = await callClaudeRetry({ prompt: "p", systemPrompt: "s", jsonSchema: { type: "object" } }, 1);
  assert.deepEqual(r.structured, { ok: 1 });
  assert.equal(fake.calls().length, 2);
});

// Regression: stdin was left as an open pipe. The real CLI waits up to 3s for
// piped stdin before it starts, so every model call stalled for 3 seconds.
test("callClaude: the child's stdin is closed so the CLI does not wait for piped input", async () => {
  fake.queue(structured({ a: 1 }));
  await callClaude({ prompt: "p", systemPrompt: "s" });
  assert.equal(fake.calls()[0].stdinClosed, true);
});

// Regression: chunks were decoded one by one, so a multi-byte character split
// across two stdout chunks came out as U+FFFD replacement characters.
test("callClaude: UTF-8 split across stdout chunks is decoded intact", async () => {
  const value = { translation: "שלום עולם, こんにちは" };
  const raw = JSON.stringify({ is_error: false, result: JSON.stringify(value), structured_output: value, total_cost_usd: 0 });
  const splitAt = Buffer.from(raw.slice(0, raw.indexOf("ש") + 1), "utf8").length - 1; // inside the first Hebrew letter
  fake.queue({ raw, splitAt });
  const r = await callClaude({ prompt: "p", systemPrompt: "s", jsonSchema: { type: "object" } });
  assert.equal(r.text, JSON.stringify(value));
  assert.deepEqual(r.structured, value);
});

test("callClaude: a missing claude binary gets an actionable error", async () => {
  const saved = process.env.PATH;
  process.env.PATH = mkdtempSync(join(tmpdir(), "conductor-empty-path-"));
  try {
    const r = await callClaude({ prompt: "p", systemPrompt: "s" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /`claude` CLI not found on PATH/);
  } finally {
    process.env.PATH = saved;
  }
});

test("callClaude: an error envelope carries its message in error", async () => {
  fake.queue({ envelope: { is_error: true, result: "Credit balance is too low", total_cost_usd: 0 } });
  const r = await callClaude({ prompt: "p", systemPrompt: "s" });
  assert.equal(r.error, "Credit balance is too low");
});
