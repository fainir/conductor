// Core types for the conductor.
// A "command" is the unit of reliable, reusable competence. Each one declares a
// contract (input/output schemas), a MANDATORY verifier, and a fallback ladder.

export type Determinism = "pure" | "stochastic" | "effectful";
export type TrustTier = "human-verified" | "human-approved" | "auto-verified" | "unverified";
export type JSONSchema = Record<string, unknown>;

export interface CommandManifest {
  /** Must equal the command's directory name. */
  name: string;
  /** One line; used by the router to decide relevance. */
  description: string;
  /** pure = deterministic + cacheable; stochastic = uses the model; effectful = has side effects (needs a human gate). */
  determinism: Determinism;
  trust: TrustTier;
  /** Precondition: input must satisfy this schema. */
  inputSchema: JSONSchema;
  /** Postcondition: output is validated against this (also handed to the model as --json-schema for stochastic commands). */
  outputSchema: JSONSchema;
  /** Ordered fallback ladder of command names. "freeform" is the universal base rung. */
  fallbacks: string[];
  effectful: boolean;
  /** Model for stochastic commands (default: sonnet). */
  model?: string;
  /** Full system prompt for stochastic commands (REPLACES the default — this is what keeps calls hermetic). */
  systemPrompt?: string;
  /** Task instruction prepended to the input for stochastic commands. */
  promptTemplate?: string;
  /** Retries-with-feedback before dropping to the next fallback rung (default: 2). */
  maxAttempts?: number;
}

export interface Verdict {
  ok: boolean;
  /** 0..1; reserved for telemetry / future RL reward shaping. */
  score?: number;
  /** The command was unsure rather than wrong — triggers fallback/human, not a hard fail. */
  abstain?: boolean;
  /** Why it failed; fed back into the next retry attempt. */
  feedback?: string;
  reason?: string;
}

export interface TraceEntry { command: string; ok: boolean; }

export interface SolveContext {
  goal: string;
  depth: number;
  projectDir?: string;
  /** Verifier feedback from the previous failed attempt (retry-with-feedback). */
  feedback?: string;
  trace: TraceEntry[];
}

export interface CommandModule {
  manifest: CommandManifest;
  /** Optional deterministic body. If absent, the command is run by the model. */
  run?: (input: any, ctx: SolveContext) => Promise<any>;
  /** MANDATORY. A command cannot be registered without a verifier. */
  verify: (output: any, input: any, ctx: SolveContext) => Promise<Verdict>;
}

export interface SolveResult {
  ok: boolean;
  output: any;
  /** Which rung actually produced the accepted output ("freeform" if it fell all the way down). */
  command: string;
  attempts: number;
  /** Set when a fallback rung (not the primary) produced the result. */
  fellBackTo?: string;
  verdict: Verdict;
  costUsd: number;
}
