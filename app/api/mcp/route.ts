import { timingSafeEqual } from "node:crypto";
import { boot } from "@/lib/api";
import { TOOLS, execute, tool } from "@/lib/ai/tools";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Model Context Protocol server (Streamable HTTP, JSON-RPC 2.0) for LiaraPilot.
 * Any MCP client can connect with the token from Settings. Read tools run directly; EVERY tool that changes
 * something only creates a pending approval — the user approves it in the panel before anything executes.
 */
const INFO = { name: "liarapilot", version: "1.0.0" };
const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

const exposed = () => {
  const { access } = getState().settings.mcp;
  return TOOLS.filter((t) => t.name !== "advice" && (access === "propose" || t.risk === "read"));
};

async function handleMessage(m: any) {
  const { id, method, params } = m ?? {};
  if (method === "initialize") return ok(id, { protocolVersion: params?.protocolVersion ?? "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: INFO, instructions: "LiaraPilot manages Liara PaaS apps. Diagnose with diagnose_project; fixes (plan change, restart, port, dependency fix, ...) are PROPOSALS that the human approves in the panel — poll get_approval_status afterwards. Never ask for secrets." });
  if (method === "ping") return ok(id, {});
  if (method?.startsWith("notifications/")) return null; // no response for notifications
  if (method === "tools/list") {
    return ok(id, {
      tools: exposed().map((t) => ({
        name: t.name,
        description: `${t.description}${t.risk === "read" ? "" : " [changes things: creates a pending approval, nothing runs until the user approves]"}`,
        inputSchema: t.parameters,
      })),
    });
  }
  if (method === "tools/call") {
    const name = params?.name as string;
    const t = tool(name);
    if (!t || !exposed().some((x) => x.name === name)) return err(id, -32602, `Unknown or not permitted tool: ${name}`);
    const out = await execute(name, params?.arguments ?? {}, { actor: "mcp", source: "mcp", requireApproval: true, reason: "درخواست از طریق MCP" });
    if (out.status === "pending_approval")
      return ok(id, { content: [{ type: "text", text: JSON.stringify({ status: "pending_approval", approvalId: out.approvalId, title: out.title, impact: out.impact, message: "NOT executed yet. The user must approve it in LiaraPilot (Admin → تأییدیه‌ها). Poll get_approval_status with this id." }, null, 2) }] });
    if (out.status === "error") return ok(id, { isError: true, content: [{ type: "text", text: out.error }] });
    return ok(id, { content: [{ type: "text", text: JSON.stringify(out.result, null, 2).slice(0, 20_000) }] });
  }
  return err(id, -32601, `Method not found: ${method}`);
}

function authorized(req: Request) {
  const { token, enabled } = getState().settings.mcp;
  if (!enabled || !token) return "disabled" as const;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? ("ok" as const) : ("denied" as const);
}

export async function POST(req: Request) {
  boot();
  const auth = authorized(req);
  if (auth === "disabled") return Response.json(err(null, -32000, "MCP access is disabled. Enable it in LiaraPilot → Settings."), { status: 403 });
  if (auth === "denied") return Response.json(err(null, -32001, "Invalid token."), { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return Response.json(err(null, -32700, "Parse error"), { status: 400 }); }
  const run = async (m: any) => { try { return await handleMessage(m); } catch (e: any) { return err(m?.id ?? null, -32603, e?.message ?? "Internal error"); } };
  if (Array.isArray(body)) {
    const res = (await Promise.all(body.map(run))).filter(Boolean);
    return res.length ? Response.json(res) : new Response(null, { status: 202 });
  }
  const res = await run(body);
  return res ? Response.json(res) : new Response(null, { status: 202 });
}

// Streamable HTTP clients may probe with GET for a server->client stream; we do not offer one.
export const GET = () => new Response("MCP endpoint: POST JSON-RPC here.", { status: 405, headers: { Allow: "POST" } });
