import type { PlanInfo } from "../liara/types";

export interface PlanQuestionnaire {
  platform: string; // static | node | next | python | php | laravel | java | dotnet | go | docker
  dailyUsers: number; // expected daily visitors
  peakConcurrent?: number;
  needsDb?: boolean;
  heavyDeps?: boolean; // puppeteer, sharp, ML libs, ...
  maxBudgetToman?: number; // monthly
}

export const HOURS_PER_MONTH = 720;
export const monthly = (p: { monthly: number }) => p.monthly;

export interface PlanRecommendation {
  planID: string;
  planName: string;
  price: number; // toman / hour
  monthlyPrice: number; // toman / month as shown by Liara
  bundleID: string;
  ramGB: number;
  neededRamGB: number;
  reasons: string[];
  alternatives: { planID: string; planName: string; price: number /* monthly */; note: string }[];
  upgradePath: string | null;
  accountNote?: string;
}

const BASE_RAM: Record<string, number> = {
  static: 0.25, go: 0.25, node: 0.5, python: 0.5, php: 0.5, laravel: 0.5, docker: 0.5, next: 1, java: 1.5, dotnet: 1,
};

export function recommendPlan(q: PlanQuestionnaire, plans: PlanInfo[]): PlanRecommendation {
  const reasons: string[] = [];
  let need = BASE_RAM[q.platform] ?? 0.5;
  reasons.push(`نوع پروژه (${q.platform}) حداقل حدود ${need}GB رم لازم دارد.`);

  const users = q.dailyUsers;
  const conc = q.peakConcurrent ?? Math.ceil(users / 200);
  if (users > 50_000 || conc > 400) { need += 2; reasons.push("ترافیک بالا: ۲GB رم اضافه برای هم‌زمانی زیاد."); }
  else if (users > 10_000 || conc > 100) { need += 1; reasons.push("ترافیک متوسط‌رو‌به‌بالا: ۱GB رم اضافه."); }
  else if (users > 2_000 || conc > 30) { need += 0.5; reasons.push("ترافیک متوسط: ۰٫۵GB رم اضافه."); }
  else reasons.push(`با حدود ${users.toLocaleString("fa-IR")} بازدید در روز، نیازی به پلن بزرگ نیست.`);

  if (q.heavyDeps) { need += 1; reasons.push("کتابخانه‌های سنگین (مثل puppeteer/sharp/ML) رم بیشتری مصرف می‌کنند."); }
  if (q.needsDb && q.platform !== "static") { need += 0.25; reasons.push("اتصال به دیتابیس کمی رم اضافه می‌خواهد (خود دیتابیس سرویس جداست)."); }

  const usable = plans.filter((p) => p.available);
  const sorted = [...usable].sort((a, b) => a.price - b.price || a.ramGB - b.ramGB);
  const fits = (p: PlanInfo) => p.ramGB >= need;
  if (!sorted.length) throw Object.assign(new Error("هیچ پلن قابل خریدی برای این حساب در لیارا فعال نیست (اعتبار حساب را بررسی کنید)."), { status: 402 });
  let chosen = sorted.find((p) => fits(p) && (!q.maxBudgetToman || monthly(p) <= q.maxBudgetToman));
  if (!chosen) {
    chosen = sorted.find(fits) ?? sorted[sorted.length - 1];
    if (q.maxBudgetToman && monthly(chosen) > q.maxBudgetToman)
      reasons.push(`⚠️ ارزان‌ترین پلن مناسب (حدود ${monthly(chosen).toLocaleString("fa-IR")} تومان در ماه) از بودجه شما بیشتر است.`);
  }
  reasons.push("همیشه ارزان‌ترین پلنی که نیاز را پوشش بدهد انتخاب می‌شود؛ هر وقت لازم شد می‌توان ارتقا داد.");

  const idx = sorted.findIndex((p) => p.id === chosen!.id);
  const up = sorted.slice(idx + 1).find((p) => p.ramGB > chosen!.ramGB);
  const down = [...sorted.slice(0, idx)].reverse().find((p) => p.ramGB < chosen!.ramGB);
  const alternatives: PlanRecommendation["alternatives"] = [];
  if (down) alternatives.push({ planID: down.id, planName: down.name, price: monthly(down), note: "ارزان‌تر، اما ریسک کمبود رم در اوج ترافیک" });
  if (up) alternatives.push({ planID: up.id, planName: up.name, price: monthly(up), note: "راحت‌تر، اگر ترافیک رشد کرد" });

  return {
    planID: chosen.id,
    planName: chosen.name,
    price: chosen.price,
    monthlyPrice: monthly(chosen),
    bundleID: chosen.bundleID,
    ramGB: chosen.ramGB,
    neededRamGB: need,
    reasons,
    alternatives,
    upgradePath: up?.id ?? null,
    accountNote: undefined,
  };
}

export function nextBiggerPlan(current: string, plans: PlanInfo[]): PlanInfo | null {
  const usable = plans.filter((p) => p.available);
  const sorted = [...usable].sort((a, b) => a.ramGB - b.ramGB || a.price - b.price);
  const cur = plans.find((p) => p.id === current);
  if (!cur) return null;
  return sorted.find((p) => p.ramGB > cur.ramGB) ?? null;
}
