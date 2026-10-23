import { z } from "zod";
import { handle } from "@/lib/api";
import { resolveApproval } from "@/lib/ai/tools";
import { liara } from "@/lib/liara";
import { getState, save } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Drop pending approvals whose app no longer exists (deleted here or in the Liara console). */
async function pruneOrphans() {
  const st = getState();
  const pending = st.approvals.filter((a) => a.status === "pending" && a.tool !== "create_project" && typeof a.args?.name === "string");
  if (!pending.length) return;
  try {
    const live = new Set((await liara().listProjects()).map((p) => p.project_id));
    const gone = new Set(pending.filter((a) => !live.has(a.args.name as string)).map((a) => a.id));
    if (!gone.size) return;
    st.approvals = st.approvals.filter((a) => !gone.has(a.id));
    save();
  } catch { /* Liara unreachable: keep everything */ }
}
export const GET = () => handle(async () => (await pruneOrphans(), { approvals: [...getState().approvals].reverse(), audit: [...getState().audit].reverse().slice(0, 50), mode: getState().settings.mode }));
export const POST = (req: Request) =>
  handle(async () => {
    const b = z.object({ id: z.string(), approve: z.boolean() }).parse(await req.json());
    return resolveApproval(b.id, b.approve);
  });
