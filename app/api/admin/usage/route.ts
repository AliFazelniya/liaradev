import { handle } from "@/lib/api";
import { aiConfig, getState } from "@/lib/store";

export const dynamic = "force-dynamic";

const dayKey = (iso: string) => iso.slice(0, 10);

export const GET = (req: Request) =>
  handle(async () => {
    const q = new URL(req.url).searchParams;
    const size = Math.min(100, Math.max(5, Number(q.get("size")) || 15)), page = Math.max(1, Number(q.get("page")) || 1);
    const st = getState();
    const u = st.usage;
    const sum = (arr: typeof u) => arr.reduce((a, x) => ({ calls: a.calls + 1, prompt: a.prompt + x.promptTokens, hit: a.hit + x.cacheHitTokens, completion: a.completion + x.completionTokens, cost: a.cost + x.costUSD }), { calls: 0, prompt: 0, hit: 0, completion: 0, cost: 0 });
    const today = dayKey(new Date().toISOString());
    const bySource: Record<string, ReturnType<typeof sum>> = {};
    for (const x of u) bySource[x.source] = sum([...(bySource[x.source] ? [] : []), ...u.filter((y) => y.source === x.source)]);
    const days: Record<string, ReturnType<typeof sum>> = {};
    for (const d of [...new Set(u.map((x) => dayKey(x.at)))]) days[d] = sum(u.filter((x) => dayKey(x.at) === d));
    return {
      pricing: st.settings.pricing,
      provider: aiConfig().label || aiConfig().baseUrl,
      model: aiConfig().model,
      total: sum(u),
      today: sum(u.filter((x) => dayKey(x.at) === today)),
      bySource,
      byDay: Object.entries(days).sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([day, v]) => ({ day, ...v })),
      recent: [...u].reverse().slice((page - 1) * size, page * size),
      recentTotal: u.length,
      liaraCalls: Object.entries(st.liaraCalls).sort((a, b) => b[1] - a[1]).map(([endpoint, count]) => ({ endpoint, count })),
      liaraTotal: Object.values(st.liaraCalls).reduce((a, b) => a + b, 0),
    };
  });
