// Smoke test of the shipped bundle (dist/conductor-mcp.cjs): the exact file the
// plugin runs. Spawns it over stdio with a real MCP client and calls pure tools only.
// Run `npm run build` after changing src/ so the bundle matches.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { library } from "../src/library.js";
import { installFakeClaude } from "./helpers/fake-claude.js";

const root = resolve(import.meta.dirname, "..");
const bundle = resolve(root, "dist/conductor-mcp.cjs");
const home = mkdtempSync(join(tmpdir(), "conductor-home-"));
const fake = installFakeClaude(); // so a regression that reaches for the model can't hit a real one

const client = new Client({ name: "conductor-test", version: "0.0.0" });

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    env: { PATH: process.env.PATH ?? "", CONDUCTOR_HOME: home },
    stderr: "pipe",
  });
  await client.connect(transport);
});

after(async () => {
  await client.close();
  fake.uninstall();
});

function payload(res: Awaited<ReturnType<typeof client.callTool>>): any {
  const [first] = res.content as { type: string; text: string }[];
  assert.equal(first.type, "text");
  return JSON.parse(first.text);
}

test("initialize: the server identifies itself as conductor", () => {
  assert.equal(client.getServerVersion()?.name, "conductor");
});

test("tools/list: one tool per registered command, with the command's input schema", async () => {
  const { tools } = await client.listTools();
  const registry = library();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...registry.keys()].sort());
  const b64 = tools.find((t) => t.name === "base64_encode")!;
  assert.deepEqual(b64.inputSchema, registry.get("base64_encode")!.manifest.inputSchema);
  assert.match(b64.description ?? "", /\[conductor: verified pure command\]$/);
});

test("tools/call: a pure tool answers deterministically with no model call", async () => {
  const res = await client.callTool({ name: "base64_encode", arguments: { text: "hello" } });
  assert.equal(res.isError, false);
  assert.deepEqual(payload(res), { ok: true, output: { encoded: "aGVsbG8=" }, via: "base64_encode", attempts: 1, verdict: { ok: true, score: 1 } });
  const slug = payload(await client.callTool({ name: "slugify", arguments: { text: "Hello, World!" } }));
  assert.deepEqual(slug.output, { slug: "hello-world" });
  assert.equal(fake.calls().length, 0);
});

test("tools/call: telemetry goes to CONDUCTOR_HOME", () => {
  assert.ok(existsSync(join(home, "telemetry.jsonl")));
  assert.match(readFileSync(join(home, "telemetry.jsonl"), "utf8"), /"command":"base64_encode"/);
});

test("tools/call: an unknown tool is an error result, not a crash", async () => {
  const res = await client.callTool({ name: "does_not_exist", arguments: {} });
  assert.equal(res.isError, true);
  assert.match((res.content as { text: string }[])[0].text, /Unknown conductor command: does_not_exist/);
});
