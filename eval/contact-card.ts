// contact-card.ts — THE COMPOSITION EVAL (the thesis-prover).
//
// Build a contact card {id, name, email, phone} from messy text, two ways:
//   baseline  = ONE naive prompt that must do everything at once
//   conductor = a verified pipeline: extract_contact -> normalize_phone -> slugify
//
// A card is valid only if: id is a STRICT slug, email matches the expected value
// (null or grounded), and phone is null or a normalized "+digits" form. The
// conductor guarantees each of those by construction (each step is verified);
// the single-shot baseline must get all three right at once, with no checks.
//
//   REPEATS=3 npx tsx eval/contact-card.ts

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadCommands } from "../src/registry.js";
import { runPipeline } from "../src/pipeline.js";
import { tryParseJson } from "../src/cc.js";

interface Card { id: string; name: string | null; email: string | null; phone: string | null }

const root = resolve(import.meta.dirname, "..");
const registry = await loadCommands(resolve(root, "commands"));
const REPEATS = Number(process.env.REPEATS ?? 2);

const INPUTS: { text: string; email: string | null }[] = [
  { text: "Hi, I'm Dr. Chen Wei - reach me at chen.wei@uni.edu.cn or (415) 555-0132.", email: "chen.wei@uni.edu.cn" },
  { text: "Contact: Sofia Rossi, sofia@rossi-design.it, tel +39 06 1234567.", email: "sofia@rossi-design.it" },
  { text: "yo its Marcus O'Neil, hmu marcus99@gmail.com", email: "marcus99@gmail.com" },
  { text: "Please reach the team via the website contact form. - The Acme Team", email: null },
  { text: "Priya K. - phone 020-7946-0991, no email sorry", email: null },
];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PHONE_OK = /^\+?\d{6,15}$/;

function cardValid(card: Card | undefined, expectEmail: string | null): boolean {
  if (!card) return false;
  if (typeof card.id !== "string" || !SLUG_RE.test(card.id)) return false;
  const e = card.email;
  if (expectEmail === null) {
    if (e !== null && e !== "") return false;
  } else if (typeof e !== "string" || e.toLowerCase() !== expectEmail.toLowerCase()) {
    return false;
  }
  if (card.phone !== null && card.phone !== "" && !PHONE_OK.test(card.phone)) return false;
  return true;
}

function naiveCard(text: string): Promise<{ card: Card | undefined; cost: number }> {
  const prompt =
    `From the text, produce a JSON contact card {"id","name","email","phone"} where: ` +
    `id = a URL-safe slug of the name (lowercase, hyphen-separated, only [a-z0-9-]); ` +
    `email = the email if present else null; ` +
    `phone = the phone as "+" and digits only (strip spaces and punctuation) if present else null. ` +
    `Reply with only the JSON. Text: ${text}`;
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
        res({ card: tryParseJson(env.result) as Card, cost: env.total_cost_usd ?? 0 });
      } catch {
        res({ card: undefined, cost: 0 });
      }
    });
    child.on("error", () => res({ card: undefined, cost: 0 }));
  });
}

async function conductorCard(text: string): Promise<{ card: Card; cost: number }> {
  const r = await runPipeline(
    registry,
    [
      { command: "extract_contact", input: () => ({ text }), as: "contact" },
      { command: "normalize_phone", input: (s) => ({ phone: s.contact?.phone ?? "" }), as: "phone", optional: true },
      { command: "slugify", input: (s) => ({ text: s.contact?.name ?? "unknown" }), as: "slug" },
    ],
    {},
    { telemetryFile: resolve(root, "projects/eval/telemetry.jsonl"), cwd: root },
  );
  const card: Card = {
    id: r.state.slug?.slug ?? "",
    name: r.state.contact?.name ?? null,
    email: r.state.contact?.email ?? null,
    phone: r.state.phone?.normalized ?? null,
  };
  return { card, cost: r.costUsd };
}

let n = 0, bOk = 0, cOk = 0, bCost = 0, cCost = 0;
for (let rep = 0; rep < REPEATS; rep++) {
  for (const t of INPUTS) {
    n++;
    const b = await naiveCard(t.text);
    const bv = cardValid(b.card, t.email);
    bOk += bv ? 1 : 0;
    bCost += b.cost;
    const c = await conductorCard(t.text);
    const cv = cardValid(c.card, t.email);
    cOk += cv ? 1 : 0;
    cCost += c.cost;
    console.log(
      `[${String(n).padStart(2)}] baseline=${bv ? "OK" : "XX"} id=${JSON.stringify(b.card?.id)} ph=${JSON.stringify(b.card?.phone)}` +
      `  conductor=${cv ? "OK" : "XX"} id=${JSON.stringify(c.card.id)} ph=${JSON.stringify(c.card.phone)}`,
    );
  }
}

const pct = (x: number) => `${((100 * x) / n).toFixed(0)}%`;
console.log(`\n=== COMPOSITION (contact card) over ${n} runs (${INPUTS.length} x ${REPEATS}) ===`);
console.log(`baseline (1 prompt)   valid=${pct(bOk)}   cost=$${bCost.toFixed(4)}`);
console.log(`conductor (pipeline)  valid=${pct(cOk)}   cost=$${cCost.toFixed(4)}`);
console.log(`delta                 ${cOk - bOk >= 0 ? "+" : ""}${(((cOk - bOk) * 100) / n).toFixed(0)} points`);
