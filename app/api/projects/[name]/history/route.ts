import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { projectHistory } from "@/lib/monitor/history";

export const dynamic = "force-dynamic";
/** What was done to this app (plan changes, restarts, fixes…), newest first. */
export const GET = (_: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => { const name = (await params).name; return { history: projectHistory(name, 30, (await liara().getProject(name)).created_at) }; });
