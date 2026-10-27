// solve.ts - the single-level reliable loop.
//
//   route -> precondition (inputSchema) -> execute -> VERIFY -> retry-with-feedback
//                                                            -> next fallback rung
//                                                            -> freeform (always terminates)
//
// Every node is verified. Every attempt is logged. The ladder guarantees the
// conductor never returns unverified output silently, and never does worse than
// raw Claude (the bottom rung). Pure commands are the exception: they are
// deterministic code, so they are neither retried nor handed to the model - a
// pure output that fails its verifier fails with the verifier's reason.

import { createHash } from "node:crypto";
import type { CommandModule, SolveContext, SolveResult, Verdict } from "./types.js";
import { callClaude } from "./cc.js";
import { freeform } from "./freeform.js";
import { logEntry } from "./telemetry.js";
import { validate } from "./schema.js";

const pureCache = new Map<string, unknown>();
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

export interface SolveOptions {
  registry: Map<string, CommandModule>;
  /** Explicit routing for the MVP. (router.route() can fill this in.) */
  command: string;
  goal?: string;
  telemetryFile?: string;
  cwd?: string;
}

/** Run a command body: deterministic run() (with cache for pure), else drive the model. */
async function execute(cmd: CommandModule, input: any, ctx: SolveContext): Promise<{ output: any; costUsd: number; error?: string }> {
  const m = cmd.manifest;

  if (cmd.run) {
    if (m.determinism === "pure") {
      const key = `${m.name}:${hash(input)}`;
      if (pureCache.has(key)) return { output: pureCache.get(key), costUsd: 0 };
      const output = await cmd.run(input, ctx);
      pureCache.set(key, output);
      return { output, costUsd: 0 };
    }
    return { output: await cmd.run(input, ctx), costUsd: 0 };
  }

  // stochastic: hermetic model call constrained by the output schema
  const prompt =
    `${m.promptTemplate ?? "Process the input."}\n\nINPUT:\n${JSON.stringify(input, null, 2)}` +
    (ctx.feedback ? `\n\nYOUR PREVIOUS ANSWER FAILED VERIFICATION:\n${ctx.feedback}\nReturn a corrected answer.` : "");
  const r = await callClaude({
    systemPrompt:
      m.systemPrompt ??
      "You are a deterministic function. Use ONLY the provided input - no ambient or outside knowledge. Return JSON matching the schema.",
    prompt,
    jsonSchema: m.outputSchema,
    model: m.model ?? "sonnet",
    cwd: ctx.projectDir,
  });
  return { output: r.structured, costUsd: r.costUsd, error: r.error };
}

/** Run a verifier; a verifier that throws is a failed verdict, never a crash. */
async function safeVerify(cmd: CommandModule, output: unknown, input: unknown, ctx: SolveContext): Promise<Verdict> {
  try {
    return await cmd.verify(output, input, ctx);
  } catch (e: any) {
    return { ok: false, score: 0, feedback: "verifier threw: " + (e?.message ?? String(e)) };
  }
}

const noOutput = (what: string, error?: string) => `${what}${error ? ` (${error})` : ""}`;

export async function solve(opts: SolveOptions, input: any): Promise<SolveResult> {
  const reg = opts.registry;
  const primary = reg.get(opts.command);
  if (!primary) throw new Error(`Unknown command: ${opts.command}`);
  const goal = opts.goal ?? opts.command;

  // precondition gate: the input must satisfy the command's contract before anything runs
  const problems = validate(primary.manifest.inputSchema, input);
  if (problems.length > 0) {
    const verdict: Verdict = { ok: false, score: 0, feedback: "invalid input: " + problems.join("; ") };
    return { ok: false, output: undefined, command: opts.command, attempts: 0, verdict, costUsd: 0 };
  }

  // ladder: primary, then its declared command fallbacks, then universal freeform
  // (pure commands keep exactly the fallbacks they declare)
  const ladder = [opts.command, ...primary.manifest.fallbacks];
  if (primary.manifest.determinism !== "pure" && !ladder.includes("freeform")) ladder.push("freeform");

  let totalCost = 0;
  let attemptsMade = 0;
  let lastVerdict: Verdict = { ok: false, feedback: "all rungs exhausted" };

  for (let rung = 0; rung < ladder.length; rung++) {
    const name = ladder[rung];
    const fellBack = rung > 0 ? opts.command : undefined;

    // ---- freeform rung ----------------------------------------------------
    if (name === "freeform") {
      const t0 = Date.now();
      const r = await freeform(goal, input, primary.manifest.outputSchema, { cwd: opts.cwd });
      totalCost += r.costUsd;
      const ctx: SolveContext = { goal, depth: 0, projectDir: opts.cwd, trace: [] };
      const verdict: Verdict =
        r.structured !== undefined
          ? await safeVerify(primary, r.structured, input, ctx) // the contract still applies to freeform output
          : { ok: false, feedback: noOutput("freeform produced no structured output", r.error) };
      if (opts.telemetryFile)
        logEntry(opts.telemetryFile, {
          ts: new Date().toISOString(), command: "freeform", ok: verdict.ok, attempts: 1,
          fellBackTo: opts.command, costUsd: r.costUsd, latencyMs: Date.now() - t0, depth: 0, verdict,
        });
      return { ok: verdict.ok, output: r.structured, command: "freeform", attempts: 1, fellBackTo: opts.command, verdict, costUsd: totalCost };
    }

    // ---- command rung -----------------------------------------------------
    const cmd = reg.get(name);
    if (!cmd) continue;

    // a pure command is deterministic: a retry would return the identical output
    const maxAttempts = cmd.manifest.determinism === "pure" ? 1 : (cmd.manifest.maxAttempts ?? 2);
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = Date.now();
      const ctx: SolveContext = { goal, depth: 0, projectDir: opts.cwd, feedback, trace: [] };
      let output: any;
      let costUsd = 0;
      let verdict: Verdict;
      attemptsMade++;
      try {
        const ex = await execute(cmd, input, ctx);
        output = ex.output;
        costUsd = ex.costUsd;
        totalCost += costUsd;
        verdict = output === undefined ? { ok: false, feedback: noOutput("no output produced", ex.error) } : await safeVerify(cmd, output, input, ctx);
      } catch (e: any) {
        verdict = { ok: false, feedback: "command threw: " + (e?.message ?? String(e)) };
      }

      if (opts.telemetryFile)
        logEntry(opts.telemetryFile, {
          ts: new Date().toISOString(), command: name, ok: verdict.ok, attempts: attempt,
          fellBackTo: fellBack, costUsd, latencyMs: Date.now() - t0, depth: 0, verdict,
        });

      if (verdict.ok) return { ok: true, output, command: name, attempts: attempt, fellBackTo: fellBack, verdict, costUsd: totalCost };
      feedback = verdict.feedback; // retry with the verifier's feedback
      lastVerdict = verdict;
    }
    // attempts exhausted -> drop to next rung
  }

  return { ok: false, output: undefined, command: opts.command, attempts: attemptsMade, verdict: lastVerdict, costUsd: totalCost };
}
