import { z } from "zod";
import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { recommendPlan } from "@/lib/analyzer/plan";
import { aiConfigured, callLLM } from "@/lib/ai/llm";

export const maxDuration = 90;

const Body = z.object({
  report: z.object({ platform: z.string(), framework: z.string(), port: z.number(), heavyDeps: z.boolean(), needsDb: z.boolean(), envHints: z.array(z.string()).default([]), warnings: z.array(z.string()).default([]), fileCount: z.number() }),
  dailyUsers: z.number().min(0),
  maxBudgetToman: z.number().optional(),
  fileName: z.string().default("app"),
});

const slug = (s: string) => s.toLowerCase().replace(/\.zip$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

/** "Do everything for me" path: pick platform, name, network and the cheapest sufficient plan; the LLM only writes the summary. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = Body.parse(await req.json());
    const L = liara();
    const platform = b.report.platform === "dotnet" ? "netcore" : b.report.platform;
    const plans = await L.getPlans();
    const rec = recommendPlan({ platform: b.report.platform, dailyUsers: b.dailyUsers, needsDb: b.report.needsDb, heavyDeps: b.report.heavyDeps, maxBudgetToman: b.maxBudgetToman }, plans);
    const plan = plans.find((p) => p.id === rec.planID)!;

    // a free app id (names are unique across Liara)
    let base = slug(b.fileName) || "my-app";
    if (base.length < 3) base = `app-${base}`;
    let name = base;
    for (let i = 0; i < 6 && !(await L.checkName(name)); i++) name = `${base}-${Math.random().toString(36).slice(2, 6)}`;

    const nets = await L.listNetworks();
    const network = nets[0] ? { id: nets[0]._id, name: nets[0].name, created: false } : { id: "auto", name: "my-network", created: true };

    let summary = "";
    let usedAI = false;
    if (aiConfigured()) {
      try {
        const { message } = await callLLM({
          messages: [
            { role: "system", content: "تو دستیار DevOps لیارا هستی. در ۲ تا ۳ جمله‌ی کوتاه و ساده‌ی فارسی (بدون مارک‌داون و بدون اصطلاح فنی سنگین) به کاربر مبتدی بگو چه برنامه‌ای تشخیص دادی، چه پلنی انتخاب کردی و چرا. هزینه را فقط با همان عدد ماهانه‌ی داده‌شده بگو." },
            { role: "user", content: JSON.stringify({ تشخیص: b.report.framework, پلتفرم: platform, دیتابیس: b.report.needsDb, کتابخانه_سنگین: b.report.heavyDeps, بازدید_روزانه: b.dailyUsers, پلن: `${plan.name} (${plan.ramGB}GB رم، ${plan.cpu} هسته)`, هزینه_ماهانه_تومان: rec.monthlyPrice, نام_برنامه: name, هشدارها: b.report.warnings }) },
          ],
          max_tokens: 300,
        }, { source: "wizard", note: "beginner summary" });
        summary = String(message.content ?? "").trim();
        usedAI = !!summary;
      } catch { /* fall back to the deterministic text below */ }
    }
    if (!summary) summary = `${b.report.framework} تشخیص داده شد. پلن «${plan.name}» (${plan.ramGB} گیگ رم) کافی است و ماهانه ${rec.monthlyPrice.toLocaleString("fa-IR")} تومان هزینه دارد.`;

    return {
      platform, name, network, usedAI, summary, reasons: rec.reasons,
      plan: { id: plan.id, name: plan.name, ramGB: plan.ramGB, cpu: plan.cpu, volume: plan.volume, bundleID: plan.bundleID, monthly: plan.monthly, hourly: plan.price },
      port: b.report.port,
    };
  });
