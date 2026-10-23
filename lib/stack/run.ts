import { strToU8, strFromU8 } from "fflate";
import { liara, type DbInfo } from "../liara";
import { toTarGz, type Files } from "../analyzer/codebase";
import { tierPlan, TOKEN, type StackPlan } from "../ai/architect";
import type { Component } from "./detect";
import { randomBytes } from "node:crypto";
import { audit, uid } from "../store";

/** Executes a confirmed stack plan on Liara: one network, databases first, then the apps with their environment, then the code. */
export interface Step { key: string; label: string; status: "pending" | "running" | "ok" | "failed"; detail?: string }
export interface StackJob { id: string; base: string; steps: Step[]; done: boolean; ok: boolean; apps: { id: string; name: string; url: string; role: string }[]; databases: { id: string; hostname: string; type: string }[]; startedAt: number }

const g = globalThis as unknown as { __stackJobs?: Map<string, StackJob>; __stackPlans?: Map<string, { files: Files; components: Component[]; plan: StackPlan; base: string; at: number }> };
export const jobs = (g.__stackJobs ??= new Map());
export const plans = (g.__stackPlans ??= new Map());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const appName = (base: string, id: string) => `${base}-${id}`.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 30).replace(/-$/, "");
export const dbHost = (base: string, id: string) => `${base}-${id}`.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 30).replace(/-$/, "");

function dbUrl(d: DbInfo, name: string) {
  const u = encodeURIComponent(d.username), p = encodeURIComponent(d.password), hp = `${d.hostname}:${d.internalPort}`;
  switch (d.type) {
    case "mongodb": return `mongodb://${u}:${p}@${hp}/${name}?authSource=admin`;
    case "postgres": return `postgresql://${u}:${p}@${hp}/${name}`;
    case "redis": return `redis://:${p}@${hp}`;
    default: return `mysql://${u}:${p}@${hp}/${name}`; // mysql / mariadb
  }
}
const defaultDbName = (type: string, base: string) => (type === "postgres" ? "postgres" : type === "mongodb" ? base.replace(/-/g, "_") : "mysql");

export function startStack(planId: string, opts: { skipEdits?: number[] } = {}): StackJob {
  const p = plans.get(planId);
  if (!p) throw Object.assign(new Error("طرح منقضی شده؛ دوباره طراحی کنید."), { status: 404 });
  const job: StackJob = { id: uid(), base: p.base, steps: [], done: false, ok: false, apps: [], databases: [], startedAt: Date.now() };
  jobs.set(job.id, job);
  void run(job, p, opts).catch((e) => { fail(job, e); });
  return job;
}

const step = (job: StackJob, key: string, label: string): Step => { const s: Step = { key, label, status: "running" }; job.steps.push(s); return s; };
function fail(job: StackJob, e: any, s?: Step) {
  const cur = s ?? job.steps.find((x) => x.status === "running");
  const msg = (e?.hint ? `${e.error ?? e.message} — ${e.hint}` : e?.message) ?? String(e);
  if (cur) { cur.status = "failed"; cur.detail = msg; }
  job.done = true; job.ok = false;
  audit({ actor: "user", tool: "create_stack", args: { base: job.base }, ok: false, message: msg });
}

