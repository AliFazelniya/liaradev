#!/usr/bin/env node
// stdio <-> HTTP bridge so MCP clients that only speak stdio (e.g. Claude Desktop) can use LiaraPilot.
//   LIARAPILOT_URL=http://localhost:3000  LIARAPILOT_TOKEN=lpt_...  node scripts/mcp-stdio.mjs
import readline from "node:readline";

const BASE = (process.env.LIARAPILOT_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.LIARAPILOT_TOKEN || "";
if (!TOKEN) { console.error("Set LIARAPILOT_TOKEN (Settings → AI access in LiaraPilot)."); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const res = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: line });
    const text = await res.text();
    if (text) process.stdout.write(text.replace(/\n/g, "") + "\n");
  } catch (e) {
    let id = null; try { id = JSON.parse(line).id ?? null; } catch {}
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } }) + "\n");
  }
}
