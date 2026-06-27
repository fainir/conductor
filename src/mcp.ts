// mcp.ts — exposes the conductor's verified commands to any MCP client
// (Claude Code, Claude Desktop, etc.) as native tools.
//
// Each command becomes a tool whose input schema IS the command's contract
// (manifest.inputSchema). Every call routes through solve(), so the model gets
// verify + retry + fallback for free. Stochastic commands still spawn their own
// HERMETIC `claude -p` sub-calls, so the host session's context can't pollute them.
//
// stdout is reserved for JSON-RPC; everything diagnostic goes to stderr.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { library } from "./library.js";
import { solve } from "./solve.js";

const registry = library();
const HOME = process.env.CONDUCTOR_HOME ?? join(homedir(), ".conductor");
mkdirSync(HOME, { recursive: true });
const telemetryFile = join(HOME, "telemetry.jsonl");

const server = new Server({ name: "conductor", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...registry.values()].map((c) => ({
    name: c.manifest.name,
    description: `${c.manifest.description} [conductor: verified ${c.manifest.determinism} command]`,
    inputSchema: c.manifest.inputSchema as any,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as any;
  if (!registry.has(name)) {
    return { content: [{ type: "text", text: `Unknown conductor command: ${name}` }], isError: true };
  }
  const res = await solve({ registry, command: name, goal: name, telemetryFile, cwd: tmpdir() }, args);
  const payload = { ok: res.ok, output: res.output, via: res.command, attempts: res.attempts, verdict: res.verdict };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: !res.ok };
});

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`conductor MCP server up — ${registry.size} verified commands`);
}

main().catch((e) => {
  console.error("conductor MCP fatal:", e);
  process.exit(1);
});
