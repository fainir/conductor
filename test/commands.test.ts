// Command contracts, pure command bodies, and every verifier - no model calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { library } from "../src/library.js";
import { loadCommands } from "../src/registry.js";
import type { CommandModule, SolveContext, Verdict } from "../src/types.js";
import { validate } from "../src/schema.js";

const root = resolve(import.meta.dirname, "..");
const commandsDir = resolve(root, "commands");
const registry = library();
const ctx: SolveContext = { goal: "test", depth: 0, trace: [] };

function cmd(name: string): CommandModule {
  const c = registry.get(name);
  assert.ok(c, `command '${name}' is not registered`);
  return c;
}

function cases(name: string): { input: any; expect?: any }[] {
  return JSON.parse(readFileSync(resolve(commandsDir, name, "tests/cases.json"), "utf8"));
}

const verify = (name: string, output: unknown, input: unknown): Promise<Verdict> => cmd(name).verify(output, input, ctx);
const run = (name: string, input: unknown): Promise<any> => cmd(name).run!(input, ctx);

// ---- contracts ---------------------------------------------------------------

test("library(): every commands/<name>/ directory is registered, and nothing else", async () => {
  const dirs = readdirSync(commandsDir).filter((d) => existsSync(resolve(commandsDir, d, "index.ts"))).sort();
  assert.deepEqual([...registry.keys()].sort(), dirs);
  const scanned = await loadCommands(commandsDir);
  assert.deepEqual([...scanned.keys()].sort(), dirs);
});

for (const [name, c] of registry) {
  test(`contract: ${name}`, () => {
    const m = c.manifest;
    assert.equal(m.name, name);
    assert.ok(m.description.trim().length > 0 && !m.description.includes("\n"), "description must be one non-empty line");
    assert.ok(["pure", "stochastic", "effectful"].includes(m.determinism));
    assert.equal(typeof c.verify, "function");
    assert.equal(m.effectful, m.determinism === "effectful");

    const input = m.inputSchema as { type: string; properties: Record<string, unknown>; required?: string[] };
    assert.equal(input.type, "object");
    for (const r of input.required ?? []) assert.ok(r in input.properties, `required '${r}' is not a declared property`);
    assert.equal((m.outputSchema as { type: string }).type, "object");

    for (const f of m.fallbacks) assert.ok(f === "freeform" || registry.has(f), `unknown fallback '${f}'`);

    if (m.determinism === "pure") {
      assert.equal(typeof c.run, "function", "a pure command needs a deterministic run()");
    } else {
      assert.equal(c.run, undefined, "a stochastic command is executed by the model, not run()");
      assert.ok(m.systemPrompt && m.promptTemplate, "a stochastic command needs its own systemPrompt and promptTemplate");
    }
    assert.ok(cases(name).length > 0, "every command ships tests/cases.json");
  });
}

// ---- pure commands: run() against the shipped cases ------------------------------

for (const [name, c] of registry) {
  if (c.manifest.determinism !== "pure") continue;
  test(`pure cases: ${name}`, async () => {
    for (const [i, k] of cases(name).entries()) {
      const out = await run(name, k.input);
      const v = await verify(name, out, k.input);
      assert.equal(v.ok, true, `${name}[${i}] failed its own verifier: ${v.feedback}`);
      if (k.expect !== undefined) assert.deepEqual(out, k.expect, `${name}[${i}]`);
    }
  });
}

// ---- pure verifiers reject wrong answers ---------------------------------------------

test("pure verifiers reject outputs that a correct run() would never produce", async () => {
  const rejects: [string, unknown, unknown][] = [
    ["slugify", { slug: "Hello World" }, { text: "Hello World" }],
    ["slugify", { slug: "" }, { text: "!!!" }],
    ["word_count", { words: 3, chars: 11 }, { text: "hello world" }],
    ["normalize_phone", { normalized: "+1 650" }, { phone: "+1 650 253 0000" }],
    ["normalize_phone", { normalized: "123" }, { phone: "123" }],
    ["truncate", { text: "hello" }, { text: "hello world", max: 3 }],
    ["dedupe_lines", { lines: ["a", "a"] }, { text: "a\na" }],
    ["dedupe_lines", { lines: ["z"] }, { text: "a" }],
    ["extract_urls", { urls: ["https://not-in-source.com"] }, { text: "nothing" }],
    ["template_fill", { result: "Hi {{name}}" }, { template: "Hi {{name}}", data: {} }],
    ["base64_encode", { encoded: "d3Jvbmc=" }, { text: "right" }],
    ["base64_decode", { text: "wrong" }, { encoded: "aGVsbG8=" }],
    ["extract_emails", { emails: ["ghost@nowhere.io"] }, { text: "no emails" }],
    ["extract_emails", { emails: ["not-an-email"] }, { text: "not-an-email" }],
    ["json_minify", { minified: "{\"a\":2}" }, { json: "{\"a\": 1}" }],
    ["to_snake_case", { snake: "fooBar" }, { text: "fooBar" }],
  ];
  for (const [name, output, input] of rejects) {
    const v = await verify(name, output, input);
    assert.equal(v.ok, false, `${name} accepted ${JSON.stringify(output)}`);
    assert.ok(v.feedback, `${name} must explain the failure`);
  }
});

