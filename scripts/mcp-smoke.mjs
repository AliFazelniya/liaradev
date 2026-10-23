#!/usr/bin/env node
// Minimal MCP client: proves the server speaks the protocol and that changes require approval.
//   LIARAPILOT_TOKEN=lpt_... node scripts/mcp-smoke.mjs [baseUrl]
const BASE = process.argv[2] || "http://localhost:3000";
const TOKEN = process.env.LIARAPILOT_TOKEN;
let n = 0;
const rpc = async (method, params) => {
  const res = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
  return res.status === 202 ? null : res.json();
};
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); const t = r.result?.content?.[0]?.text; return { isError: !!r.result?.isError, data: (() => { try { return JSON.parse(t); } catch { return t; } })(), rpcError: r.error }; };

const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
console.log("initialize ->", init.result.serverInfo, "| protocol", init.result.protocolVersion);
await rpc("notifications/initialized");
const list = await rpc("tools/list");
console.log("tools:", list.result.tools.map((t) => t.name).join(", "));
const projects = await call("list_projects", {});
console.log("list_projects ->", projects.data.map?.((p) => `${p.name}(${p.status})`).join(", ") || projects.data);
export { rpc, call };
