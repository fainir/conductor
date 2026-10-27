import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { check, combine, schemaVerdict, llmJudge, EMAIL_RE, PHONE_RE, EMAIL_FIND, PHONE_FIND } from "../src/verify.js";
import { installFakeClaude, structured, flag } from "./helpers/fake-claude.js";

const fake = installFakeClaude();
after(() => fake.uninstall());
beforeEach(() => fake.reset());

test("check: null when the predicate holds, a failing verdict with prefixed feedback otherwise", () => {
  assert.equal(check("len", true, "too long"), null);
  assert.deepEqual(check("len", false, "too long"), { ok: false, score: 0, feedback: "len: too long" });
});

test("combine: the first failing check wins; all-null is ok", () => {
  assert.deepEqual(combine(null, null), { ok: true, score: 1 });
  const v = combine(null, check("a", false, "first"), check("b", false, "second"));
  assert.equal(v.ok, false);
  assert.equal(v.feedback, "a: first");
});

test("schemaVerdict: reports each zod issue with its path", () => {
  const S = z.object({ name: z.string(), tags: z.array(z.string()) });
  assert.deepEqual(schemaVerdict(S, { name: "x", tags: [] }), { ok: true, score: 1 });
  const v = schemaVerdict(S, { name: 1, tags: ["a", 2] });
  assert.equal(v.ok, false);
  assert.match(v.feedback ?? "", /^schema: /);
  assert.match(v.feedback ?? "", /name: /);
  assert.match(v.feedback ?? "", /tags\.1: /);
});

test("EMAIL_RE / PHONE_RE accept well-formed values and reject junk", () => {
  assert.ok(EMAIL_RE.test("sam.park@acme.io"));
  assert.ok(!EMAIL_RE.test("sam at acme.io"));
  assert.ok(!EMAIL_RE.test("sam@acme"));
  assert.ok(PHONE_RE.test("+972 50 123 4567"));
  assert.ok(!PHONE_RE.test("call me"));
  assert.ok(!PHONE_RE.test("12345"));
});

test("EMAIL_FIND / PHONE_FIND detect PII anywhere in a string", () => {
  assert.ok(EMAIL_FIND.test("write to jane@example.com today"));
  assert.ok(PHONE_FIND.test("call 555-123-4567 now"));
  assert.ok(!EMAIL_FIND.test("write to [REDACTED] today"));
  assert.ok(!PHONE_FIND.test("call [REDACTED] now"));
});

test("llmJudge: maps the judge's pass/reason onto a verdict and runs on haiku with no tools", async () => {
  fake.queue(structured({ pass: false, reason: "mentions a fact not in the source" }));
  const v = await llmJudge({ criteria: "only facts from the source", output: { summary: "x" } });
  assert.deepEqual(v, { ok: false, score: 0, reason: "mentions a fact not in the source", feedback: "mentions a fact not in the source" });
  const [call] = fake.calls();
  assert.equal(flag(call, "--model"), "haiku");
  assert.equal(flag(call, "--tools"), "");

  fake.queue(structured({ pass: true, reason: "fine" }));
  const ok = await llmJudge({ criteria: "c", output: 1 });
  assert.equal(ok.ok, true);
  assert.equal(ok.feedback, undefined);
});

test("llmJudge: a failed judge call is a failing verdict, never a pass", async () => {
  fake.queue({ envelope: { is_error: true, result: "overloaded", total_cost_usd: 0 } });
  const v = await llmJudge({ criteria: "c", output: 1 });
  assert.equal(v.ok, false);
  assert.match(v.feedback ?? "", /^judge call failed/);
});
