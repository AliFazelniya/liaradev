import { bumpLiara, liaraConfig } from "../store";
import {
  LiaraError,
  type LiaraProvider,
  type LogEntry,
  type Metrics,
  type PlanInfo,
  type PlanBundle,
  type DbInfo,
  type DbPlan,
  type ProjectEvent,
  type Release,
  type BuildInfo,
  type ProjectDetail,
  type ProjectSummary,
} from "./types";

function cfg() {
  const { token, teamID, base } = liaraConfig();
  if (!token) throw new LiaraError("توکن لیارا تنظیم نشده است (Settings یا LIARA_API_TOKEN)", 401);
  return { token, teamID, base };
}

async function call<T>(
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown; form?: FormData; timeoutMs?: number } = {},
): Promise<T> {
  const { token, teamID, base: BASE } = cfg();
  bumpLiara(method, path);
  const url = new URL(path, BASE);
  if (teamID) url.searchParams.set("teamID", teamID);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < (method === "GET" ? 3 : 1); attempt++) {
    try {
      const res = await fetch(url, { method, headers, body, cache: "no-store", signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = text;
      }
      if (!res.ok) {
        const msg =
          (json && typeof json === "object" && ("message" in json || "error" in json)
            ? String((json as Record<string, unknown>).message ?? (json as Record<string, unknown>).error)
            : text) || res.statusText;
        throw new LiaraError(msg, res.status, json);
      }
      return json as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof LiaraError && e.status < 500) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const enc = encodeURIComponent;

const BUNDLE_LABEL: Record<string, string> = { basic: "پایه", standard: "نقره‌ای", pro: "طلایی" };
const PLANETS: [number, string][] = [[0.5, "زمین"], [1, "مریخ"], [2, "مشتری"], [4, "زحل"], [8, "اورانوس"], [16, "نپتون"], [32, "پلوتون"]];
const planetName = (ram: number) => PLANETS.find(([r]) => r === ram)?.[1] ?? `${ram}GB`;

function sinceTs(sec: number) {
  return Math.floor(Date.now() / 1000 - sec);
}

function samples(raw: unknown): number[] {
  // Prometheus-like: [{values:[[ts,"v"],...]}] or {values:[...]} or [{value:[ts,v]}]
  const out: number[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) {
      if (x.length === 2 && (typeof x[1] === "string" || typeof x[1] === "number") && typeof x[0] === "number") {
        const n = Number(x[1]);
        if (!Number.isNaN(n)) out.push(n);
      } else x.forEach(walk);
    } else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(raw);
  return out;
}

// Liara reports a healthy app as "ACTIVE" and keeps it ACTIVE even when stopped (scale 0).
// Normalize to RUNNING / SHUTDOWN, which is what the rest of the app (and users) care about.
const norm = <T extends { status: string; scale?: number }>(p: T): T => ({
  ...p,
  status: p.scale === 0 ? "SHUTDOWN" : p.status === "ACTIVE" ? "RUNNING" : p.status,
});

/** Iran-region apps must live in a private network (error: network_is_required). Reuse one or create it. */
async function ensureNetwork(): Promise<string> {
  const nets = await realLiara.listNetworks();
  if (nets.length) return nets[0]._id;
  return (await realLiara.createNetwork("my-network"))._id;
}

const toDb = (d: any): DbInfo => ({ id: d._id ?? d.id, hostname: d.hostname, type: d.type, version: d.version, status: d.status, planID: d.planID, internalPort: d.internalPort ?? d.port, username: d.username ?? "root", password: d.root_password ?? "", network: d.network?._id ?? d.network });

export const realLiara: LiaraProvider = {
  async getDbCatalog() {
    const me = await call<any>("GET", "/v1/me");
    const bundles = me.plans?.databaseBundlePlans ?? {};
    const plans: DbPlan[] = Object.entries<any>(me.plans?.databases ?? {})
      .filter(([id, p]) => p.available && id.endsWith("-g2"))
      .map(([id, p]) => ({
        id, types: p.supports ?? [], ramGB: p.RAM?.amount ?? 0, volumeGB: p.volume ?? 0, hourlyToman: p.price ?? 0,
        bundles: Object.entries<any>(bundles[id] ?? {}).filter(([, b]) => b.available && b.price !== undefined).map(([bid, b]) => ({ id: bid, monthlyToman: b.displayPrice ?? 0 })),
      }));
    return { plans, versions: me.databaseVersions ?? {} };
  },
  async createDatabase(input) {
    const r = await call<{ databaseID: string }>("POST", "/v1/databases", { body: { ...input, publicNetwork: false } });
    return r.databaseID;
  },
  async getDatabase(id) {
    const r = await call<{ database: any }>("GET", `/v1/databases/${enc(id)}`);
    return toDb(r.database);
  },
  async listDatabases() {
    const r = await call<{ databases: any[] }>("GET", "/v1/databases");
    return (r.databases ?? []).map(toDb);
  },
  async deleteDatabase(id) {
    await call("DELETE", `/v1/databases/${enc(id)}`);
  },
  async listProjects() {
    const r = await call<{ projects: ProjectSummary[] }>("GET", "/v1/projects");
    return (r.projects ?? []).map(norm);
  },
  async getProject(name) {
    const r = await call<{ project: ProjectDetail }>("GET", `/v1/projects/${enc(name)}`);
    return norm(r.project);
  },
  async createProject(input) {
    const plans = input.bundlePlanID ? [] : await realLiara.getPlans();
    const bundlePlanID = input.bundlePlanID ?? plans.find((p) => p.id === input.planID)?.bundleID;
    const network = input.network ?? (await ensureNetwork());
    try {
      await call("POST", "/v1/projects", { body: { name: input.name, planID: input.planID, platform: input.platform, bundlePlanID, network } });
    } catch (e) {
      // A dropped connection does not mean the app was not created (seen in practice). Verify before reporting failure.
      if (e instanceof LiaraError) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      const exists = await call("GET", `/v1/projects/${enc(input.name)}`).then(() => true).catch(() => false);
      if (!exists) throw e;
    }
  },
  async deleteProject(name) {
    await call("DELETE", `/v1/projects/${enc(name)}`);
  },
  async turnProject(name, on) {
    await call("POST", `/v1/projects/${enc(name)}/actions/scale`, { body: { scale: on ? 1 : 0 } });
  },
  async restartProject(name) {
    await call("POST", `/v1/projects/${enc(name)}/actions/restart`);
  },
  async updateEnvs(name, envs) {
    await call("POST", "/v1/projects/update-envs", { body: { project: name, variables: envs } });
  },
  async changePlan(name, planID, bundlePlanID) {
    // Resources and the feature bundle are separate calls in Liara (resize rejects bundlePlanID).
    const cur = (await call<{ project: { planID: string; bundlePlanID?: string } }>("GET", `/v1/projects/${enc(name)}`)).project;
    if (planID && planID !== cur.planID) await call("POST", `/v1/projects/${enc(name)}/resize`, { body: { planID } });
    if (bundlePlanID && bundlePlanID !== cur.bundlePlanID) await call("POST", `/v1/projects/${enc(name)}/resize-bundle-plan`, { body: { bundlePlanID } });
  },
  async getLogs(name, sinceSeconds) {
    // v1 /logs only returns a placeholder line; real runtime logs are served by v2 (Loki-style streams):
    // { data: [{ metaData: {releaseId}, values: [[<unix ns>, '{"type":"stdout","_entry":"..."}'], ...] }] }
    const end = Math.floor(Date.now() / 1000);
    const r = await call<{ data?: { metaData?: { releaseId?: string }; values?: [string, string][] }[] }>("GET", `/v2/projects/${enc(name)}/logs`, {
      query: { start: end - sinceSeconds, end },
    });
    const out: LogEntry[] = [];
    for (const stream of r?.data ?? []) {
      for (const [ns, raw] of stream.values ?? []) {
        let type = "stdout";
        let message = raw;
        try {
          const j = JSON.parse(raw);
          type = j.type ?? type;
          message = j._entry ?? raw;
        } catch { /* plain text line */ }
        if (!message.trim()) continue;
        out.push({ type, datetime: new Date(Number(ns.slice(0, -6))).toISOString(), message, release: (stream as any).metaData?.releaseId });
      }
    }
    return out.sort((a, b) => a.datetime.localeCompare(b.datetime));
  },
  async updatePort(name, port) {
    await call("POST", "/v1/projects/update-port", { body: { project: name, port } });
  },
  async rollbackRelease(releaseID) {
    await call("POST", `/v1/releases/${enc(releaseID)}/rollback`);
  },
  async getReleaseSource(releaseID) {
    // POST returns a short-lived download link to the release's .tar.gz (found in the console bundle, verified)
    const r = await call<{ url: string }>("POST", `/v2/releases/${enc(releaseID)}/source`);
    const res = await fetch(r.url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new LiaraError(`دریافت سورس ناموفق بود (${res.status})`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  },
  async setFlag(name, flag, on) {
    // These endpoints are keyed by the project's internal _id (the name returns a 500) — found by testing.
    const id = (await call<{ project: { _id: string } }>("GET", `/v1/projects/${enc(name)}`)).project._id;
    await call("POST", `/v1/projects/${enc(id)}/${flag}/${on ? "enable" : "disable"}`);
  },
  async getSeries(name, kind, sinceSeconds) {
    const r = await call<unknown>("GET", `/v1/projects/${enc(name)}/metrics/${kind}`, { query: { since: sinceTs(sinceSeconds) } });
    const pts: { t: number; v: number }[] = [];
    const walk = (x: any) => { if (Array.isArray(x)) { if (x.length === 2 && typeof x[0] === "number" && x[1] !== null && !Number.isNaN(Number(x[1]))) pts.push({ t: x[0], v: Number(x[1]) }); else x.forEach(walk); } else if (x && typeof x === "object") Object.values(x).forEach(walk); };
    walk(r);
    return pts.sort((a, b) => a.t - b.t);
  },
  async getSummary(name) {
    const r = await call<{ cpuUsage?: { value: [number, string] }[]; memoryUsage?: { value: [number, string] }[] }>("GET", `/v1/projects/${enc(name)}/metrics/summary`, { query: { since: sinceTs(300) } });
    const n = (a?: { value: [number, string] }[]) => (a?.length ? Number(a[0].value[1]) : null);
    return { cpuCores: n(r.cpuUsage), memBytes: n(r.memoryUsage) };
  },
  async listDisks(name) {
    const r = await call<{ disks?: any[] }>("GET", `/v1/projects/${enc(name)}/disks`);
    return r.disks ?? [];
  },
  async listDomains(name) {
    const r = await call<{ domains?: any[] }>("GET", "/v1/domains", { query: { project: name } });
    return r.domains ?? [];
  },
  async getMe() {
    const r = await call<{ user: { fullname: string; avatar?: string } }>("GET", "/v1/me");
    return { fullname: r.user.fullname, avatar: r.user.avatar };
  },
  async getBalance() {
    // Same numbers the console shows in its header ("اعتبار تیم").
    const r = await call<{ user?: { balance: number }; team?: { balance: number } | null }>("GET", "/v1/billing");
    return { user: r.user?.balance ?? 0, team: r.team?.balance ?? null };
  },
  async getReleases(name) {
    const r = await call<{ currentRelease?: string | null; releases?: { _id: string; state: string; type: string; createdAt: string; port?: number; finishedAt?: string | null; projectType?: string; buildLocation?: string; client?: string; sourceAvailable?: boolean }[] }>("GET", `/v1/projects/${enc(name)}/releases`);
    return (r?.releases ?? [])
      .map((x) => ({ id: x._id, state: x.state, type: x.type, createdAt: x.createdAt, current: x._id === r?.currentRelease, port: x.port ?? null, finishedAt: x.finishedAt ?? null, platform: x.projectType, buildLocation: x.buildLocation, client: x.client, sourceAvailable: x.sourceAvailable }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async getBuild(releaseID) {
    // Same endpoint the official CLI polls while deploying.
    const r = await call<{ release: { state: string; failReason?: string | null; queue?: number | null }; buildOutput?: { stream: string; line: string; createdAt: string }[] }>(
      "GET", `/v2/releases/${enc(releaseID)}/build-logs`,
    );
    return {
      releaseID, state: r.release?.state ?? "UNKNOWN", failReason: r.release?.failReason ?? null, queue: r.release?.queue ?? null,
      lines: (r.buildOutput ?? []).map((o) => ({ stream: o.stream, line: o.line.replace(/\n+$/, ""), at: o.createdAt })).filter((l) => l.line.trim()),
    };
  },
  async getEvents(name) {
    // Container lifecycle feed. An "oom" event is Liara's authoritative out-of-memory signal.
    const r = await call<{ data?: { status: string; time: string; release?: string }[] }>("GET", `/v1/projects/${enc(name)}/events`);
    return (r?.data ?? []).map((e) => ({ status: e.status, time: Number(e.time), release: e.release })).sort((a, b) => a.time - b.time);
  },
  async getMetrics(name): Promise<Metrics> {
    const since = sinceTs(3600);
    const [cpu, mem] = await Promise.all([
      call<unknown>("GET", `/v1/projects/${enc(name)}/metrics/cpu`, { query: { since } }),
      call<unknown>("GET", `/v1/projects/${enc(name)}/metrics/memory`, { query: { since } }),
    ]);
    // Liara returns CPU in cores (0.0074 = 0.74% of one core) and memory in bytes.
    return { cpu: samples(cpu).map((c) => c * 100), memory: samples(mem).map((b) => b / 1048576) };
  },
  async getPlans(): Promise<PlanInfo[]> {
    // No public plans endpoint exists; plans live in /v1/me. Only "-g2" plans are creatable (bundle tier + network).
    // Verified against the console: monthly = plan.displayPrice + bundle.displayPrice (e.g. small-g2 475k + basic 275k = 750k).
    const me = await call<{ plans?: { projects?: Record<string, any>; projectBundlePlans?: Record<string, Record<string, any>> } }>("GET", "/v1/me");
    const out: PlanInfo[] = [];
    for (const [id, p] of Object.entries(me.plans?.projects ?? {})) {
      if (!id.endsWith("-g2") || !p.available || (p.RAM?.amount ?? 0) > 32) continue; // console lists up to 32 GB
      const bundles: PlanBundle[] = Object.entries(me.plans?.projectBundlePlans?.[id] ?? {})
        .filter(([bid, b]) => b.available && bid !== "free")
        .map(([bid, b]) => ({
          id: bid, label: BUNDLE_LABEL[bid] ?? bid,
          hourly: p.price + b.price,
          monthly: (p.displayPrice ?? Math.round(p.price * 720)) + (b.displayPrice ?? Math.round(b.price * 720)),
        }))
        .sort((a, b) => a.monthly - b.monthly);
      if (!bundles.length) continue;
      out.push({
        id, name: planetName(p.RAM?.amount ?? 0), bundleID: bundles[0].id, price: bundles[0].hourly, monthly: bundles[0].monthly,
        volume: p.volume, ramGB: p.RAM?.amount ?? 0, cpu: p.CPU?.amount ?? 0, shared: false, available: true, bundles,
      });
    }
    return out.sort((a, b) => a.ramGB - b.ramGB);
  },
  async checkName(name) {
    // Same call the console makes while typing the app id: 200 = free, 409 = taken (names are global across Liara).
    try {
      await call("GET", `/v1/projects/${enc(name)}/check-availability`);
      return true;
    } catch (e) {
      if (e instanceof LiaraError && e.status === 409) return false;
      throw e;
    }
  },
  async listNetworks() {
    const r = await call<{ networks: { _id: string; name: string; projectCount?: number }[] }>("GET", "/v1/networks");
    return r.networks ?? [];
  },
  async createNetwork(name) {
    const c = await call<{ network: { _id: string } }>("POST", "/v1/networks", { body: { networkName: name } });
    return c.network;
  },
  async deploySource(name, tarGz, opts) {
    const form = new FormData();
    form.append("file", new Blob([tarGz as BlobPart], { type: "application/gzip" }), "source.tar.gz");
    const src = await call<{ sourceID: string }>("POST", `/v2/projects/${enc(name)}/sources`, { form, timeoutMs: 15 * 60_000 }); // source uploads can be 100MB+; the 30s default is for API calls
    const rel = await call<{ releaseID: string }>("POST", `/v2/projects/${enc(name)}/releases`, {
      body: { sourceID: src.sourceID, port: opts.port, type: opts.platform, ...(opts.extra ?? {}) },
    });
    return { sourceID: src.sourceID, releaseID: rel.releaseID };
  },
};
