// cc.ts - the single reliable model call.
// Drives the `claude` CLI in headless mode on your subscription auth.
//
// HERMETIC BY DEFAULT. The defaults below isolate every call from ambient
// context (global CLAUDE.md, user identity, foreign hooks) - without this,
// a trivial extraction call leaked the operator's own email instead of the
// input's. Isolation is a reliability primitive, not a nicety.

import { spawn } from "node:child_process";

export interface CCOptions {
  prompt: string;
  /** REQUIRED. Fully REPLACES claude's default system prompt - this is what kills ambient pollution. */
  systemPrompt: string;
  /** Native structured-output validation; result lands in envelope.structured_output. */
  jsonSchema?: Record<string, unknown>;
  model?: string;
  /** "" = no tools (default, hermetic) | "default" = all | "Read,Bash" = a subset. */
  tools?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  addDir?: string;
  cwd?: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

export interface CCResult<T = unknown> {
  ok: boolean;
  structured?: T;
  text: string;
  costUsd: number;
  isError: boolean;
  error?: string;
  raw?: any;
}

const DEFAULT_TIMEOUT = 120_000;

export function ccArgs(opts: CCOptions): string[] {
  const args = [
    "-p", opts.prompt,
    "--output-format", "json",
    "--system-prompt", opts.systemPrompt, // full replace => hermetic
    "--setting-sources", "",              // ignore user/project/local settings (no foreign hooks)
    "--no-session-persistence",
    "--model", opts.model ?? "sonnet",
    "--tools", opts.tools ?? "",          // hermetic default: no tools
  ];
  if (opts.jsonSchema) args.push("--json-schema", JSON.stringify(opts.jsonSchema));
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
  if (opts.addDir) args.push("--add-dir", opts.addDir);
  if (opts.maxBudgetUsd != null) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  return args;
}

export async function callClaude<T = unknown>(opts: CCOptions): Promise<CCResult<T>> {
  return new Promise((resolve) => {
    // stdin is "ignore" (EOF right away): with an open stdin pipe the CLI waits 3s for piped input on every call.
    const child = spawn("claude", ccArgs(opts), {
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, text: "", costUsd: 0, isError: true, error: `timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT}ms` });
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT);

    // setEncoding keeps multi-byte UTF-8 characters intact across chunk boundaries.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const error =
        err.code === "ENOENT"
          ? "`claude` CLI not found on PATH. Install Claude Code and log in: https://code.claude.com/docs/en/setup"
          : `spawn error: ${err.message}`;
      resolve({ ok: false, text: "", costUsd: 0, isError: true, error });
    });
    child.on("close", () => {
      clearTimeout(timer);
      let env: any;
      try {
        env = JSON.parse(stdout);
      } catch {
        resolve({ ok: false, text: stdout.slice(0, 500), costUsd: 0, isError: true, error: `unparseable envelope; stderr=${stderr.slice(0, 300)}` });
        return;
      }
      const costUsd = env.total_cost_usd ?? 0;
      const isError = !!env.is_error;
      const text = typeof env.result === "string" ? env.result : "";
      let structured = env.structured_output as T | undefined;
      if (structured === undefined && opts.jsonSchema) {
        const parsed = tryParseJson(text);
        if (parsed !== undefined) structured = parsed as T;
      }
      resolve({ ok: !isError, structured, text, costUsd, isError, error: isError ? text || "claude reported an error" : undefined, raw: env });
    });
  });
}

/** Best-effort JSON extraction from free text (fallback when structured_output is absent). */
export function tryParseJson(s: string): unknown {
  if (!s) return undefined;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  try { return JSON.parse(body.trim()); } catch { /* fall through */ }
  const m = body.match(/[{\[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return undefined;
}

/** Retry on hard failure or missing structured output. */
export async function callClaudeRetry<T = unknown>(opts: CCOptions, retries = 1): Promise<CCResult<T>> {
  let last: CCResult<T> | undefined;
  for (let i = 0; i <= retries; i++) {
    const r = await callClaude<T>(opts);
    if (r.ok && (!opts.jsonSchema || r.structured !== undefined)) return r;
    last = r;
  }
  return last!;
}
