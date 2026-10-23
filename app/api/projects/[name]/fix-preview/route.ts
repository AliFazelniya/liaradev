import { handle } from "@/lib/api";
import { loadCodeFix, loadDependencyFix } from "@/lib/ai/tools";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** What the automatic dependency fix would change — shown to the user before they approve it. */
export const GET = (req: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const name = (await params).name;
    const u = new URL(req.url);
    if (u.searchParams.get("kind") === "code") {
      const { fix } = await loadCodeFix(name, u.searchParams.get("error") ?? undefined);
      return { changes: fix.edits.map((e) => ({ from: `${e.file}\n${e.search}`, to: e.replace, reason: e.reason })), blocked: fix.blocked, explanation: fix.explanation };
    }
    const { fix } = await loadDependencyFix(name);
    return { changes: fix.changes, blocked: fix.blocked };
  });
