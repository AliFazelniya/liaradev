import { liara } from "../liara";
import { recommendPlan, type PlanQuestionnaire } from "../analyzer/plan";
import { gatherAndDiagnose } from "../monitor/diagnose";
import { analyzeBuild } from "../monitor/build";
import { redactEnvs, redactText } from "../redact";
import { readTarGz, toTarGz } from "../analyzer/codebase";
import { planDependencyFix } from "../fix/dependencies";
import { planCodeFix } from "../fix/code";
import { audit, getState, save, uid, type Approval, type Mode } from "../store";

export type Risk = "read" | "write" | "sensitive";

interface Tool {
  name: string;
  description: string;
  risk: Risk;
  /** sensitive tools that may run without approval only in full-auto mode (never destructive ones) */
  autoInFullAuto?: boolean;
  parameters: Record<string, unknown>;
  title: (a: any) => string;
  impact: string;
  /** computes what the action WOULD do (shown on the approval card); `block` = cannot be done automatically */
  prepare?: (a: any) => Promise<{ impact?: string; details?: any; block?: string }>;
  run: (a: any) => Promise<unknown>;
}

const str = { type: "string" };
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });

/** Latest release source -> parsed files -> dependency fix plan. */
export async function loadDependencyFix(name: string) {
  const L = liara();
  const [project, releases] = await Promise.all([L.getProject(name), L.getReleases(name)]);
  const rel = releases.find((r) => r.sourceAvailable !== false) ?? releases[0];
  if (!rel) throw new Error("هنوز هیچ استقراری برای این برنامه وجود ندارد.");
  const files = readTarGz(await L.getReleaseSource(rel.id));
  const fix = await planDependencyFix(files);
  return { project, release: rel, fix };
}

/** Latest release source -> AI patch for the given runtime error (or the dominant error from diagnosis). */
export async function loadCodeFix(name: string, error?: string) {
  const L = liara();
  const [project, releases] = await Promise.all([L.getProject(name), L.getReleases(name)]);
  const rel = releases.find((r) => r.sourceAvailable !== false) ?? releases[0];
  if (!rel) throw new Error("هنوز هیچ استقراری برای این برنامه وجود ندارد.");
  let err = error;
  if (!err) { const d = await gatherAndDiagnose(name); err = d.causes.find((c) => c.id === "code-error")?.evidence[1]; }
  if (!err) throw new Error("خطای کدی در لاگ‌ها پیدا نشد.");
  const files = readTarGz(await L.getReleaseSource(rel.id));
  const fix = await planCodeFix(`${rel.id}:${err}`, files, err);
  return { project, release: rel, fix };
}

