import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { zipFromForm } from "@/lib/uploads";
import { readZip } from "@/lib/analyzer/codebase";
import { planStack, tierPlan } from "@/lib/ai/architect";
import { appName, dbHost, plans } from "@/lib/stack/run";
import { uid } from "@/lib/store";

export const maxDuration = 120;

/** Designs the stack (AI + validation) and returns it for the user to review. Creates nothing. */
export const POST = (req: Request) =>
  handle(async () => {
    const fd = await req.formData();
    const base = String(fd.get("base") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 18);
    if (base.length < 3) throw Object.assign(new Error("نام پایه حداقل ۳ حرف انگلیسی/عدد باشد."), { status: 400 });
    const files = readZip(await zipFromForm(fd));
    const { plan, components } = await planStack(files, { baseName: base });
    const L = liara();
    const [appPlans, cat] = await Promise.all([L.getPlans(), plan.databases.length ? L.getDbCatalog() : Promise.resolve(null)]);
    for (const c of plan.components) c.name = appName(base, c.id);
    // names must be free before anything is created
    const taken: string[] = [];
    await Promise.all([...plan.components.map((c) => c.name), ...plan.databases.map((d) => dbHost(base, d.id))].map(async (n) => { if (!(await L.checkName(n).catch(() => true))) taken.push(n); }));
    const appCost = plan.components.reduce((n, c) => n + (appPlans.find((p) => p.id === tierPlan(c.tier))?.monthly ?? 0), 0);
    const dbCost = plan.databases.reduce((n, d) => { const p = cat?.plans.find((x) => x.id === tierPlan(d.tier) && x.types.includes(d.type)); return n + (p ? p.hourlyToman * 720 + (p.bundles.find((b) => b.id === "basic")?.monthlyToman ?? 0) : 0); }, 0);
    const planId = uid();
    plans.set(planId, { files, components, plan, base, at: Date.now() });
    for (const [k, v] of plans) if (Date.now() - v.at > 3600_000) plans.delete(k);
    return { planId, base, plan, taken, estimate: { apps: Math.round(appCost), databases: Math.round(dbCost), total: Math.round(appCost + dbCost) } };
  });
