# conductor

[![CI](https://github.com/fainir/conductor/actions/workflows/ci.yml/badge.svg)](https://github.com/fainir/conductor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Verified tool calls for Claude Code: an MCP server (installable as a plugin) whose 23 tools check
their own output in code before you get it.

A model asked to "extract the email" or "redact the phone numbers" is usually right, and nothing
tells you when it isn't. conductor puts each job behind a contract: an input schema, an output
schema and a mandatory verifier. Deterministic jobs (slugs, base64, URL extraction) run as plain
code and never touch a model. Judgment jobs (summaries, PII redaction) run as hermetic `claude -p`
calls, and an answer that fails its verifier is retried with the failure as feedback, handed to a
fallback, or returned as a failure; it is never silently passed through.

The skeleton (validate -> execute -> **verify** -> retry -> fallback -> log) is real code that
cannot be skipped; the model is quarantined to the judgment-shaped holes.

## Quick start

You need [Claude Code](https://code.claude.com/docs/en/setup) installed and logged in, and Node.js
20 or newer on your `PATH` (the plugin starts the server with `node`).

```bash
claude plugin marketplace add fainir/conductor
claude plugin install conductor@conductor
```

Restart Claude Code (or run `/reload-plugins` in a running session). Inside a session the same
steps are `/plugin marketplace add fainir/conductor` and `/plugin install conductor@conductor`.
Check that the server is up:

```console
$ claude mcp list
plugin:conductor:conductor: node /Users/you/.claude/plugins/cache/conductor/conductor/0.4.0/dist/conductor-mcp.cjs - ✓ Connected
```

Then ask for the job in plain words, for example "redact the PII in this ticket with conductor".
The tools show up as `mcp__plugin_conductor_conductor__<tool>`.

Update with `claude plugin marketplace update conductor && claude plugin update conductor@conductor`,
remove with `claude plugin uninstall conductor@conductor`.

**Without the plugin system.** `dist/conductor-mcp.cjs` is a committed, self-contained bundle, so
a clone needs no install or build step:

```bash
git clone https://github.com/fainir/conductor
claude mcp add conductor -s user -- node "$PWD/conductor/dist/conductor-mcp.cjs"
```

Other MCP clients can run `npx -y github:fainir/conductor`, which serves MCP over stdio (the first
start clones the repo and installs its dependencies, so it is slow). The package is not published
to npm; the unrelated `conductor-mcp` package there belongs to someone else.

## Usage

Every tool returns the same envelope. Real output from the bundle for `base64_encode` with
`{"text": "hello"}`:

```json
{ "ok": true, "output": { "encoded": "aGVsbG8=" }, "via": "base64_encode", "attempts": 1, "verdict": { "ok": true, "score": 1 } }
```

`via` names the rung that produced the answer (the tool itself, a declared fallback, or
`freeform` for plain Claude), and `attempts` counts tries on that rung. A failure sets `ok: false`
and the tool result's `isError`, and the verdict says why, so the calling model can fix its call:

```json
{ "ok": false, "via": "redact_pii", "attempts": 0,
  "verdict": { "ok": false, "score": 0, "feedback": "invalid input: input: missing required property 'text'; input: unexpected property 'txt' (allowed: text)" } }
```

From a clone you can drive the same loop with the CLI (`npm ci` first). Pure tools answer
instantly and cost nothing:

```console
$ npx tsx src/cli.ts slugify '{"text":"Hello, World!"}'
{
  "ok": true,
  "output": {
    "slug": "hello-world"
  },
  "command": "slugify",
  "attempts": 1,
  "verdict": {
    "ok": true,
    "score": 1
  },
  "costUsd": 0
}

$ npx tsx src/cli.ts normalize_phone '{"phone":"call me"}'
{
  "ok": false,
  "command": "normalize_phone",
  "attempts": 1,
  "verdict": {
    "ok": false,
    "score": 0,
    "feedback": "shape: normalized must match /^\\+?\\d{6,15}$/ (an optional leading '+' followed by 6-15 digits)"
  },
  "costUsd": 0
}
```

The CLI exits 1 when the result fails verification. Model-backed tools work the same way
(`npx tsx src/cli.ts extract_contact '{"text":"Call Sam at sam@acme.io"}'`) and spend a
`claude -p` call per attempt. `npx tsx src/cli.ts` with no arguments lists the commands, and
`npx tsx src/cli.ts route "make a url slug" '{"text":"Hello World"}'` lets a model pick the command.

## Tools

### Pure tools (code only, no model call)

| tool | input | what it does | verifier checks |
|---|---|---|---|
| `slugify` | `text` | Convert a string into a URL-safe slug. | non-empty; only `[a-z0-9]` runs joined by single hyphens |
| `word_count` | `text` | Count the words and characters in a string. Words are whitespace-separated tokens of the trimmed text; chars is the raw length of the input. | recomputes both counts |
| `normalize_phone` | `phone` | Normalize a phone string to canonical '[+]digits' form by stripping non-digit characters. | recomputes; optional `+` then 6-15 digits |
| `truncate` | `text, max` | Truncate text to at most `max` characters, appending a single-character ellipsis when it must be cut. | length never exceeds `max`; recomputes |
| `dedupe_lines` | `text` | Split text on newlines and keep the first occurrence of each line, preserving order. | no duplicates; every line comes from the input; recomputes |
| `extract_urls` | `text` | Extract all http(s) URLs from a text, deduped while preserving first-seen order. | http(s) shape; each URL appears in the input |
| `template_fill` | `template, data` | Fill a template by replacing every {{key}} token with String(data[key]); fails, naming the keys, if any {{key}} has no value in data. | recomputes; no `{{placeholder}}` left |
| `base64_encode` | `text` | Encode a UTF-8 string to base64. | decodes back to the input |
| `base64_decode` | `encoded` | Decode a base64 string to UTF-8 text. | re-encodes to the input (padding and line breaks ignored) |
| `extract_emails` | `text` | Extract all email addresses from text. | email shape; each address appears in the input |
| `json_minify` | `json` | Minify a JSON string by removing insignificant whitespace. | parses to the same value as the input |
| `to_snake_case` | `text` | Convert a string to snake_case. | recomputes |

### Model-backed tools (hermetic `claude -p` call)

| tool | input | what it does | verifier checks |
|---|---|---|---|
| `extract_contact` | `text` | Extract a contact's name, email, and phone from a blob of text. | schema; email and phone shape; the email must appear in the input (grounding) |
| `summarize` | `text, max_sentences?` | Summarize a blob of text in at most a few sentences, using only the text itself. | at most `max_sentences` (default 2); not longer than the input |
| `extract_keywords` | `text, k?` | Extract up to k salient keywords or short phrases that appear verbatim in the input text. | 1 to `k` items (default 5); each appears verbatim in the input |
| `classify_sentiment` | `text` | Classify the overall sentiment of a piece of text as positive, negative, or neutral. | label is one of the three; confidence in 0..1 |
| `redact_pii` | `text` | Replace every email address and phone number in the input text with [REDACTED], leaving all other text unchanged. | no email or phone pattern left; `[REDACTED]` present when the input had PII |
| `json_extract` | `text, fields` | Extract a caller-specified list of fields from a blob of text into a JSON object. Each requested field becomes a key; the value is null when the field is absent from the text. | `data` is an object with every requested field as a key |
| `fix_json` | `text` | Repair malformed or loosely-formatted JSON text into a valid JSON value. | `json` is an object or array |
| `extract_dates` | `text` | Extract every date referenced in a piece of text, normalized to ISO format YYYY-MM-DD. | each is a real calendar date in `YYYY-MM-DD` |
| `categorize` | `text, categories` | Choose the single best-fitting category for a piece of text from a provided list of categories. | exactly one of the given categories |
| `translate` | `text, target_language` | Translate a piece of text into a given target language. | non-empty; at most 5x the input length + 20 |
| `detect_language` | `text` | Detect the natural language of text. | non-empty name; two-letter lowercase ISO 639-1 code |

Inputs ending in `?` are optional. The first three columns come from the command manifests
(`npm test` fails if they drift); the full JSON Schemas are what the MCP server advertises.

## How it works

```
input -> inputSchema check -> run the command -> verify -> ok? -> result
                                 ^                  | no
                                 +-- retry with the verifier's feedback (model-backed, up to maxAttempts)
                                                    | still no
                                     declared fallbacks -> freeform (plain Claude, same schema, same verifier)
```

- **Contracts with mandatory verifiers.** Each command is `commands/<name>/index.ts`: a manifest
  (input and output JSON Schema, determinism, prompts, fallbacks) plus a `verify()` export. A
  command without a verifier cannot be registered (`src/library.ts`, `src/registry.ts`).
  Mechanical checks come first (schema, regex, recompute, **grounding**); `llmJudge` in
  `src/verify.ts` exists for criteria no code can express.
- **Precondition gate.** Input that breaks the command's `inputSchema` is rejected before anything
  runs, with a message that names the problem.
- **Determinism gradient.** `pure` commands are deterministic code: run once, cached, free, and
  never sent to a model. `stochastic` commands are run by the model and retried with feedback.
  `effectful` is reserved for commands that will need a human gate.
- **Fallback to freeform.** Every model-backed ladder ends at plain Claude, held to the same output
  schema and verifier, so the conductor never does worse than a raw call, only better when a
  verified command applies.
- **Hermetic calls.** Every model call (`src/cc.ts`) replaces the system prompt
  (`--system-prompt`), loads no settings (`--setting-sources ""`), enables no tools
  (`--tools ""`), saves no session, and constrains the answer with `--json-schema`. This matters:
  a naive call once returned the operator's own email instead of the one in the input, because
  ambient context (global CLAUDE.md, identity, hooks) leaked in.
- **Composition.** `runPipeline` (`src/pipeline.ts`) chains commands; each step is verified before
  the next runs, so errors cannot silently compound.
- **Telemetry and routing.** Every attempt is a JSONL line. `npm run scores` prints per-command
  reliability from the CLI and eval logs, and `route()` (`src/router.ts`) shows those rates to a
  small model that must pick from an enum of command names.

## Configuration

| Setting | Default | Effect |
|---|---|---|
| `CONDUCTOR_HOME` env var | `~/.conductor` | Where the MCP server appends `telemetry.jsonl` |
| `model` in a manifest | `sonnet` | Model for that command's calls (the router and `llmJudge` use `haiku`) |
| `maxAttempts` in a manifest | `2` | Tries with feedback before the next fallback rung (pure commands run once) |

Model-backed calls use whatever account the `claude` CLI is logged into.

## Results (measured by the author)

Evals compare a single naive `claude -p` call with the conductor on the same inputs:

- **Single-shot extraction** (`eval/run-eval.ts`): baseline 100% vs conductor 100%. On easy
  single-shot tasks a frontier model is already reliable, so there is no gap to close.
- **Composition** (`eval/contact-card.ts`, extract_contact -> normalize_phone -> slugify): baseline
  80% vs conductor 100%. The baseline emitted a phone number with an invisible Unicode character;
  the deterministic `normalize_phone` step is structurally immune to that class of error. Cost:
  the conductor made more calls, about 2x the baseline.

The reliability gap grows with composition depth and machine-consumed output, not with single easy
calls. The evals call `claude` and cost money; rerun them with `REPEATS=2 npx tsx eval/run-eval.ts`,
`REPEATS=2 npx tsx eval/contact-card.ts` and `REPEATS=1 npx tsx eval/triage.ts` (a 4-step pipeline).

## Add a command

1. Create `commands/<name>/index.ts`. A pure command exports `manifest`, `run` and `verify`:

   ```ts
   import type { CommandManifest, SolveContext, Verdict } from "../../src/types.js";
   import { check, combine } from "../../src/verify.js";

   export const manifest: CommandManifest = {
     name: "reverse_text", // must equal the directory name
     description: "Reverse the characters of a string.",
     determinism: "pure",
     trust: "human-verified",
     inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
     outputSchema: { type: "object", properties: { reversed: { type: "string" } }, required: ["reversed"], additionalProperties: false },
     fallbacks: [],
     effectful: false,
   };

   export async function run(input: { text: string }): Promise<{ reversed: string }> {
     return { reversed: [...input.text].reverse().join("") };
   }

   export async function verify(output: { reversed: string }, input: { text: string }, _ctx: SolveContext): Promise<Verdict> {
     return combine(
       check("string", typeof output?.reversed === "string", "reversed must be a string"),
       check("round-trip", [...(output?.reversed ?? "")].reverse().join("") === input.text, "reversing the output must give the input back"),
     );
   }
   ```

   A model-backed command sets `determinism: "stochastic"`, leaves out `run`, and adds
   `systemPrompt`, `promptTemplate`, `model`, `maxAttempts` and `fallbacks: ["freeform"]`; its
   `verify` checks the model's answer (see `commands/extract_contact/index.ts`).
2. Add `commands/<name>/tests/cases.json`, a list of `{ "input": ..., "expect"?: ... }`.
3. Import the module in `src/library.ts` and add it to `MODULES` (the bundle cannot scan
   directories).
4. Add a row to the right table above. `npm test` checks contracts, runs pure commands against
   their cases, and prints the exact README row it expects.
5. `npm run build` and commit `dist/conductor-mcp.cjs`, which is what the plugin runs.

## Development

```bash
npm ci
npm test            # hermetic: a fake `claude` on PATH, no model calls, no network
npm run typecheck
npm run build       # rebuild dist/conductor-mcp.cjs and commit it (CI fails if it is stale)
npm run mcp         # run the server from source over stdio
npm run scores      # reliability scoreboard from projects/*/telemetry.jsonl

# These call the real claude CLI and cost money:
npx tsx eval/run-tests.ts [command]   # each command's tests/cases.json through the full loop
npm run eval                          # eval/run-eval.ts
```

`npm run release [patch|minor|major]` bumps the version in `package.json` and both plugin
manifests, rebuilds, commits and pushes; installed users then get it from
`claude plugin update conductor@conductor`.

```
src/
  mcp.ts         MCP server: one tool per command, every call through solve()
  solve.ts       the loop: input check -> execute -> verify -> retry -> fallback
  schema.ts      the JSON Schema subset used by command contracts
  cc.ts          one hermetic `claude -p` call
  verify.ts      verifier helpers: check/combine, zod schema, email/phone patterns, llmJudge
  pipeline.ts    compose verified commands
  router.ts      reliability-weighted command choice
  telemetry.ts   JSONL log + per-command scores
  library.ts     static command list (what the bundle ships)
  registry.ts    directory scan used by the CLI and evals
  cli.ts         manual driver
  scores.ts      prints the scoreboard
commands/<name>/ index.ts (manifest + run? + verify) and tests/cases.json
eval/            baseline-vs-conductor evals (paid)
test/            node:test suite (free)
dist/            committed bundle the plugin runs
```

## Limitations and FAQ

- **Model-backed tools need the `claude` CLI** logged in, and each attempt is a separate
  `claude -p` process, so expect seconds per call and usage on your account. Pure tools need
  neither.
- **Verifiers are mechanical.** They catch format, grounding and budget violations, not every
  semantic error: `categorize` can pick an allowed but wrong category, and a summary can be within
  budget and still miss the point. No shipped command uses `llmJudge` yet.
- **Some detectors are heuristics.** `redact_pii` treats any long run of digits and separators as
  a phone number, so ISO dates or order numbers in the output fail the check and may get
  redacted on retry. `summarize` counts sentences by `.`, `!` and `?`, so abbreviations count.
- **Telemetry stays on your machine** (`~/.conductor/telemetry.jsonl` for the MCP server,
  `projects/` for the CLI and evals). Inputs go nowhere except the `claude -p` calls themselves.
- **Opening this repo as a Claude Code project** shows a failed `conductor` server from
  `.mcp.json`; `${CLAUDE_PLUGIN_ROOT}` only expands in an installed plugin. That is harmless.
- **Not built yet:** model-driven decomposition (pipelines are explicit), human gates for
  `effectful` commands, routing inside the MCP server (the client model picks tools itself),
  turning traces into new commands, and RL on the router.

## License

[MIT](LICENSE)
