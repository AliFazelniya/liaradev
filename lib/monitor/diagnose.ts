import { liara, type LogEntry, type PlanInfo, type ProjectEvent } from "../liara";
import { monthly, nextBiggerPlan } from "../analyzer/plan";
import { analyzeBuild } from "./build";
import { redactText } from "../redact";
import { webCheck, type WebCheck } from "./webcheck";
import { loadSource } from "./source";
import { platformMismatch } from "../analyzer/mismatch";
import { getLiaraStatus, type LiaraStatus } from "./liaraStatus";
import { projectHistory, type HistoryEntry } from "./history";
import type { HealthReport } from "../store";
import { getState, uid } from "../store";

interface Signal {
  id: string;
  title: string;
  confidence: number;
  evidence: string[];
}

const RULES: { id: string; title: string; re: RegExp; conf: number }[] = [
  { id: "oom", title: "کمبود حافظه (OOM) — برنامه به‌خاطر نبود رم کشته و ری‌استارت می‌شود", re: /heap out of memory|OOMKilled|exit code 137|Out of memory|MemoryError|Killed process/i, conf: 0.9 },
  { id: "crash", title: "کرش و ری‌استارت مداوم برنامه", re: /restarting|CrashLoopBackOff|exited with code|Back-off|multirun: one or more of the provided commands ended abnormally/i, conf: 0.6 },
  { id: "dep", title: "وابستگی/ماژول پیدا نشد (مشکل build یا package.json)", re: /Cannot find module|ModuleNotFoundError|No module named|autoload\.php/i, conf: 0.85 },
  { id: "port", title: "مشکل پورت: پورت اشتباه یا در حال استفاده", re: /EADDRINUSE|address already in use|port .* (mismatch|not listening)/i, conf: 0.8 },
  { id: "db", title: "خطا در اتصال به دیتابیس/سرویس خارجی", re: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection refused|authentication failed|ER_ACCESS_DENIED|could not connect to server/i, conf: 0.7 },
  { id: "http5xx", title: "خطاهای HTTP 5xx در برنامه", re: /HTTP 5\d\d|\b5\d\d\s+Internal Server Error|status(?:Code)?[=: ]+5\d\d|Unhandled(?:Promise)?Rejection|Traceback \(most recent/i, conf: 0.5 },
  { id: "env", title: "متغیر محیطی تنظیم‌نشده", re: /(is not defined|is undefined|missing required|KeyError: ['"][A-Z_]+['"]|env.*(not set|missing))/i, conf: 0.5 },
];

/** after a (re)start, "ok" stays provisional this long (CPU metrics ramp ~5 min) */
export const SETTLE_MS = 6 * 60_000;

export interface Probe { url: string; status?: number; ms?: number; error?: string }

export interface Diagnosis {
  probe?: Probe;
  /** what the actual site returns (page, assets, the endpoints its own code calls) */
  web?: WebCheck;
  history?: HistoryEntry[];
  platform?: LiaraStatus;
  severity: HealthReport["severity"];
  /** just (re)started: an "ok" verdict is provisional */
  settling?: boolean;
  summary: string;
  causes: Signal[];
  actions: HealthReport["actions"];
  metrics: { cpuAvg: number; memMaxMB: number; memLimitMB: number };
  logSample: string[];
  limitations: string[];
}

/** The port an app says it listens on, from its own log lines. */
export function announcedPort(logs: LogEntry[]): string | undefined {
  const portIn = (m: string) => {
    const n = m.match(/\b(?:listening|listens|started|running|serving)\b[^\n\d]{0,30}?(?:port\s*)?(\d{2,5})\b/i)?.[1] ?? m.match(/\bport\s*[:=]?\s*(\d{2,5})\b/i)?.[1];
    return n && Number(n) >= 80 && Number(n) <= 65535 ? n : undefined;
  };
  return [...logs].reverse().filter((l) => l.type !== "stderr").map((l) => portIn(l.message)).find(Boolean);
}

export async function gatherAndDiagnose(project: string, sinceSeconds = 3600): Promise<Diagnosis> {
  const L = liara();
  const limitations: string[] = [];
  const [detail, plans, logs, metrics, events, releases] = await Promise.all([
    L.getProject(project),
    L.getPlans().catch(() => [] as PlanInfo[]),
    L.getLogs(project, sinceSeconds).catch((e) => { limitations.push("دریافت لاگ ناموفق بود: " + e.message); return [] as LogEntry[]; }),
    L.getMetrics(project).catch((e) => { limitations.push("دریافت متریک‌ها ناموفق بود: " + e.message); return { cpu: [], memory: [] }; }),
    L.getEvents(project).catch(() => [] as ProjectEvent[]),
    L.getReleases(project).catch(() => []),
  ]);
  const since = Date.now() / 1000 - sinceSeconds;
  // A plan change / redeploy recreates the container ("create" event); an OOM restart does not.
  // Only events since the last recreate describe the *current* container, so old OOMs don't trigger repeat upgrades.
  const lastCreateEv = [...events].reverse().find((e) => e.status === "create");
  const lastCreate = lastCreateEv?.time ?? 0;
  const recentEvents = events.filter((e) => e.time >= since && e.time >= lastCreate);
  // After a redeploy/plan change only the new container's lines count: newer than the "create" event AND from the current release
  // (log lines carry their release id, so the previous release's crash loop cannot leak in).
  const relOk = (l: { release?: string }) => !lastCreateEv?.release || !l.release || l.release === lastCreateEv.release;
  const currentLogs = lastCreate ? logs.filter((l) => Date.parse(l.datetime) / 1000 >= lastCreate && relOk(l)) : logs;
  // Our own request to the app's public URL: real status code + latency (Liara's API has neither).
  const latestRel = releases[0];
  const warmingUp = latestRel?.state === "READY" && Date.now() - Date.parse(latestRel.createdAt) < 90_000;
  const startedAt = Math.max(lastCreate * 1000, latestRel?.finishedAt ? Date.parse(latestRel.finishedAt) : 0);
  const justStarted = !!startedAt && Date.now() - startedAt < SETTLE_MS;
  const probe: Probe | undefined = detail.isDeployed && detail.status === "RUNNING" ? await probeSite(project) : undefined;
  const d = diagnose(detail.project_id, detail.planID, detail.status, detail.isDeployed, currentLogs, metrics, plans, limitations, recentEvents, { envKeys: (detail.envs ?? []).map((e) => e.key), network: detail.network?.name });
  d.probe = probe;
  // Is Liara itself having trouble? (the platform status page, https://liara.online)
  d.platform = await getLiaraStatus(["PaaS"]);
  if (d.platform.affecting.length) {
    const down = !!probe && (!!probe.error || (probe.status !== undefined && probe.status >= 500));
    d.causes.unshift({ id: "platform", title: "اختلال در پلتفرم لیارا", confidence: down ? 0.85 : 0.6, evidence: [...d.platform.affecting.map((a) => a.reason), "منبع: liara.online"] });
    d.actions.push({ tool: "advice", kind: "workaround", args: { name: project }, why: "این مشکل از سمت لیارا اعلام شده است؛ تا رفع اختلال نیازی به تغییر در برنامه نیست و وضعیت را در liara.online دنبال کنید." });
    if (d.severity === "ok" && down) d.severity = "warning";
  }
  if (probe) {
    const unreachable = probe.error || (probe.status !== undefined && [502, 503, 504].includes(probe.status));
    const announced = announcedPort(currentLogs);
    const relPort = releases.find((r) => r.current)?.port ?? latestRel?.port ?? null;
    // An app that never answered HTTP and never announced a port may simply not be a web app (Telegram bot, worker):
    // then a failed request proves nothing and health is judged from container events and logs instead.
    const webEvidence = !!announced || (getState().uptime[project] ?? []).some((x) => x.up && x.mode !== "process");
    if (unreachable && !warmingUp && !webEvidence) limitations.push("برنامه به درخواست HTTP پاسخ نمی‌دهد و پورتی اعلام نکرده؛ اگر ربات یا worker است، سلامت آن از روی لاگ و رویدادها سنجیده شد.");
    if (unreachable && !warmingUp && webEvidence) {
      if (announced && relPort && Number(announced) !== relPort) {
        d.causes.unshift({ id: "port", title: `ناسازگاری پورت: برنامه روی ${announced} گوش می‌دهد اما دیپلوی با پورت ${relPort} انجام شده`, confidence: 0.95, evidence: [`پاسخ سایت: ${probe.status ?? probe.error}`, `لاگ برنامه: پورت ${announced}`, `پورت release: ${relPort}`] });
        // the console lets you change the app port without redeploying, so this is a real, executable fix
        d.actions.unshift({ tool: "update_port", kind: "fix", args: { name: project, port: Number(announced) }, why: `تغییر پورت برنامه به ${announced} (همان پورتی که برنامه روی آن گوش می‌دهد).` });
      } else if (!(justStarted && !d.causes.length)) {
        // (a 502 in the first minutes with nothing in the logs is the app still coming up: the settling state covers it)
        d.causes.unshift({ id: "unreachable", title: `سایت پاسخ نمی‌دهد (${probe.status ?? probe.error})`, confidence: 0.8, evidence: [`درخواست مستقیم به ${probe.url} ناموفق بود`] });
      }
      if (d.causes.length) { d.severity = "critical"; d.summary = `محتمل‌ترین علت: ${d.causes[0].title}.`; }
    }
  }

  // Does the site really work? A 200 on "/" proves little: look at what the page loads and the backend it calls.
  if (probe && !probe.error && probe.status !== undefined && probe.status < 500) {
    d.web = await webCheck(probe.url).catch(() => undefined);
    const crit = d.web?.issues.filter((i) => i.sev === "critical") ?? [], warn = d.web?.issues.filter((i) => i.sev === "warning") ?? [];
    const ev = (l: typeof crit) => l.slice(0, 4).map((i) => i.detail);
    if (crit.length) {
      d.causes.unshift({ id: "web-broken", title: `سایت بالاست اما درست کار نمی‌کند: ${crit[0].detail}`, confidence: crit.some((i) => i.kind === "php-source") ? 0.96 : 0.88, evidence: ev(crit) });
      d.actions.push({ tool: "advice", kind: "fix", args: { name: project }, why: crit.some((i) => i.kind === "php-source") ? "کد PHP اجرا نمی‌شود چون پلتفرم برنامه PHP نیست؛ برنامه را با پلتفرم PHP دوباره بسازید." : "آدرس‌های ناموفق را در کد بررسی کنید (مسیر اشتباه، فایل جاافتاده یا خطای سرور)." });
      d.severity = "critical";
    } else if (warn.length) {
      d.causes.push({ id: "web-warn", title: `مشکل در منابع سایت: ${warn[0].detail}`, confidence: 0.6, evidence: ev(warn) });
      if (d.severity === "ok") d.severity = "warning";
    }
  }
  // Platform vs code: the app runs on a platform that cannot run its files (e.g. PHP files on the static platform).
  if (detail.isDeployed && latestRel?.sourceAvailable !== false) {
    const files = await loadSource(project);
    const mm = files ? platformMismatch(detail.type, files) : null;
    if (mm) {
      d.causes.unshift({ id: "platform-mismatch", title: mm.title, confidence: 0.95, evidence: [`پلتفرم برنامه: ${detail.type}`, ...mm.evidence] });
      d.actions.push({ tool: "advice", kind: "fix", args: { name: project }, why: mm.hint });
      d.severity = "critical";
    }
  }

  // If the newest deploy failed, that outranks runtime symptoms: nothing new is running.
  const latest = releases[0];
  if (latest && ["FAILED", "UNHEALTHY", "TIMEDOUT"].includes(latest.state)) {
    const a = analyzeBuild(await L.getBuild(latest.id).catch(() => ({ releaseID: latest.id, state: latest.state, failReason: null, queue: null, lines: [] })));
    d.causes.unshift({ id: "release", title: `آخرین دیپلوی ناموفق بود (${latest.state})`, confidence: 0.92, evidence: [a.hint ?? a.label, ...(a.lastStep ? [`آخرین مرحله ساخت: ${a.lastStep}`] : [])] });
    d.actions.unshift({ tool: "advice", args: { name: project }, why: a.hint ?? "لاگ ساخت را در صفحه پروژه ببینید و دوباره دیپلوی کنید." });
    // the build died while installing dependencies: offer the automatic, approval-gated fix (package typo / bad version)
    if (latest.state === "FAILED" && /npm install|pip install/i.test(a.lastStep ?? "")) {
      d.actions.unshift({ tool: "fix_dependencies", kind: "fix", args: { name: project }, why: "بررسی package.json آخرین نسخه، پیدا کردن پکیج یا نسخه‌ی نامعتبر و استقرار مجدد پس از تأیید شما (تغییرات دقیق قبل از اجرا نمایش داده می‌شود)." });
    }
    d.severity = "critical";
    d.causes = d.causes.filter((c) => c.id !== "nodeploy");
  }
  // unhealthy newest release but an older one was healthy -> rollback is a real workaround
  if (latest && latest.state === "UNHEALTHY") {
    const prev = releases.find((r) => r.state === "READY" && r.id !== latest.id);
    if (prev) d.actions.push({ tool: "rollback_release", kind: "workaround", args: { name: project, releaseID: prev.id }, why: "بازگرداندن به آخرین نسخه‌ی سالم تا مشکل نسخه‌ی جدید رفع شود." });
  }
  // What was already done to this app (the AI decision step reads it too). Generic guard: never repeat the same operation right after it ran.
  d.history = projectHistory(project, 14, detail.created_at).slice(0, 8);
  const COOLDOWN_MIN: Record<string, number> = { change_plan: 6, restart_project: 10 };
  d.actions = d.actions.filter((a) => {
    const last = d.history!.find((h) => h.tool === a.tool);
    return !(last && COOLDOWN_MIN[a.tool] && Date.now() - Date.parse(last.at) < COOLDOWN_MIN[a.tool] * 60_000);
  });
  d.causes.sort((x, y) => y.confidence - x.confidence);
  // Just (re)started: the container is new, metrics need ~5 minutes to ramp and crashes may not have happened yet.
  // "No problem so far" is then provisional, not "healthy".
  const building = !!latest && !["READY", "FAILED", "UNHEALTHY", "TIMEDOUT", "CANCELED"].includes(latest.state);
  const freshAt = Math.max(lastCreate * 1000, latest?.finishedAt ? Date.parse(latest.finishedAt) : 0);
  if (detail.isDeployed && d.severity === "ok" && (building || (freshAt && Date.now() - freshAt < SETTLE_MS))) {
    d.settling = true;
    d.summary = building ? "نسخه‌ی جدید در حال ساخت است؛ بررسی اولیه پس از آماده‌شدن انجام می‌شود." : "برنامه تازه راه‌اندازی شده؛ تا چند دقیقه‌ی دیگر پایش ادامه دارد و نتیجه‌ی نهایی بعداً قطعی می‌شود.";
  }
  if (d.causes.length) d.summary = `محتمل‌ترین علت: ${d.causes[0].title} (اطمینان ${Math.round(d.causes[0].confidence * 100)}٪).`;
  return d;
}

export function diagnose(
  name: string, planID: string, status: string, isDeployed: boolean,
  logs: LogEntry[], metrics: { cpu: number[]; memory: number[] }, plans: PlanInfo[], limitations: string[] = [], events: ProjectEvent[] = [],
  ctx: { envKeys: string[]; network?: string } = { envKeys: [] },
): Diagnosis {
  const causes: Signal[] = [];
  const actions: HealthReport["actions"] = [];
  const plan = plans.find((p) => p.id === planID);
  const memLimitMB = (plan?.ramGB ?? 0) * 1024;
  const cpuLimit = (plan?.cpu ?? 1) * 100; // plan CPU in cores -> % of one core
  const memMax = metrics.memory.length ? Math.max(...metrics.memory) : 0;
  // 90th percentile, not the mean: the metric ramps up after every restart, so a mean understates a steady load
  const sortedCpu = [...metrics.cpu].sort((a, b) => a - b);
  const cpuAvg = sortedCpu.length ? sortedCpu[Math.min(sortedCpu.length - 1, Math.floor(sortedCpu.length * 0.9))] : 0;
  const cpuUsePct = (cpuAvg / cpuLimit) * 100; // % of the plan's CPU allowance
  const errLines = logs.filter((l) => l.type === "stderr" || /error|fatal|exception|killed/i.test(l.message));

  for (const rule of RULES) {
    const hits = logs.filter((l) => rule.re.test(l.message));
    if (hits.length) {
      const uniq = [...new Set(hits.map((h) => redactText(h.message).slice(0, 160)))].slice(0, 3);
      causes.push({ id: rule.id, title: rule.title, confidence: Math.min(0.97, rule.conf + Math.min(0.07, hits.length * 0.01)), evidence: [`${hits.length} خط لاگ مرتبط`, ...uniq] });
    }
  }

  // Liara's container events carry an explicit "oom" status — the strongest evidence of memory exhaustion.
  const ooms = events.filter((e) => e.status === "oom");
  if (ooms.length) {
    const t = (x: number) => new Date(x * 1000).toISOString().slice(11, 19);
    const ev = `${ooms.length} رویداد oom در رویدادهای کانتینر لیارا (آخرین: ${t(ooms[ooms.length - 1].time)} UTC)`;
    const ex = causes.find((c) => c.id === "oom");
    if (ex) { ex.confidence = 0.98; ex.evidence.unshift(ev); }
    else causes.push({ id: "oom", title: RULES[0].title, confidence: 0.98, evidence: [ev] });
  }
  const deaths = events.filter((e) => e.status === "die").length;
  if (deaths >= 3 && !ooms.length) {
    const ev = `${deaths} بار کانتینر متوقف (die) شده است`;
    const ex = causes.find((c) => c.id === "crash");
    if (ex) { ex.confidence = Math.max(ex.confidence, 0.75); ex.evidence.unshift(ev); }
    else causes.push({ id: "crash", title: RULES[1].title, confidence: 0.7, evidence: [ev] });
  }

  // ---- leak vs capacity: steadily growing memory (from the app's own log numbers) or repeated OOM kills
  const leak = detectLeak(logs);
  let leakCause = false;
  if (leak) {
    leakCause = true;
    causes.push({ id: "leak", title: `نشت حافظه: مصرف رم پیوسته بالا می‌رود (حدود ${leak.mbPerMin.toFixed(0)} مگابایت در دقیقه)`, confidence: 0.985, evidence: [`رشد ${Math.round(leak.from)}MB → ${Math.round(leak.to)}MB در ${leak.samples} نمونه‌ی لاگ برنامه`] });
  } else if (ooms.length >= 3) {
    leakCause = true;
    causes.push({ id: "leak", title: "احتمال نشت حافظه: برنامه بارها به‌خاطر نبود رم کشته شده", confidence: 0.78, evidence: [`${ooms.length} بار OOM پشت‌سرهم؛ ارتقای پلن معمولاً فقط فاصله‌ی کرش‌ها را بیشتر می‌کند`] });
  }

  // ---- code error: the dominant application error (not a DB/OOM/platform line)
  const errs = topErrors(logs).filter((e) => !RULES[0].re.test(e.message) && !RULES.find((r) => r.id === "db")!.re.test(e.message));
  // a missing environment variable is a configuration problem (set it in the panel), not a code bug
  const envHit = errs
    .map((e) => ({ e, name: e.message.match(/(?:environment variable|env(?:ironment)? var(?:iable)?|process\.env\.)\s*[:=]?\s*["'`]?([A-Z][A-Z0-9_]{2,})/)?.[1] ?? e.message.match(/\b([A-Z][A-Z0-9_]{2,})\b\s+(?:is\s+)?(?:not set|missing|undefined|required)/)?.[1] }))
    .find((x) => x.name);
  const missingEnv = envHit && !ctx.envKeys.includes(envHit.name!) ? envHit : null;
  if (missingEnv) {
    causes.push({ id: "config", title: `متغیر محیطی ${missingEnv.name} تعریف نشده است`, confidence: 0.94, evidence: [`${missingEnv.e.count.toLocaleString("fa-IR")} بار تکرار در لاگ`, redactText(missingEnv.e.message).slice(0, 200), `متغیرهای فعلی برنامه: ${ctx.envKeys.join("، ") || "هیچ"}`] });
  }
  const dom = errs.find((e) => e !== missingEnv?.e);
  let codeError = false;
  if (dom && (dom.count >= 2 || deaths >= 1)) {
    codeError = true;
    causes.push({ id: "code-error", title: `خطای کد برنامه: ${redactText(dom.message).slice(0, 90)}`, confidence: dom.count >= 3 ? 0.92 : 0.86, evidence: [`${dom.count.toLocaleString("fa-IR")} بار تکرار (آخرین: ${dom.last.slice(11, 19)} UTC)`, redactText(dom.message).slice(0, 200)] });
  }

  // ---- database/external-service errors: what is the target and is anything configured for it?
  const dbHit = logs.find((l) => RULES.find((r) => r.id === "db")!.re.test(l.message));
  const dbInfo = dbHit ? parseTarget(dbHit.message) : null;
  const dbKeys = ctx.envKeys.filter((k) => /(^|_)(db|database|mongo|mongodb|postgres|pg|mysql|redis|sql|dsn)(_|$)|database_url|redis_url|mongo_uri/i.test(k));

  if (memLimitMB && memMax / memLimitMB > 0.9) {
    const ex = causes.find((c) => c.id === "oom");
    const ev = `مصرف رم تا ${Math.round(memMax)}MB از سقف ${Math.round(memLimitMB)}MB (${Math.round((memMax / memLimitMB) * 100)}٪) رسیده`;
    if (ex) { ex.confidence = 0.97; ex.evidence.unshift(ev); }
    else causes.push({ id: "memhigh", title: "مصرف رم نزدیک به سقف پلن است", confidence: 0.75, evidence: [ev] });
  }
  if (cpuUsePct > 85) causes.push({ id: "cpu", title: "مصرف CPU بسیار بالا (نزدیک سقف پلن)", confidence: 0.7, evidence: [`CPU تا ${cpuUsePct.toFixed(0)}٪ از سهم پلن (${plan?.cpu ?? 1} هسته) می‌رسد (صدک ۹۰ نمونه‌های اخیر)`] });
  if (status !== "RUNNING") causes.unshift({ id: "down", title: `سرویس در حالت ${status} است`, confidence: 0.95, evidence: ["وضعیت پروژه RUNNING نیست"] });
  if (!isDeployed) causes.push({ id: "nodeploy", title: "هنوز هیچ نسخه‌ای روی این پروژه دیپلوی نشده", confidence: 0.99, evidence: ["isDeployed=false"] });

  if (codeError || leakCause || missingEnv) { const i = causes.findIndex((c) => c.id === "crash"); if (i >= 0) causes.splice(i, 1); }
  if (missingEnv) { const i = causes.findIndex((c) => c.id === "env"); if (i >= 0) causes.splice(i, 1); }
  causes.sort((a, b) => b.confidence - a.confidence);
  const top = new Set(causes.map((c) => c.id));

  // Proposed actions. Each is labeled: "fix" addresses the root cause, "workaround" only buys time.
  const cur = plans.find((p) => p.id === planID);
  const bigger = nextBiggerPlan(planID, plans);
  const upgrade = (note: string, kind: "fix" | "workaround") => {
    if (!bigger) return;
    const extra = Math.max(0, monthly(bigger) - (cur ? monthly(cur) : 0));
    actions.push({ tool: "change_plan", kind, args: { name, planID: bigger.id }, why: `${note} — ${bigger.name} (${bigger.ramGB}GB رم)، حدود ${extra.toLocaleString("fa-IR")}+ تومان در ماه بیشتر.` });
  };
  const advice = (why: string, kind: "fix" | "workaround" = "fix") => actions.push({ tool: "advice", kind, args: { name }, why });

  if (leakCause) {
    advice("حافظه در کد برنامه نشت دارد. ساختارهایی که بدون سقف بزرگ می‌شوند (کش، آرایه یا Map، listener های حذف‌نشده) را پیدا و محدود کنید، سپس دوباره دیپلوی کنید.");
    upgrade("ارتقای پلن فقط زمان بین کرش‌ها را طولانی‌تر می‌کند و مشکل را حل نمی‌کند", "workaround");
  } else if (top.has("oom") || top.has("memhigh")) {
    upgrade("برنامه به رم بیشتری نیاز دارد", "fix");
    actions.push({ tool: "restart_project", kind: "workaround", args: { name }, why: "ری‌استارت برای آزادسازی حافظه (موقت)." });
  }
  if (missingEnv) {
    actions.push({ tool: "set_env", kind: "fix", args: { name, key: missingEnv.name! }, why: `متغیر محیطی ${missingEnv.name} روی برنامه تعریف نشده و برنامه برای شروع به آن نیاز دارد. مقدار آن را وارد کنید؛ پس از ثبت، برنامه دوباره راه‌اندازی می‌شود و نیازی به دیپلوی مجدد نیست.` });
  }
  if (codeError) {
    const d0 = dom!;
    actions.push({ tool: "fix_code", kind: "fix", args: { name, error: redactText(d0.message).slice(0, 600) }, why: `این خطا در کد برنامه است و در هر اجرا تکرار می‌شود (${d0.count.toLocaleString("fa-IR")} بار)؛ ری‌استارت یا ارتقای پلن آن را حل نمی‌کند. هوش مصنوعی کد را اصلاح می‌کند و پس از تأیید شما دوباره دیپلوی می‌شود.` });
  } else if (top.has("crash") && !leakCause) {
    actions.push({ tool: "restart_project", kind: "workaround", args: { name }, why: "علت دقیق کرش در لاگ پیدا نشد؛ ری‌استارت و بررسی دوباره‌ی لاگ‌ها." });
  }
  if (top.has("down")) actions.push({ tool: "turn_project", kind: "fix", args: { name, on: true }, why: "روشن کردن سرویس." });
  if (top.has("cpu")) upgrade("CPU اشباع شده و پلن بزرگ‌تر هسته‌ی بیشتری دارد", "fix");
  if (top.has("db")) {
    const target = dbInfo ? `${dbInfo.host}${dbInfo.port ? ":" + dbInfo.port : ""}` : "سرویس خارجی";
    const priv = dbInfo && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(dbInfo.host);
    const cfg = dbKeys.length
      ? `متغیرهای مرتبط تعریف شده‌اند (${dbKeys.join("، ")}) اما به ${target} وصل نمی‌شوند؛ مقدارشان را بررسی کنید.`
      : `هیچ متغیر محیطی مرتبط با دیتابیس (مثل DATABASE_URL) روی برنامه تعریف نشده؛ آدرس ${target} احتمالاً داخل کد ثابت‌شده است.`;
    advice(`${cfg}${priv ? ` این یک آدرس خصوصی است؛ دیتابیس باید در همان شبکه‌ی خصوصی برنامه${ctx.network ? ` (${ctx.network})` : ""} باشد.` : ""}`);
  }
  if (top.has("dep")) advice("وابستگی‌ها را در package.json/requirements.txt کامل کنید و دوباره دیپلوی بزنید.");
  if (top.has("port")) advice("برنامه باید روی process.env.PORT (یا پورت تعیین‌شده هنگام دیپلوی) گوش بدهد.");
  actions.sort((x, y) => (x.kind === "fix" ? 0 : 1) - (y.kind === "fix" ? 0 : 1));
  const dbc = causes.find((c) => c.id === "db");
  if (dbc && dbInfo) dbc.evidence.unshift(`مقصد اتصال: ${dbInfo.host}${dbInfo.port ? ":" + dbInfo.port : ""}`, dbKeys.length ? `متغیرهای دیتابیس: ${dbKeys.join("، ")}` : "هیچ متغیر محیطی دیتابیس تعریف نشده");

  const critical = causes.some((c) => ["oom", "leak", "code-error", "config", "down", "dep", "port"].includes(c.id) && c.confidence >= 0.8);
  const severity: Diagnosis["severity"] = critical ? "critical" : causes.length ? "warning" : "ok";
  const summary = causes.length
    ? `محتمل‌ترین علت: ${causes[0].title} (اطمینان ${Math.round(causes[0].confidence * 100)}٪).`
    : `سرویس سالم به نظر می‌رسد: ${errLines.length} خطا در لاگ، CPU ${cpuUsePct.toFixed(1)}٪ از سهم پلن، رم حداکثر ${Math.round(memMax)}MB.`;

  return {
    severity, summary, causes, actions,
    metrics: { cpuAvg: cpuUsePct, memMaxMB: memMax, memLimitMB },
    // the distinct error lines first (a stack trace's last lines are rarely the cause), then the latest output
    logSample: [...topErrors(logs).slice(0, 4).map((e) => redactText(`[×${e.count}] ${e.message}`).slice(0, 220)), ...logs.slice(-8).map((l) => redactText(`${l.datetime.slice(11, 19)} ${l.message}`).slice(0, 200))],
    limitations,
  };
}

export function toReport(project: string, d: Diagnosis): HealthReport {
  return {
    id: uid(), project, at: new Date().toISOString(), severity: d.severity, summary: d.summary,
    causes: d.causes.map(({ title, confidence, evidence }) => ({ title, confidence, evidence })),
    actions: d.actions, metrics: d.metrics, approvalIds: [], autoApplied: [], seen: 1,
    // a new action on the app (plan change, fix…) makes the same issue a new log entry: "still there after X"
    settling: d.settling || undefined,
    fingerprint: d.settling ? "settling" : d.severity === "ok" ? "ok" : d.causes.map((c) => c.id).sort().join("|") + "@" + (d.history?.[0]?.at ?? ""),
  };
}

export async function probeSite(name: string): Promise<Probe> {
  const url = `https://${name}.liara.run`;
  const t = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(8000) });
    await res.arrayBuffer().catch(() => null);
    return { url, status: res.status, ms: Date.now() - t };
  } catch (e: any) {
    return { url, error: e?.cause?.code ?? e?.name ?? "network error", ms: Date.now() - t };
  }
}

const NOISE = /multirun: one or more|Please upgrade your client|npm (?:notice|warn)/i;

/** Group application error lines by a normalized signature (numbers/timestamps stripped). */
function topErrors(logs: LogEntry[]) {
  const groups = new Map<string, { message: string; count: number; last: string }>();
  for (const l of logs) {
    if (l.type !== "stderr" && !/\b\w*(Error|Exception)\b\s*[:(]/.test(l.message)) continue;
    const m = l.message.trim();
    // skip platform noise, stack frames, and echoed source code ("throw new Error(...)" excerpts that Node prints above the real error)
    if (NOISE.test(m) || /^\s*at\s/.test(l.message) || /=>|[{};]\s*$|^\s*(?:throw|return|const|let|var|if|setTimeout|await)\b/.test(m) || !/\b\w*(Error|Exception|Traceback|Fatal|Unhandled)\b/i.test(m)) continue;
    const sig = m.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, "").replace(/\b\d+(?:\.\d+)?\b/g, "N").slice(0, 140);
    const g = groups.get(sig);
    if (g) { g.count++; g.last = l.datetime; } else groups.set(sig, { message: m, count: 1, last: l.datetime });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Memory numbers the app prints (rss/heap/memory ... N MB). A run that keeps rising is a leak. */
function detectLeak(logs: LogEntry[]) {
  const pts: { t: number; mb: number }[] = [];
  for (const l of logs) {
    const m = l.message.match(/\b(?:rss|heap(?:Used)?|mem(?:ory)?)\b[^\d\n]{0,14}(\d+(?:\.\d+)?)\s*(KB|MB|GB)?/i);
    if (!m) continue;
    const u = (m[2] ?? "MB").toUpperCase();
    pts.push({ t: Date.parse(l.datetime), mb: Number(m[1]) * (u === "GB" ? 1024 : u === "KB" ? 1 / 1024 : 1) });
  }
  // split into runs at restarts (a big drop)
  const runs: { t: number; mb: number }[][] = [];
  let cur: { t: number; mb: number }[] = [];
  for (const p of pts) {
    if (cur.length && p.mb < cur[cur.length - 1].mb * 0.7) { runs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  let best: { from: number; to: number; samples: number; mbPerMin: number } | null = null;
  for (const r of runs) {
    if (r.length < 4) continue;
    const ups = r.slice(1).filter((p, i) => p.mb >= r[i].mb).length / (r.length - 1);
    const first = r[0], last = r[r.length - 1];
    if (ups >= 0.85 && last.mb >= first.mb * 1.4 && last.t > first.t) {
      const rate = ((last.mb - first.mb) / ((last.t - first.t) / 60000)) || 0;
      if (!best || last.mb > best.to) best = { from: first.mb, to: last.mb, samples: r.length, mbPerMin: rate };
    }
  }
  return best;
}

/** host[:port] from "connect ECONNREFUSED 10.0.0.5:5432", "getaddrinfo ENOTFOUND db.internal", ... */
function parseTarget(msg: string): { host: string; port?: string } | null {
  const m = msg.match(/(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH)\s+([\w.\-]+?)(?::(\d+))?(?:\s|$)/i);
  return m ? { host: m[1], port: m[2] } : null;
}
