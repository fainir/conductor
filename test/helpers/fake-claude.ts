// fake-claude.ts - a hermetic stand-in for the `claude` CLI.
// installFakeClaude() writes an executable `claude` script into a temp dir and puts
// that dir first on PATH, so every spawn("claude") in src/ reaches the fake instead
// of a real model. Tests queue canned JSON envelopes and inspect each call's argv.
// No network, no model, no cost.

import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

export interface FakeResponse {
  /** JSON envelope to print (the shape `claude -p --output-format json` emits). */
  envelope?: Record<string, unknown>;
  /** Raw stdout instead of an envelope. */
  raw?: string;
  /** Write stdout in two chunks split at this BYTE offset (exercises chunk decoding). */
  splitAt?: number;
  /** Never answer; keep the process alive this long (exercises the timeout). */
  hangMs?: number;
  /** Process exit code (default 0). */
  exitCode?: number;
}

export interface FakeCall {
  args: string[];
  /** True when stdin reached EOF right away (what the real CLI needs to skip its 3s stdin wait). */
  stdinClosed: boolean;
}

// The real CLI waits up to 3s for stdin when it is not a TTY. The fake mirrors that
// (with a shorter wait) and records whether EOF arrived, so tests can assert the
// caller closes stdin.
const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
let stdinClosed = false;
let done = false;
let waitTimer;
function respond() {
  if (done) return;
  done = true;
  clearTimeout(waitTimer);
  process.stdin.destroy();
  fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ args: process.argv.slice(2), stdinClosed }) + "\\n");
  const qf = path.join(dir, "queue.json");
  const queue = fs.existsSync(qf) ? JSON.parse(fs.readFileSync(qf, "utf8")) : [];
  const next = queue.shift();
  fs.writeFileSync(qf, JSON.stringify(queue));
  if (!next) {
    process.stdout.write(JSON.stringify({ is_error: true, result: "fake claude: no queued response", total_cost_usd: 0 }));
    process.exitCode = 1;
    return;
  }
  if (next.hangMs) { setTimeout(() => {}, next.hangMs); return; }
  const body = Buffer.from(next.raw !== undefined ? next.raw : JSON.stringify(next.envelope), "utf8");
  process.exitCode = next.exitCode || 0;
  if (next.splitAt) {
    process.stdout.write(body.subarray(0, next.splitAt));
    setTimeout(() => process.stdout.write(body.subarray(next.splitAt)), 50);
  } else {
    process.stdout.write(body);
  }
}
if (process.stdin.isTTY) respond();
else {
  process.stdin.on("end", () => { stdinClosed = true; respond(); });
  process.stdin.on("error", respond);
  process.stdin.resume();
  waitTimer = setTimeout(respond, 1000);
}
`;

export interface FakeClaude {
  dir: string;
  /** Append responses to the queue; each claude call consumes one. */
  queue(...responses: FakeResponse[]): void;
  /** Every call made since the last reset, oldest first. */
  calls(): FakeCall[];
  /** Clear the queue and the call log. */
  reset(): void;
  /** Restore PATH and delete the temp dir. */
  uninstall(): void;
}

export function installFakeClaude(): FakeClaude {
  const dir = mkdtempSync(join(tmpdir(), "conductor-fake-claude-"));
  const bin = join(dir, "claude");
  writeFileSync(bin, SCRIPT);
  chmodSync(bin, 0o755);
  const queueFile = join(dir, "queue.json");
  const callsFile = join(dir, "calls.jsonl");
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${originalPath ?? ""}`;

  const fake: FakeClaude = {
    dir,
    queue(...responses) {
      const q = existsSync(queueFile) ? JSON.parse(readFileSync(queueFile, "utf8")) : [];
      writeFileSync(queueFile, JSON.stringify([...q, ...responses]));
    },
    calls() {
      if (!existsSync(callsFile)) return [];
      return readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
    reset() {
      writeFileSync(queueFile, "[]");
      writeFileSync(callsFile, "");
    },
    uninstall() {
      process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
  fake.reset();
  return fake;
}

/** A successful envelope carrying structured output, like `claude -p --json-schema` returns. */
export function structured(value: unknown, costUsd = 0.001): FakeResponse {
  return { envelope: { is_error: false, result: JSON.stringify(value), structured_output: value, total_cost_usd: costUsd } };
}

/** The value passed as the prompt (the positional argument right after -p). */
export function promptOf(call: FakeCall): string {
  return call.args[call.args.indexOf("-p") + 1];
}

/** The value passed after a given flag, or undefined when the flag is absent. */
export function flag(call: FakeCall, name: string): string | undefined {
  const i = call.args.indexOf(name);
  return i === -1 ? undefined : call.args[i + 1];
}
