// triage.ts — a deeper composition eval (4 steps) on support tickets.
//
//   baseline  = ONE prompt produces the whole triage record
//   conductor = redact_pii -> categorize -> classify_sentiment -> extract_contact
//
// Graded on the GUARANTEES the conductor enforces by construction:
//   - category is one of the allowed set (categorize verifier)
//   - sentiment is a valid label (classify_sentiment verifier)
//   - the redacted summary contains NO email or phone (redact_pii verifier)
// The single-shot must satisfy all three at once, with no checks. Deeper chain =
// more places the naive approach can slip.
//
//   REPEATS=2 npx tsx eval/triage.ts

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadCommands } from "../src/registry.js";
import { runPipeline } from "../src/pipeline.js";
import { tryParseJson } from "../src/cc.js";
import { EMAIL_FIND, PHONE_FIND } from "../src/verify.js";

interface Record_ { category?: string; sentiment?: string; redacted?: string; email?: string | null }

const root = resolve(import.meta.dirname, "..");
const registry = await loadCommands(resolve(root, "commands"));
const REPEATS = Number(process.env.REPEATS ?? 2);

const CATS = ["billing", "shipping", "technical", "account"];
const SENT = ["positive", "negative", "neutral"];

const TICKETS = [
  "URGENT: I've been charged twice this month! Unacceptable. Call me at 415-555-0199 or email frustrated@gmail.com - John",
  "Hey, my order #4521 hasn't shipped in 2 weeks and I'm worried. Reach me: sara.lee@work.io",
  "The dashboard keeps crashing when I click export. My number is +1 (212) 555-0142 if you want to call.",
  "Love the product! Quick q on how to update my billing address. - mike@startup.dev, 020 7946 0000",
  "Can't log in, the password reset email never arrives. Contact me on 0501234567 please.",
];

function valid(r: Record_ | undefined): boolean {
  if (!r) return false;
  if (typeof r.category !== "string" || !CATS.includes(r.category)) return false;
  if (typeof r.sentiment !== "string" || !SENT.includes(r.sentiment)) return false;
  if (typeof r.redacted !== "string") return false;
  if (EMAIL_FIND.test(r.redacted) || PHONE_FIND.test(r.redacted)) return false; // PII leaked
  return true;
}

function naive(text: string): Promise<{ rec: Record_ | undefined; cost: number }> {
  const prompt =
    `Triage this support ticket. Return JSON {"category","sentiment","redacted","email"} where ` +
    `category is exactly one of ${JSON.stringify(CATS)}; ` +
    `sentiment is exactly one of ${JSON.stringify(SENT)}; ` +
    `redacted is the ticket text with ALL email addresses and phone numbers removed; ` +
    `email is the contact email or null. Reply with only the JSON. Ticket: ${text}`;
  return new Promise((res) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--output-format", "json", "--tools", "", "--setting-sources", "", "--no-session-persistence", "--model", "sonnet"],
      { env: process.env },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", () => {
      try {
        const env = JSON.parse(out);
        res({ rec: tryParseJson(env.result) as Record_, cost: env.total_cost_usd ?? 0 });
      } catch {
        res({ rec: undefined, cost: 0 });
      }
    });
    child.on("error", () => res({ rec: undefined, cost: 0 }));
  });
}

async function conductor(text: string): Promise<{ rec: Record_; cost: number }> {
  const r = await runPipeline(
    registry,
    [
      { command: "redact_pii", input: () => ({ text }), as: "r" },
      { command: "categorize", input: (s) => ({ text: s.r?.redacted ?? text, categories: CATS }), as: "c" },
      { command: "classify_sentiment", input: (s) => ({ text: s.r?.redacted ?? text }), as: "s" },
      { command: "extract_contact", input: () => ({ text }), as: "ct", optional: true },
    ],
    {},
    { telemetryFile: resolve(root, "projects/eval/telemetry.jsonl"), cwd: root },
  );
  return {
    rec: { category: r.state.c?.category, sentiment: r.state.s?.label, redacted: r.state.r?.redacted, email: r.state.ct?.email ?? null },
    cost: r.costUsd,
  };
}

let n = 0, bOk = 0, cOk = 0, bCost = 0, cCost = 0;
for (let rep = 0; rep < REPEATS; rep++) {
  for (const t of TICKETS) {
    n++;
    const b = await naive(t);
    const bv = valid(b.rec);
    bOk += bv ? 1 : 0;
    bCost += b.cost;
    const c = await conductor(t);
    const cv = valid(c.rec);
    cOk += cv ? 1 : 0;
    cCost += c.cost;
    const why = !bv ? (b.rec && (EMAIL_FIND.test(b.rec.redacted ?? "") || PHONE_FIND.test(b.rec.redacted ?? "")) ? "PII-leak" : `cat=${b.rec?.category}`) : "";
    console.log(`[${String(n).padStart(2)}] baseline=${bv ? "OK" : "XX " + why}  conductor=${cv ? "OK" : "XX"}`);
  }
}

const pct = (x: number) => `${((100 * x) / n).toFixed(0)}%`;
console.log(`\n=== TRIAGE (4-step pipeline) over ${n} runs (${TICKETS.length} x ${REPEATS}) ===`);
console.log(`baseline (1 prompt)   valid=${pct(bOk)}   cost=$${bCost.toFixed(4)}`);
console.log(`conductor (pipeline)  valid=${pct(cOk)}   cost=$${cCost.toFixed(4)}`);
console.log(`delta                 ${cOk - bOk >= 0 ? "+" : ""}${(((cOk - bOk) * 100) / n).toFixed(0)} points`);
