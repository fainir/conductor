# conductor

A thin **deterministic conductor** that drives **Claude Code** as its engine.

The skeleton (route -> gate -> execute -> **verify** -> retry -> fallback -> log) is
real code that cannot be skipped. The judgment (reasoning, extraction, semantic
checks) is delegated to hermetic `claude -p` calls on your subscription. Reliability
comes from putting structure in code and quarantining the model to the
judgment-shaped holes.

## Use it in Claude Code

The conductor ships as an MCP server, so its verified commands appear as native
tools in any Claude Code session (`extract_contact`, `redact_pii`, `summarize`,
`normalize_phone`, ...), each routed through verify + retry + fallback. Three ways
to install, simplest first.

**A. One command (this machine):**
```bash
git clone <repo> && cd conductor && npm install && npm run build
claude mcp add conductor -s user -- node "$PWD/dist/conductor-mcp.cjs"
```
Remove with `claude mcp remove conductor -s user`.

**B. As a plugin (shareable):**
```bash
claude plugin marketplace add <repo-or-path>
claude plugin install conductor@conductor
```
The plugin bundles the prebuilt, self-contained server (`dist/conductor-mcp.cjs`)
and wires it via `.mcp.json` using `${CLAUDE_PLUGIN_ROOT}` - no build or deps on the
user's side. (Note: opening *this repo* directly as a CC project will show a failed
`.mcp.json` because that variable only expands when installed as a plugin - harmless.)

**C. Published (future):** after `npm publish`, the plugin's `.mcp.json` can run
`npx -y conductor-mcp`, so users install with nothing local at all.

Requirement: the machine needs the `claude` CLI installed and authenticated -
stochastic commands run hermetic `claude -p` sub-calls on that subscription.

## Why it's reliable (the load-bearing ideas)

- **Hermetic calls.** Every model call fully replaces the system prompt and loads no
  settings, so ambient context (global CLAUDE.md, your identity, foreign hooks) can't
  leak in. We caught this for real: a naive call returned the operator's own email
  instead of the input's. See `src/cc.ts`.
- **Mandatory verifiers.** A command can't even register without a `verify` export
  (`src/registry.ts`). Mechanical checks first (schema, regex, **grounding**),
  LLM-judge only for genuinely semantic criteria.
- **Fallback-to-freeform.** Every chain ends at plain Claude, so the conductor can
  never do worse than raw Claude, only better when a verified command applies.
- **Composition that can't silently compound errors.** `runPipeline` threads verified
  steps; each step's output is checked before the next runs (`src/pipeline.ts`).
- **Retry-with-feedback.** A failed verifier's feedback is fed into the next attempt.
- **Telemetry.** Every node is logged to JSONL (`src/telemetry.ts`), the substrate for
  reliability-aware routing (next) and RL reward (later).
- **Determinism gradient.** `pure` commands run as cached deterministic code (free,
  100% reliable); `stochastic` commands use the model; `effectful` will need a gate.

## Command library

| command | kind | verifier highlight |
|---|---|---|
| `slugify` | pure | url-safe slug shape |
| `word_count` | pure | recomputes + asserts equality (self-checking) |
| `normalize_phone` | pure | `+` and digits only, length bound |
| `extract_contact` | stochastic | schema + email/phone format + **grounding** (value must appear in source) |
| `summarize` | stochastic | sentence budget + compression |
| `extract_keywords` | stochastic | each keyword must appear verbatim in source (grounded) |
| `classify_sentiment` | stochastic | enum label + confidence in 0..1 |
| `redact_pii` | stochastic | no email/phone may remain in output |
| `json_extract` | stochastic | every requested field present as a key |
| `truncate` | pure | output length never exceeds `max` |
| `dedupe_lines` | pure | no duplicates; every line from the source |
| `extract_urls` | pure | each URL matches pattern and appears in source |
| `template_fill` | pure | no unresolved `{{placeholders}}` remain |
| `fix_json` | stochastic | result is a valid parsed JSON value |
| `extract_dates` | stochastic | each date is valid ISO-8601 `YYYY-MM-DD` |
| `categorize` | stochastic | chosen category is one of the allowed set |
| `translate` | stochastic | non-empty, length-sane translation |

## Run it

```bash
npm install

# pure command, no model call, instant
npx tsx src/cli.ts slugify '{"text":"Hello, World!"}'

# stochastic command, hermetic model call + mechanical verify + fallback
npx tsx src/cli.ts extract_contact '{"text":"Call Sam at sam@acme.io"}'

# per-command test suite (each command vs its tests/cases.json)
npx tsx eval/run-tests.ts            # all
npx tsx eval/run-tests.ts slugify    # one

# evals: baseline (naive) vs conductor
REPEATS=2 npx tsx eval/run-eval.ts        # single-shot extraction
REPEATS=2 npx tsx eval/contact-card.ts    # composition pipeline
```

## Results (measured)

- **Per-command tests:** 25/25 across the stochastic+pure suite (plus pure exact-match).
- **Single-shot extraction** (`run-eval`): baseline 100% vs conductor 100%, **+0**.
  Honest: on easy single-shot tasks a frontier model is already reliable, so there's
  no gap to close. The value isn't here.
- **Composition** (`contact-card`): baseline 80% vs conductor 100%, **+20 points**.
  The baseline emitted a phone number with an invisible Unicode character; the
  deterministic `normalize_phone` step is structurally immune to that class of error.
  Cost tradeoff: conductor ~2x the baseline (more calls per task).

Takeaway: the reliability delta grows with composition depth and machine-consumed
output, not with single easy calls. The harness now measures it either way.

## Layout

```
src/
  cc.ts          one hermetic claude call (structured output, retry)
  registry.ts    loads commands; ENFORCES "no command without a verifier"
  router.ts      structured pick from the command list (reliability-weighted next)
  verify.ts      verifier helpers: schema, regex, grounding/PII detectors, llmJudge
  telemetry.ts   jsonl logging + rolling reliability scores
  freeform.ts    the universal fallback rung (plain Claude)
  solve.ts       the loop: execute -> verify -> retry -> fallback
  pipeline.ts    compose verified commands (errors can't silently compound)
  cli.ts         manual driver
commands/<name>/index.ts        manifest + optional run() + MANDATORY verify()
commands/<name>/tests/cases.json  {input, expect?} cases
eval/
  run-tests.ts   per-command test runner
  run-eval.ts    single-shot extraction: baseline vs conductor
  contact-card.ts  composition pipeline: baseline vs conductor
projects/<p>/    telemetry.jsonl (per project)
```

## What's deliberately deferred

Router using telemetry scores, recursion/decomposition by the model (pipelines are
explicit for now), persistent plan/memory files, human gates for effectful commands,
semi-auto induction (trace -> new command), and RL on the router. Each later layer
trusts the earlier one, so the inner loop ships and is measured first.
