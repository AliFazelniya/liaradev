import { z } from "zod";
import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { execute } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";

/** App list with the live RAM/CPU usage the console shows in its "گزارش لحظه‌ای" column. */
export const GET = () =>
  handle(async () => {
    const L = liara();
    const [projects, plans, nets] = await Promise.all([L.listProjects(), L.getPlans().catch(() => []), L.listNetworks().catch(() => [])]);
    const rows = await Promise.all(
      projects.map(async (p) => {
        const plan = plans.find((x) => x.id === p.planID);
        const sum = await L.getSummary(p.project_id).catch(() => ({ cpuCores: null, memBytes: null }));
        return {
          ...p,
          planName: plan?.name ?? p.planID,
          cpuPct: sum.cpuCores !== null && plan ? Math.min(100, (sum.cpuCores / plan.cpu) * 100) : null,
          memPct: sum.memBytes !== null && plan ? Math.min(100, (sum.memBytes / (plan.ramGB * 1024 ** 3)) * 100) : null,
          networkName: (p as any).network?.name ?? nets[0]?.name ?? null,
        };
      }),
    );
    return { projects: rows };
  });

// Explicit creation from the wizard (the user pressed "create" after seeing the plan + price).
const Body = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{2,30}$/, "نام فقط حروف کوچک انگلیسی، عدد و خط تیره (حداقل ۳ حرف)"), planID: z.string(), platform: z.string(), bundlePlanID: z.string().optional(), network: z.string().optional() });
export const POST = (req: Request) =>
  handle(async () => {
    const out = await execute("create_project", Body.parse(await req.json()), { actor: "user", source: "wizard", force: true });
    if (out.status === "error") throw Object.assign(new Error(out.error), { status: 502 });
    return out;
  });
