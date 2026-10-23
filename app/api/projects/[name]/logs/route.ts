import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { redactText } from "@/lib/redact";

export const dynamic = "force-dynamic";
export const GET = (req: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const { name } = await params;
    const u = new URL(req.url);
    const minutes = Math.min(1440 * 7, Math.max(5, Number(u.searchParams.get("minutes") ?? 60)));
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    const rel = u.searchParams.get("release");
    const [logs, releases] = await Promise.all([liara().getLogs(name, minutes * 60), liara().getReleases(name)]);
    const asc = [...releases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const out = logs
      .map((l) => ({ ...l, version: asc.findIndex((r) => r.id === l.release) + 1 || null, message: redactText(l.message) }))
      .filter((l) => (!q || l.message.toLowerCase().includes(q)) && (!rel || l.release === rel));
    return { logs: out.slice(-500), total: out.length, releases: asc.map((r, i) => ({ id: r.id, version: i + 1 })) };
  });