export const TOOLS: Tool[] = [
  {
    name: "list_projects", risk: "read", description: "لیست پروژه‌های کاربر در لیارا", parameters: obj({}),
    title: () => "لیست پروژه‌ها", impact: "",
    run: async () => (await liara().listProjects()).map((p) => ({ name: p.project_id, platform: p.type, status: p.status, plan: p.planID, deployed: p.isDeployed })),
  },
  {
    name: "get_project", risk: "read", description: "جزئیات یک پروژه (مقادیر محرمانه env پنهان می‌شود)", parameters: obj({ name: str }, ["name"]),
    title: (a) => `جزئیات ${a.name}`, impact: "",
    run: async (a) => { const p = await liara().getProject(a.name); return { ...p, envs: redactEnvs(p.envs ?? []) }; },
  },
  {
    name: "get_logs", risk: "read", description: "آخرین لاگ‌های پروژه (حداکثر ۶۰ خط، اطلاعات محرمانه حذف می‌شود)",
    parameters: obj({ name: str, minutes: { type: "number" } }, ["name"]),
    title: (a) => `لاگ ${a.name}`, impact: "",
    run: async (a) => (await liara().getLogs(a.name, (a.minutes ?? 60) * 60)).slice(-60).map((l) => `${l.datetime} [${l.type}] ${redactText(l.message).slice(0, 240)}`),
  },
  {
    name: "get_metrics", risk: "read", description: "مصرف CPU و رم یک ساعت اخیر", parameters: obj({ name: str }, ["name"]),
    title: (a) => `متریک ${a.name}`, impact: "",
    run: async (a) => {
      const m = await liara().getMetrics(a.name);
      const f = (x: number[]) => (x.length ? { avg: +(x.reduce((s, v) => s + v, 0) / x.length).toFixed(1), max: +Math.max(...x).toFixed(1), last: +x[x.length - 1].toFixed(1) } : null);
      return { cpuPercent: f(m.cpu), memoryMB: f(m.memory) };
    },
  },
  {
    name: "list_plans", risk: "read", description: "پلن‌ها و قیمت‌های لیارا", parameters: obj({}),
    title: () => "لیست پلن‌ها", impact: "", run: async () => liara().getPlans(),
  },
  {
    name: "recommend_plan", risk: "read",
    description: "پیشنهاد ارزان‌ترین پلن مناسب بر اساس پلتفرم و ترافیک (ابتدا از کاربر بپرس چند بازدیدکننده دارد)",
    parameters: obj({ platform: str, dailyUsers: { type: "number" }, needsDb: { type: "boolean" }, heavyDeps: { type: "boolean" }, maxBudgetToman: { type: "number" } }, ["platform", "dailyUsers"]),
    title: () => "پیشنهاد پلن", impact: "",
    run: async (a) => recommendPlan(a as PlanQuestionnaire, await liara().getPlans()),
  },
  {
    name: "diagnose_project", risk: "read",
    description: "عیب‌یابی کامل: لاگ + CPU/رم + وضعیت را تحلیل و علت‌های محتمل و راه‌حل‌ها را برمی‌گرداند. برای هر مشکل/کندی/خطای ۵۰۰ اول این را صدا بزن.",
    parameters: obj({ name: str }, ["name"]), title: (a) => `عیب‌یابی ${a.name}`, impact: "",
    run: async (a) => { const d = await gatherAndDiagnose(a.name); return { ...d }; },
  },
  {
    name: "get_deploy_status", risk: "read", description: "وضعیت آخرین دیپلوی/ساخت پروژه، مرحله فعلی، و آخرین خطوط لاگ ساخت (برای خطای دیپلوی یا ساخت)",
    parameters: obj({ name: str }, ["name"]), title: (a) => `وضعیت دیپلوی ${a.name}`, impact: "",
    run: async (a) => {
      const rel = (await liara().getReleases(a.name))[0];
      if (!rel) return { message: "هنوز هیچ دیپلویی انجام نشده است." };
      const b = await liara().getBuild(rel.id);
      return { releaseState: rel.state, analysis: analyzeBuild(b), lastBuildLines: b.lines.slice(-25).map((l) => redactText(l.line).slice(0, 200)) };
    },
  },
  {
    name: "update_envs", risk: "write", description: "افزودن/تغییر متغیرهای محیطی (بدون ری‌استارت)",
    parameters: obj({ name: str, variables: { type: "array", items: obj({ key: str, value: str }, ["key", "value"]) } }, ["name", "variables"]),
    title: (a) => `تغییر ${a.variables?.length ?? 0} متغیر محیطی در ${a.name}`, impact: "ریسک کم؛ اثر بعد از ری‌استارت/دیپلوی بعدی.",
    run: async (a) => { await liara().updateEnvs(a.name, a.variables); return "OK"; },
  },
  {
    name: "restart_project", risk: "sensitive", autoInFullAuto: true, description: "ری‌استارت پروژه (چند ثانیه قطعی)",
    parameters: obj({ name: str }, ["name"]), title: (a) => `ری‌استارت ${a.name}`, impact: "چند ثانیه قطعی سرویس.",
    run: async (a) => { await liara().restartProject(a.name); return "restarted"; },
  },
  {
    name: "turn_project", risk: "sensitive", description: "روشن/خاموش کردن پروژه",
    parameters: obj({ name: str, on: { type: "boolean" } }, ["name", "on"]), title: (a) => `${a.on ? "روشن" : "خاموش"} کردن ${a.name}`,
    impact: "خاموش کردن = قطع کامل سایت.",
    run: async (a) => { await liara().turnProject(a.name, !!a.on); return a.on ? "on" : "off"; },
  },
  {
    name: "change_plan", risk: "sensitive", description: "تغییر پلن (روی هزینه اثر دارد و ممکن است ری‌استارت شود)",
    parameters: obj({ name: str, planID: str, bundlePlanID: str }, ["name", "planID"]), title: (a) => `تغییر پلن ${a.name} به ${a.planID}${a.bundlePlanID ? " (بسته " + a.bundlePlanID + ")" : ""}`,
    impact: "هزینه ماهانه تغییر می‌کند و پروژه ری‌استارت می‌شود.",
    run: async (a) => { const from = (await liara().getProject(a.name)).planID; await liara().changePlan(a.name, a.planID, a.bundlePlanID); return `plan ${from} → ${a.planID}`; },
  },
  {
    name: "get_approval_status", risk: "read", description: "وضعیت یک تأییدیه (pending/approved/rejected/failed)، نتیجه و بررسی بعد از اجرا. بعد از ثبت یک اقدام حساس، با این ابزار پیگیری کن.",
    parameters: obj({ id: str }, ["id"]), title: (a) => `وضعیت تأییدیه ${a.id}`, impact: "",
    run: async (a) => { const x = getState().approvals.find((p) => p.id === a.id); if (!x) throw new Error("تأییدیه پیدا نشد"); return { status: x.status, title: x.title, result: x.result, verification: x.verification, details: x.details }; },
  },
  {
    name: "fix_dependencies", risk: "sensitive", description: "اصلاح خودکار وابستگی‌های خراب (پکیج با غلط املایی یا نسخه‌ی ناموجود) در package.json آخرین نسخه و استقرار مجدد. تغییرات دقیق قبل از اجرا برای تأیید کاربر نمایش داده می‌شود.",
    parameters: obj({ name: str }, ["name"]), title: (a) => `اصلاح وابستگی‌های ${a.name} و استقرار مجدد`,
    impact: "سورس آخرین نسخه گرفته می‌شود، package.json اصلاح و یک استقرار جدید ساخته می‌شود.",
    prepare: async (a) => {
      const { fix } = await loadDependencyFix(a.name);
      if (!fix.changes.length) return { block: fix.blocked.join(" ") || "مشکلی در وابستگی‌ها پیدا نشد که به‌صورت خودکار قابل اصلاح باشد." };
      return { details: { changes: fix.changes, blocked: fix.blocked }, impact: `تغییر package.json: ${fix.changes.map((c) => `${c.from} ← ${c.to ?? "حذف"}`).join("؛ ")}` };
    },
    run: async (a) => {
      const { project, release, fix } = await loadDependencyFix(a.name);
      if (!fix.changes.length) throw new Error(fix.blocked.join(" ") || "چیزی برای اصلاح پیدا نشد.");
      const r = await liara().deploySource(a.name, toTarGz(fix.files), { port: release.port ?? 3000, platform: project.type });
      return `release ${r.releaseID}`;
    },
  },
  {
    name: "fix_code", risk: "sensitive", description: "رفع خطای کد برنامه با پچ هوش مصنوعی روی سورس آخرین نسخه و استقرار مجدد؛ فقط وقتی مدل بسیار مطمئن است. تغییرات دقیق قبل از اجرا برای تأیید نمایش داده می‌شود.",
    parameters: obj({ name: str, error: str }, ["name"]), title: (a) => `رفع خطای کد ${a.name} با هوش مصنوعی و استقرار مجدد`,
    impact: "سورس آخرین نسخه گرفته می‌شود، پچ هوش مصنوعی روی آن اعمال و یک استقرار جدید ساخته می‌شود.",
    prepare: async (a) => {
      const { fix } = await loadCodeFix(a.name, a.error);
      if (!fix.edits.length) return { block: fix.blocked.join(" ") || "تغییر کد مطمئنی پیدا نشد." };
      const changes = fix.edits.map((e) => ({ kind: "code", from: `${e.file}\n${e.search}`, to: e.replace, reason: e.reason }));
      return { details: { changes, blocked: fix.blocked, confidence: fix.confidence }, impact: `${fix.explanation} (${fix.edits.length} تغییر در ${[...new Set(fix.edits.map((e) => e.file))].join("، ")})` };
    },
    run: async (a) => {
      const { project, release, fix } = await loadCodeFix(a.name, a.error);
      if (!fix.edits.length) throw new Error(fix.blocked.join(" ") || "تغییر کد مطمئنی پیدا نشد.");
      const r = await liara().deploySource(a.name, toTarGz(fix.files), { port: release.port ?? 3000, platform: project.type });
      return `release ${r.releaseID}`;
    },
  },
  {
    name: "update_port", risk: "sensitive", autoInFullAuto: false, description: "تغییر پورت برنامه (سرویس ری‌استارت می‌شود)",
    parameters: obj({ name: str, port: { type: "number" } }, ["name", "port"]), title: (a) => `تغییر پورت ${a.name} به ${a.port}`, impact: "برنامه با پورت جدید دوباره راه‌اندازی می‌شود.",
    run: async (a) => { await liara().updatePort(a.name, Number(a.port)); return `port=${a.port}`; },
  },
  {
    name: "rollback_release", risk: "sensitive", description: "بازگرداندن برنامه به یک نسخه‌ی قبلی (release)",
    parameters: obj({ name: str, releaseID: str }, ["name", "releaseID"]), title: (a) => `بازگرداندن ${a.name} به نسخه‌ی قبلی`, impact: "نسخه‌ی فعلی با نسخه‌ی انتخاب‌شده جایگزین می‌شود.",
    run: async (a) => { await liara().rollbackRelease(a.releaseID); return "rollback started"; },
  },
  {
    name: "set_flag", risk: "sensitive", description: "روشن/خاموش کردن یکی از قابلیت‌ها: zero-downtime، read-only فایل‌سیستم، آی‌پی ثابت",
    parameters: obj({ name: str, flag: { type: "string", enum: ["zero-downtime", "read-only", "fixed-ip", "default-subdomain"] }, on: { type: "boolean" } }, ["name", "flag", "on"]), title: (a) => `${a.on ? "فعال" : "غیرفعال"} کردن ${a.flag} برای ${a.name}`, impact: "ممکن است برنامه ری‌استارت شود.",
    run: async (a) => { await liara().setFlag(a.name, a.flag, !!a.on); return `${a.flag}=${a.on}`; },
  },
  {
    name: "create_project", risk: "sensitive", autoInFullAuto: true, description: "ساخت پروژه جدید",
    parameters: obj({ name: str, planID: str, platform: str, bundlePlanID: str, network: str }, ["name", "planID", "platform"]), title: (a) => `ساخت پروژه ${a.name} (${a.platform}، پلن ${a.planID}${a.bundlePlanID ? "، بسته " + a.bundlePlanID : ""})`,
    impact: "از همین لحظه هزینه ساعتی پلن محاسبه می‌شود.",
    run: async (a) => { await liara().createProject(a); return "created"; },
  },
  {
    name: "delete_project", risk: "sensitive", description: "حذف کامل پروژه (برگشت‌ناپذیر)",
    parameters: obj({ name: str }, ["name"]), title: (a) => `حذف پروژه ${a.name}`, impact: "⚠️ برگشت‌ناپذیر: کد، دیسک و تنظیمات پاک می‌شود.",
    run: async (a) => { await liara().deleteProject(a.name); return "deleted"; },
  },
  {
    name: "advice", risk: "read", description: "(فقط داخلی)", parameters: obj({}), title: () => "راهنمایی", impact: "", run: async () => "manual",
  },
];

