import { z } from "zod";
import { handle } from "@/lib/api";
import { getState, maskedSettings, save } from "@/lib/store";
import { ensureScheduler } from "@/lib/monitor/scheduler";

export const dynamic = "force-dynamic";
const Body = z.object({
  mode: z.enum(["assistant", "autopilot", "auto"]).optional(),
  level: z.enum(["manual", "assistant"]).optional(),
  mcpEnabled: z.boolean().optional(),
  mcpAccess: z.enum(["read", "propose"]).optional(),
  pricing: z.object({ hit: z.number().min(0), miss: z.number().min(0), out: z.number().min(0) }).optional(),
  monitorEveryMinutes: z.number().min(1).max(1440).optional(),
  monitorEnabled: z.boolean().optional(),
  aiKey: z.string().optional(),
  aiLabel: z.string().max(40).optional(),
  aiBaseUrl: z.union([z.string().url(), z.literal("")]).optional(),
  liaraBase: z.union([z.string().url(), z.literal("")]).optional(),
  aiModel: z.string().max(80).optional(),
  liaraToken: z.string().optional(),
  teamID: z.string().optional(),
});
export const GET = () => handle(async () => maskedSettings());
export const PUT = (req: Request) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    const s = getState().settings;
    // Experience level drives how much the assistant is allowed to do on its own.
    if (b.level && !b.mode) b.mode = b.level === "assistant" ? "autopilot" : "assistant";
    if (b.mcpEnabled !== undefined) { s.mcp.enabled = b.mcpEnabled; if (b.mcpEnabled && !s.mcp.token) s.mcp.token = "lpt_" + (await import("node:crypto")).randomBytes(24).toString("hex"); }
    if (b.mcpAccess) s.mcp.access = b.mcpAccess;
    delete b.mcpEnabled; delete b.mcpAccess;
    for (const [k, v] of Object.entries(b)) if (v !== undefined && !(typeof v === "string" && v.includes("••••"))) (s as any)[k] = v;
    save();
    ensureScheduler();
    return maskedSettings();
  });
