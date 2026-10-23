import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";

export const dynamic = "force-dynamic";
export const GET = (_: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const { name } = await params;
    const [events, releases] = await Promise.all([liara().getEvents(name), liara().getReleases(name)]);
    const asc = [...releases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const version = (id?: string) => { const i = asc.findIndex((r) => r.id === id); return i >= 0 ? i + 1 : null; };
    return { events: events.map((e) => ({ ...e, version: version(e.release) })).sort((a, b) => b.time - a.time) };
  });