export const tool = (n: string) => TOOLS.find((t) => t.name === n);

export function needsApproval(t: Tool, mode: Mode): boolean {
  if (t.risk === "read") return false;
  if (t.risk === "write") return mode === "assistant";
  // sensitive
  return !(mode === "auto" && t.autoInFullAuto);
}

export type ToolOutcome =
  | { status: "done"; result: unknown }
  | { status: "pending_approval"; approvalId: string; title: string; impact: string }
  | { status: "error"; error: string };

export async function execute(
  name: string, args: any, ctx: { actor: "ai" | "user" | "scheduler" | "mcp"; source: Approval["source"]; reason?: string; force?: boolean; requireApproval?: boolean },
): Promise<ToolOutcome> {
  const t = tool(name);
  if (!t) return { status: "error", error: `ابزار ناشناخته: ${name}` };
  const mode = getState().settings.mode;
  if (!ctx.force && (ctx.requireApproval ? t.risk !== "read" : needsApproval(t, mode))) {
    const dup = getState().approvals.find((a) => a.status === "pending" && a.tool === name && JSON.stringify(a.args) === JSON.stringify(args));
    if (dup) return { status: "pending_approval", approvalId: dup.id, title: dup.title, impact: dup.impact };
    let extra: { impact?: string; details?: any } = {};
    if (t.prepare) {
      try {
        const pr = await t.prepare(args);
        if (pr.block) return { status: "error", error: pr.block };
        extra = pr;
      } catch (e: any) { return { status: "error", error: e?.message ?? String(e) }; }
    }
    const a: Approval = {
      id: uid(), tool: name, args, title: t.title(args), reason: ctx.reason ?? "", impact: extra.impact ?? t.impact, details: extra.details,
      status: "pending", source: ctx.source, createdAt: new Date().toISOString(),
    };
    if (ctx.actor === "mcp") audit({ actor: "mcp", tool: name, args, ok: true, message: `proposed (approval ${a.id})` });
    getState().approvals.push(a);
    save();
    return { status: "pending_approval", approvalId: a.id, title: a.title, impact: a.impact };
  }
  try {
    const result = await t.run(args);
    audit({ actor: ctx.actor, tool: name, args, ok: true, message: typeof result === "string" ? result : "ok" });
    return { status: "done", result };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    audit({ actor: ctx.actor, tool: name, args, ok: false, message: msg });
    return { status: "error", error: msg };
  }
}