async function run(job: StackJob, p: { files: Files; components: Component[]; plan: StackPlan; base: string }, opts: { skipEdits?: number[] }) {
  const L = liara(), { plan, base } = p;

  let s = step(job, "network", "شبکه‌ی خصوصی مشترک");
  const nets = await L.listNetworks();
  const net = nets[0] ?? (await L.createNetwork(`${base}-net`));
  const netId = (net as any)._id as string;
  s.status = "ok"; s.detail = (net as any).name ?? "شبکه‌ی جدید";

  // databases first: apps need their address and credentials
  const dbInfo = new Map<string, DbInfo & { name: string }>();
  if (plan.databases.length) {
    const cat = await L.getDbCatalog();
    for (const d of plan.databases) {
      s = step(job, `db-${d.id}`, `دیتابیس ${d.type} (${dbHost(base, d.id)})`);
      const dp = cat.plans.find((x) => x.id === tierPlan(d.tier) && x.types.includes(d.type)) ?? cat.plans.filter((x) => x.types.includes(d.type)).sort((a, b) => a.hourlyToman - b.hourlyToman)[0];
      if (!dp) throw new Error(`پلن دیتابیس برای ${d.type} در دسترس نیست.`);
      const version = cat.versions[d.type]?.[0]?.value;
      const bundle = dp.bundles.find((b) => b.id === "basic") ?? dp.bundles.find((b) => b.id !== "free");
      if (!version || !bundle) throw new Error(`نسخه یا بسته‌ی دیتابیس ${d.type} پیدا نشد.`);
      const id = await L.createDatabase({ hostname: dbHost(base, d.id), type: d.type, version, planID: dp.id, bundlePlanID: bundle.id, network: netId });
      s.detail = "در حال راه‌اندازی…";
      let info = await L.getDatabase(id);
      for (let i = 0; i < 60 && info.status !== "RUNNING"; i++) { await sleep(5000); info = await L.getDatabase(id); }
      if (info.status !== "RUNNING") throw new Error(`دیتابیس ${d.type} تا ۵ دقیقه آماده نشد (${info.status}).`);
      dbInfo.set(d.id, { ...info, name: defaultDbName(d.type, base) });
      job.databases.push({ id: d.id, hostname: info.hostname, type: d.type });
      s.status = "ok"; s.detail = `${info.hostname}:${info.internalPort} · ${dp.id}`;
    }
  }

  // apps
  const names = new Map(plan.components.map((c) => [c.id, appName(base, c.id)]));
  for (const c of plan.components) {
    s = step(job, `app-${c.id}`, `ساخت برنامه ${names.get(c.id)} (${c.platform})`);
    await L.createProject({ name: names.get(c.id)!, planID: tierPlan(c.tier), platform: c.platform === "dotnet" ? "netcore" : c.platform, bundlePlanID: "basic", network: netId });
    job.apps.push({ id: c.id, name: names.get(c.id)!, url: `https://${names.get(c.id)}.liara.run`, role: c.role });
    s.status = "ok"; s.detail = tierPlan(c.tier);
  }

  // environment: addresses between parts are variables, never literals in the code
  const secrets = new Map<string, string>(); // one random value per name, shared by every part that references it
  const resolve = (v: string) => v.replace(TOKEN, (_m, kind: string | undefined, id: string, part: string, secret?: string) => {
    if (secret) { if (!secrets.has(secret)) secrets.set(secret, randomBytes(24).toString("hex")); return secrets.get(secret)!; }
    if (kind === "db") {
      const d = dbInfo.get(id); if (!d) return "";
      return part === "url" ? dbUrl(d, d.name) : part === "host" ? d.hostname : part === "port" ? String(d.internalPort) : part === "user" ? d.username : part === "password" ? d.password : d.name;
    }
    const c = plan.components.find((x) => x.id === id), n = names.get(id)!;
    return part === "public" ? `https://${n}.liara.run` : part === "host" ? n : `http://${n}:${c?.port ?? 80}`;
  });
  for (const c of plan.components) {
    const vars = plan.env.filter((e) => e.component === c.id).map((e) => ({ key: e.key, value: resolve(e.value) }));
    if (!vars.length) continue;
    s = step(job, `env-${c.id}`, `متغیرهای محیطی ${names.get(c.id)}`);
    await L.updateEnvs(names.get(c.id)!, vars);
    s.status = "ok"; s.detail = vars.map((v) => v.key).join("، ");
  }

  // code edits (hard-coded address -> env variable), then deploy: back ends first, then the front ends that call them
  const skip = new Set(opts.skipEdits ?? []);
  const { watchRelease } = await import("../monitor/scheduler");
  const order = [...p.components].sort((a, b) => (a.role === "backend" ? 0 : 1) - (b.role === "backend" ? 0 : 1));
  for (const comp of order) {
    const pc = plan.components.find((x) => x.id === comp.id)!;
    s = step(job, `deploy-${comp.id}`, `استقرار ${names.get(comp.id)}`);
    const files: Files = { ...comp.files };
    let edited = 0;
    plan.edits.forEach((e, i) => {
      if (e.component !== comp.id || skip.has(i) || !files[e.file]) return;
      const raw = strFromU8(files[e.file]);
      if (raw.split(e.search).length === 2) { files[e.file] = strToU8(raw.replace(e.search, () => e.replace)); edited++; }
    });
    const r = await L.deploySource(names.get(comp.id)!, toTarGz(files), { port: pc.port, platform: pc.platform === "dotnet" ? "netcore" : pc.platform });
    s.status = "ok"; s.detail = edited ? `${edited} تغییر در کد · release ${r.releaseID.slice(-6)}` : `release ${r.releaseID.slice(-6)}`;
    void watchRelease(names.get(comp.id)!, r.releaseID);
  }
  job.done = true; job.ok = true;
  audit({ actor: "user", tool: "create_stack", args: { base, apps: [...names.values()], databases: job.databases.map((d) => d.hostname) }, ok: true, message: "stack created" });
}
