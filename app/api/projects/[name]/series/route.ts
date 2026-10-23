import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";

export const dynamic = "force-dynamic";
const KINDS = ["cpu", "memory", "network-receive", "network-transmit"] as const;
export const GET = (req: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const { name } = await params;
    const u = new URL(req.url);
    const minutes = Math.min(1440 * 7, Math.max(5, Number(u.searchParams.get("minutes") ?? 60)));
    const plan = (await liara().getPlans().catch(() => []))[0];
    const out: Record<string, { t: number; v: number }[]> = {};
    await Promise.all(KINDS.map(async (k) => { out[k] = await liara().getSeries(name, k, minutes * 60).catch(() => []); }));
    return { minutes, series: out, hint: plan ? undefined : undefined };
  });