// ---- stochastic verifiers (the model's answer is supplied by the test) ---------------

const STOCHASTIC: { name: string; input: unknown; good: unknown[]; bad: [unknown, RegExp][] }[] = [
  {
    name: "extract_contact",
    input: { text: "Call Sam Park at sam.park@acme.io or +1 415 555 0132" },
    good: [
      { name: "Sam Park", email: "sam.park@acme.io", phone: "+1 415 555 0132" },
      { name: "Sam Park", email: "SAM.PARK@acme.io", phone: null },
    ],
    bad: [
      [{ name: "Sam Park", email: "operator@home.dev", phone: null }, /does not appear in the source/],
      [{ name: "Sam Park", email: "sam.park", phone: null }, /not a valid email/],
      [{ name: "Sam Park", email: null, phone: "call me" }, /not a valid phone/],
      [{ name: "Sam Park", email: null }, /^schema: /],
    ],
  },
  {
    name: "summarize",
    input: { text: "The wing opened in spring. It holds rare manuscripts. Visits are supervised.", max_sentences: 1 },
    good: [{ summary: "A new wing with rare manuscripts opened in spring." }],
    bad: [
      [{ summary: "A wing opened. It has manuscripts." }, /2 sentence\(s\) but the limit is 1/],
      [{ summary: "x".repeat(200) }, /no longer than the source/],
      [{ summary: "   " }, /non-empty/],
      [{ text: "wrong key" }, /^schema: /],
    ],
  },
  {
    name: "extract_keywords",
    input: { text: "Conductor verifies every stochastic model call.", k: 2 },
    good: [{ keywords: ["conductor", "model call"] }],
    bad: [
      [{ keywords: ["reliability"] }, /does not appear in the source/],
      [{ keywords: ["conductor", "model", "call"] }, /at most k=2/],
      [{ keywords: [] }, /at least 1/],
    ],
  },
  {
    name: "classify_sentiment",
    input: { text: "Loved it" },
    good: [{ label: "positive", confidence: 0.92 }, { label: "neutral", confidence: 0 }],
    bad: [
      [{ label: "happy", confidence: 0.9 }, /^schema: /],
      [{ label: "positive", confidence: 1.5 }, /range 0\.\.1/],
    ],
  },
  {
    name: "redact_pii",
    input: { text: "Mail jane.doe@example.com or call 555-123-4567." },
    good: [{ redacted: "Mail [REDACTED] or call [REDACTED]." }],
    bad: [
      [{ redacted: "Mail jane.doe@example.com or call [REDACTED]." }, /email address still appears/],
      [{ redacted: "Mail [REDACTED] or call 555-123-4567." }, /phone number still appears/],
      [{ redacted: "Mail someone or call someone." }, /no \[REDACTED\] token/],
      [{ redacted: "" }, /non-empty-string/],
    ],
  },
  {
    name: "json_extract",
    input: { text: "Order 7 for Acme", fields: ["order_id", "customer", "city"] },
    good: [{ data: { order_id: "7", customer: "Acme", city: null } }],
    bad: [
      [{ data: { order_id: "7", customer: "Acme" } }, /'city' is missing/],
      [{ data: ["7", "Acme", null] }, /non-array object/],
    ],
  },
  {
    name: "fix_json",
    input: { text: "{name:'Sam',}" },
    good: [{ json: { name: "Sam" } }, { json: [1, 2] }],
    bad: [
      [{ json: null }, /defined and non-null/],
      [{ json: "Sam" }, /object or array/],
      [null, /non-null object/],
    ],
  },
  {
    name: "extract_dates",
    input: { text: "Kickoff March 3, 2026; due 2026-04-15." },
    good: [{ dates: ["2026-03-03", "2026-04-15"] }, { dates: [] }],
    bad: [
      [{ dates: ["2026-02-30"] }, /not a valid YYYY-MM-DD/],
      [{ dates: ["March 3, 2026"] }, /not a valid YYYY-MM-DD/],
    ],
  },
  {
    name: "categorize",
    input: { text: "My package never arrived", categories: ["billing", "shipping"] },
    good: [{ category: "shipping" }],
    bad: [[{ category: "Shipping" }, /not one of the allowed categories/], [{ category: "delivery" }, /not one of the allowed/]],
  },
  {
    name: "translate",
    input: { text: "Thank you.", target_language: "German" },
    good: [{ translation: "Danke." }],
    bad: [[{ translation: " " }, /must not be empty/], [{ translation: "x".repeat(500) }, /exceeds the sane bound/]],
  },
  {
    name: "detect_language",
    input: { text: "Bonjour le monde" },
    good: [{ language: "French", code: "fr" }],
    bad: [[{ language: "French", code: "fra" }, /2-letter/], [{ language: "French", code: "FR" }, /2-letter/], [{ language: "", code: "fr" }, /non-empty/]],
  },
];