/** Run an approved action and re-check the project afterwards. */
export async function resolveApproval(id: string, approve: boolean): Promise<Approval> {
  const a = getState().approvals.find((x) => x.id === id);
  if (!a) throw new Error("تأییدیه پیدا نشد");
  if (a.status !== "pending") return a;
  a.resolvedAt = new Date().toISOString();
  if (!approve) { a.status = "rejected"; audit({ actor: "user", tool: a.tool, args: a.args, ok: true, message: "rejected" }); save(); return a; }
  const out = await execute(a.tool, a.args, { actor: "user", source: a.source, force: true });
  if (out.status === "error") { a.status = "failed"; a.result = out.error; }
  else {
    a.status = "approved"; a.result = typeof (out as any).result === "string" ? (out as any).result : "انجام شد";
    const proj = (a.args as any).name as string | undefined;
    const rid = ["fix_dependencies", "fix_code"].includes(a.tool) ? String(a.result).match(/release (\w+)/)?.[1] : undefined;
    if (proj && ["fix_dependencies", "fix_code", "restart_project", "update_port", "rollback_release", "change_plan", "turn_project"].includes(a.tool)) {
      a.verification = "⏳ در حال بررسی نتیجه…";
      if (!rid) void import("../monitor/scheduler").then((m) => m.scheduleRechecks(proj, [1, 3, 7]));
      else void import("../monitor/scheduler").then((m) => m.watchRelease(proj, rid));
      void verifyLater(a, proj, rid); // background: the approvals page / get_approval_status poll this field
    }
  }
  save();
  return a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the app's public URL until it answers (status < 500) or time runs out. Containers need a few seconds after any change. */
async function probeUntilOk(project: string, maxSec: number): Promise<{ ok: boolean; status?: number }> {
  let status: number | undefined;
  for (let t = 0; t < maxSec; t += 6) {
    const res = await fetch(`https://${project}.liara.run`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
    status = res?.status;
    if (res && res.status < 500) return { ok: true, status };
    await sleep(6000);
  }
  return { ok: false, status };
}

/** Decide what really happened after an approved action and write it onto the approval. */
async function verifyLater(a: Approval, project: string, releaseID?: string) {
  const executedAt = Date.now() / 1000;
  try {
    if (["fix_dependencies", "fix_code"].includes(a.tool) && releaseID) {
      const TERMINAL = ["READY", "FAILED", "UNHEALTHY", "CANCELED", "TIMEDOUT"];
      let state = "BUILDING";
      for (let i = 0; i < 80 && !TERMINAL.includes(state); i++) { await sleep(4000); state = (await liara().getBuild(releaseID)).state; }
      if (state !== "READY") { a.verification = `⚠️ استقرار جدید ${state === "FAILED" ? "ناموفق بود" : "کامل نشد"} (${state}). علت را از «بررسی عملکرد» بررسی کنید.`; save(); return; }
    }
    if (a.tool === "turn_project" && (a.args as any).on === false) { a.verification = "✅ برنامه خاموش شد."; save(); return; }

    if (a.tool === "change_plan") {
      // Liara's CPU metric ramps up for ~5 minutes after a container restart (a plan change restarts it), so judge only
      // once it has settled — measuring earlier under-reports a steady load.
      const planID = (a.args as any).planID as string;
      const plan = (await liara().getPlans()).find((p) => p.id === planID);
      let cpu: { t: number; v: number }[] = [], mem: { t: number; v: number }[] = [];
      while (Date.now() / 1000 - executedAt < 345) await sleep(15_000);
      const since = Math.ceil(Date.now() / 1000 - executedAt) + 5;
      [cpu, mem] = await Promise.all([liara().getSeries(project, "cpu", since), liara().getSeries(project, "memory", since)]);
      cpu = cpu.filter((p) => p.t >= executedAt + 20); mem = mem.filter((p) => p.t >= executedAt + 20);
      if (cpu.length < 3 || !plan) { a.verification = "⏳ هنوز داده‌ی کافی بعد از تغییر پلن نیست؛ چند دقیقه بعد «بررسی عملکرد» را بزنید."; save(); return; }
      const peak = Math.max(...cpu.map((p) => p.v)); // the metric warms up after a restart, so only the maximum is a trustworthy lower bound
      const cpuPct = (peak / plan.cpu) * 100;
      const memPct = mem.length ? (Math.max(...mem.map((p) => p.v)) / (plan.ramGB * 1024 ** 3)) * 100 : 0;
      const nums = `CPU حداکثر ${cpuPct.toFixed(0)}٪ از سهم پلن جدید (${plan.name}) در ${Math.round((Date.now() / 1000 - executedAt) / 60)} دقیقه‌ی اخیر، رم حداکثر ${memPct.toFixed(0)}٪`;
      a.verification = cpuPct > 85 || memPct > 90
        ? `⚠️ بعد از تغییر پلن هنوز منابع نزدیک سقف است: ${nums}. اگر برنامه کار سنگین دائمی دارد (مثل حلقه‌ی بی‌پایان)، ارتقای بیشتر کمک نمی‌کند و باید کد بررسی شود.`
        : `✅ بعد از تغییر پلن: ${nums}.`;
      save(); return;
    }

    const r = await probeUntilOk(project, 90);
    a.verification = r.ok ? `✅ سایت پاسخ می‌دهد (HTTP ${r.status}).` : `⚠️ سایت هنوز پاسخ سالم نمی‌دهد (${r.status ?? "بدون پاسخ"}). علت را از «بررسی عملکرد» بررسی کنید.`;
  } catch (e: any) {
    a.verification = "بررسی نتیجه ناموفق بود: " + (e?.message ?? e);
  }
  save();
}
