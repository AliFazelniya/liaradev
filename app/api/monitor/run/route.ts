import { handle } from "@/lib/api";
import { runSweep } from "@/lib/monitor/scheduler";

export const maxDuration = 120;
export const POST = (req: Request) =>
  handle(async () => ({ reports: await runSweep("user", new URL(req.url).searchParams.get("project") ?? undefined) }));
