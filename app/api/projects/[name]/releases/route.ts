import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";

export const dynamic = "force-dynamic";
export const GET = (_: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const all = await liara().getReleases((await params).name);
    const asc = [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { releases: all.slice(0, 30).map((r) => ({ ...r, version: asc.findIndex((x) => x.id === r.id) + 1 })) };
  });