test("every stochastic command has verifier fixtures below", () => {
  const covered = new Set(STOCHASTIC.map((s) => s.name));
  for (const [name, c] of registry) if (c.manifest.determinism === "stochastic") assert.ok(covered.has(name), name);
});

for (const s of STOCHASTIC) {
  test(`stochastic verifier: ${s.name}`, async () => {
    for (const g of s.good) {
      const v = await verify(s.name, g, s.input);
      assert.equal(v.ok, true, `rejected good output ${JSON.stringify(g)}: ${v.feedback}`);
    }
    for (const [b, why] of s.bad) {
      const v = await verify(s.name, b, s.input);
      assert.equal(v.ok, false, `accepted bad output ${JSON.stringify(b)}`);
      assert.match(v.feedback ?? "", why);
    }
  });
}

// ---- regressions -----------------------------------------------------------------------

test("extract_emails: surrounding punctuation and brackets are not part of the address", async () => {
  const input = { text: "Email sam@acme.io. Or <ops@acme.io>, (dev@acme.io); mailto:x@y.co and 'q@r.dev'" };
  const out = await run("extract_emails", input);
  assert.deepEqual(out, { emails: ["sam@acme.io", "ops@acme.io", "dev@acme.io", "x@y.co", "q@r.dev"] });
  assert.equal((await verify("extract_emails", out, input)).ok, true);
});

test("extract_urls: trailing sentence punctuation and quotes are not part of the URL", async () => {
  const input = { text: 'See https://a.com/x. Also https://b.org/y?q=1, and "https://c.net"! Not https://. though' };
  const out = await run("extract_urls", input);
  assert.deepEqual(out, { urls: ["https://a.com/x", "https://b.org/y?q=1", "https://c.net"] });
  assert.equal((await verify("extract_urls", out, input)).ok, true);
});

test("slugify: underscores become hyphens (they were silently dropped)", async () => {
  assert.deepEqual(await run("slugify", { text: "snake_case_name" }), { slug: "snake-case-name" });
  assert.deepEqual(await run("slugify", { text: "__init__ file" }), { slug: "init-file" });
});

test("to_snake_case: acronyms are split and non-ASCII letters are kept", async () => {
  const cases: [string, string][] = [
    ["XMLHttpRequest", "xml_http_request"],
    ["HTTPServer", "http_server"],
    ["userID", "user_id"],
    ["Café Olé", "café_olé"],
    ["already_snake", "already_snake"],
  ];
  for (const [text, snake] of cases) {
    const out = await run("to_snake_case", { text });
    assert.deepEqual(out, { snake }, text);
    assert.equal((await verify("to_snake_case", out, { text })).ok, true);
  }
});

test("base64_decode: line-wrapped base64 (as in MIME) verifies", async () => {
  const input = { encoded: "SGVsbG8s\nIFdvcmxk\r\nIQ==" };
  const out = await run("base64_decode", input);
  assert.deepEqual(out, { text: "Hello, World!" });
  assert.equal((await verify("base64_decode", out, input)).ok, true);
});

test("template_fill: the failure names the placeholders that have no data", async () => {
  const input = { template: "Hi {{name}}, order {{id}} ships {{when}}", data: { name: "Sam" } };
  const v = await verify("template_fill", await run("template_fill", input), input);
  assert.equal(v.ok, false);
  assert.match(v.feedback ?? "", /no value in data for: id, when/);
});

test("extract_contact: a phone written as (415) 555-0132 is a valid phone", async () => {
  const input = { text: "Dr. Chen Wei - (415) 555-0132" };
  const v = await verify("extract_contact", { name: "Chen Wei", email: null, phone: "(415) 555-0132" }, input);
  assert.equal(v.ok, true, v.feedback);
});

test("inputSchema bounds: truncate needs max >= 0, categorize needs at least one category", () => {
  assert.notDeepEqual(validate(cmd("truncate").manifest.inputSchema, { text: "abc", max: -1 }), []);
  assert.notDeepEqual(validate(cmd("categorize").manifest.inputSchema, { text: "abc", categories: [] }), []);
});
