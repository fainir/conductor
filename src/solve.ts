// solve.ts — the single-level reliable loop.
//
//   route -> [precondition] -> execute -> VERIFY -> retry-with-feedback
//                                                 -> next fallback rung
//                                                 -> freeform (always terminates)
//
// Every node is verified. Every attempt is logged. The ladder guarantees the
// conductor never returns unverified output silently, and never does worse than
// raw Claude (the bottom rung).

import { createHash } from "node:crypto";
import type { CommandModule, SolveContext, SolveResult, Verdict } from "./types.js";
import { callClaude } from "./cc.js";
import { freeform } from "./freeform.js";
import { logEntry } from "./telemetry.js";

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
async function execute(cmd: CommandModule, input: any, ctx: SolveContext): Promise<{ output: any; costUsd: number }> {
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
      "You are a deterministic function. Use ONLY the provided input — no ambient or outside knowledge. Return JSON matching the schema.",
    prompt,
    jsonSchema: m.outputSchema,
    model: m.model ?? "sonnet",
    cwd: ctx.projectDir,
  });
  return { output: r.structured, costUsd: r.costUsd };
}

export async function solve(opts: SolveOptions, input: any): Promise<SolveResult> {
  const reg = opts.registry;
  const primary = reg.get(opts.command);
  if (!primary) throw new Error(`Unknown command: ${opts.command}`);
  const goal = opts.goal ?? opts.command;

  // ladder: primary, then its declared command fallbacks, then universal freeform
  const ladder = [opts.command, ...primary.manifest.fallbacks];
  if (!ladder.includes("freeform")) ladder.push("freeform");

  let totalCost = 0;

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
          ? await primary.verify(r.structured, input, ctx) // the contract still applies to freeform output
          : { ok: false, feedback: "freeform produced no structured output" };
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

    // precondition gate
    // (kept light in the MVP — full schema gating lands with the contract layer)

    const maxAttempts = cmd.manifest.maxAttempts ?? 2;
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = Date.now();
      const ctx: SolveContext = { goal, depth: 0, projectDir: opts.cwd, feedback, trace: [] };
      let output: any;
      let costUsd = 0;
      let verdict: Verdict;
      try {
        const ex = await execute(cmd, input, ctx);
        output = ex.output;
        costUsd = ex.costUsd;
        totalCost += costUsd;
        verdict = output === undefined ? { ok: false, feedback: "no output produced" } : await cmd.verify(output, input, ctx);
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
    }
    // attempts exhausted -> drop to next rung
  }

  return { ok: false, output: undefined, command: opts.command, attempts: 0, verdict: { ok: false, feedback: "all rungs exhausted" }, costUsd: totalCost };
}
