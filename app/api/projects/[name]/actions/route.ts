import { z } from "zod";
import { handle } from "@/lib/api";
import { execute } from "@/lib/ai/tools";

// Direct user actions from the UI. The UI shows a confirm dialog for sensitive ones first.
const Body = z.object({ tool: z.enum(["restart_project", "turn_project", "change_plan", "update_envs", "delete_project", "update_port", "rollback_release", "set_flag", "fix_dependencies", "fix_code"]), args: z.record(z.string(), z.unknown()).default({}) });

export const POST = (req: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const { name } = await params;
    const b = Body.parse(await req.json());
    const out = await execute(b.tool, { ...b.args, name }, { actor: "user", source: "chat", force: true });
    if (out.status === "error") throw Object.assign(new Error(out.error), { status: 502 });
    return out;
  });
