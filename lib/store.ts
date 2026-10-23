import fs from "node:fs";
import path from "node:path";

export type Mode = "assistant" | "autopilot" | "auto";
export type Level = "manual" | "assistant";

export interface UsageEntry {
  at: string;
  source: "chat" | "wizard" | "monitor" | "diagnose";
  provider: string;
  model: string;
  promptTokens: number;
  cacheHitTokens: number;
  completionTokens: number;
  costUSD: number;
  ms: number;
  note?: string;
}

export interface Approval {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  title: string; // human summary in Persian
  reason: string;
  impact: string;
  status: "pending" | "approved" | "rejected" | "failed";
  source: "chat" | "monitor" | "wizard" | "mcp";
  createdAt: string;
  resolvedAt?: string;
  result?: string;
  verification?: string;
  details?: any; // e.g. the exact dependency changes an approval would apply
}

export interface AuditEntry {
  at: string;
  actor: "ai" | "user" | "scheduler" | "mcp";
  tool: string;
  args: unknown;
  ok: boolean;
  message: string;
}

/** mode "process": the app does not answer HTTP (bot/worker), so liveness comes from container state and logs instead of a request */
export interface UptimeSample { t: number; up: boolean; ms?: number; status?: number; error?: string; mode?: "http" | "process" }

export interface HealthReport {
  id: string;
  project: string;
  at: string;
  severity: "ok" | "warning" | "critical";
  summary: string;
  causes: { title: string; confidence: number; evidence: string[] }[];
  actions: { tool: string; args: Record<string, unknown>; why: string; kind?: "fix" | "workaround" }[];
  metrics?: { cpuAvg: number; memMaxMB: number; memLimitMB: number };
  approvalIds: string[];
  autoApplied: string[];
  /** AI explanation written once when a new issue first appears (scheduler runs only) */
  narrative?: string;
  /** the AI SRE decision for this issue (cause, verified evidence, one proposal) */
  decision?: import("./ai/sre").Decision;
  /** identifies the issue so repeated sightings update one entry instead of flooding the log */
  fingerprint?: string;
  /** how many sweeps saw the same state, and when last */
  seen?: number;
  lastSeenAt?: string;
  recovered?: boolean;
  /** the app was (re)started minutes ago: "no problem yet" is not a final verdict */
  settling?: boolean;
}

export interface State {
  settings: {
    mode: Mode;
    level: Level | null;
    mcp: { enabled: boolean; access: "read" | "propose"; token: string };
    pricing: { hit: number; miss: number; out: number }; // USD per 1M tokens (editable estimates)
    monitorEveryMinutes: number;
    monitorEnabled: boolean;
    aiLabel: string; // provider display name (any OpenAI-compatible endpoint)
    aiBaseUrl: string;
    aiModel: string;
    aiKey: string;
    liaraBase: string;
    liaraToken: string;
    teamID: string;
  };
  approvals: Approval[];
  audit: AuditEntry[];
  reports: HealthReport[];
  /** liveness samples per app (every ~5 min, last ~48h): t = unix seconds */
  uptime: Record<string, UptimeSample[]>;
  usage: UsageEntry[];
  liaraCalls: Record<string, number>;
}

const FILE = path.join(process.cwd(), ".data", "state.json");

function defaults(): State {
  return {
    settings: {
      mode: "assistant",
      level: null,
      mcp: { enabled: false, access: "propose", token: "" },
      pricing: { hit: 0.0028, miss: 0.14, out: 0.28 },
      monitorEveryMinutes: 60,
      monitorEnabled: true,
      // connection values entered in the UI; empty = fall back to the environment (see aiConfig / liaraConfig)
      aiLabel: "",
      aiBaseUrl: "",
      aiModel: "",
      aiKey: "",
      liaraBase: "",
      liaraToken: "",
      teamID: "",
    },
    approvals: [],
    audit: [],
    reports: [],
    uptime: {},
    usage: [],
    liaraCalls: {},
  };
}

const g = globalThis as unknown as { __state?: State };

export function getState(): State {
  if (!g.__state) {
    let s = defaults();
    try {
      const disk = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<State>;
      const old: any = disk.settings ?? {};
      const migrated = { ...(old.deepseekKey ? { aiKey: old.deepseekKey, aiLabel: old.aiLabel ?? "DeepSeek" } : {}), ...(old.deepseekModel ? { aiModel: old.deepseekModel } : {}) };
      if (old.level && old.level !== "manual" && old.level !== "assistant") old.level = old.level === "expert" ? "manual" : "assistant";
      delete old.mock; delete old.deepseekKey; delete old.deepseekModel;
      s = { ...s, ...disk, settings: { ...s.settings, ...migrated, ...old } };
    } catch {
      /* first run */
    }
    g.__state = s;
  }
  g.__state.uptime ??= {}; // state objects created before this field existed (hot reload)
  return g.__state;
}

export function save() {
  const s = getState();
  s.audit = s.audit.slice(-300);
  s.reports = s.reports.slice(-100);
  s.usage = s.usage.slice(-3000);
  s.approvals = s.approvals.slice(-200);
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
  } catch {
    /* read-only fs: keep in memory */
  }
}

type Src = "settings" | "env" | "default" | "none";
const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean) ?? "";
const pick = (ui: string, e: string, d = ""): { v: string; from: Src } => (ui ? { v: ui, from: "settings" } : e ? { v: e, from: "env" } : d ? { v: d, from: "default" } : { v: "", from: "none" });

/** Effective AI provider (any OpenAI-compatible endpoint): a value saved in Settings wins, otherwise the environment (AI_* or legacy DEEPSEEK_*). */
export function aiConfig() {
  const s = getState().settings;
  const key = pick(s.aiKey, env("AI_API_KEY", "DEEPSEEK_API_KEY"));
  const baseUrl = pick(s.aiBaseUrl, env("AI_BASE_URL", "DEEPSEEK_BASE_URL"), "https://api.deepseek.com");
  const model = pick(s.aiModel, env("AI_MODEL", "DEEPSEEK_MODEL"), "deepseek-chat");
  const label = pick(s.aiLabel, env("AI_LABEL"), env("DEEPSEEK_API_KEY") && !s.aiKey ? "DeepSeek" : "");
  return { key: key.v, baseUrl: baseUrl.v, model: model.v, label: label.v, from: { key: key.from, baseUrl: baseUrl.from, model: model.from, label: label.from } };
}

/** Effective Liara connection: Settings value, otherwise LIARA_API_BASE / LIARA_API_TOKEN / LIARA_TEAM_ID. */
export function liaraConfig() {
  const s = getState().settings;
  const base = pick(s.liaraBase, env("LIARA_API_BASE"), "https://api.iran.liara.ir");
  const token = pick(s.liaraToken, env("LIARA_API_TOKEN"));
  const team = pick(s.teamID, env("LIARA_TEAM_ID"));
  return { base: base.v.replace(/\/$/, ""), token: token.v, teamID: team.v || undefined, from: { base: base.from, token: token.from, teamID: team.from } };
}

export function audit(e: Omit<AuditEntry, "at">) {
  getState().audit.push({ at: new Date().toISOString(), ...e });
  save();
}

export const uid = () => Math.random().toString(36).slice(2, 10);

const mask = (v: string) => (v ? (v.length > 10 ? v.slice(0, 4) + "••••" + v.slice(-3) : "••••") : "");

/** Settings for the UI: secrets are masked; `ai` / `liara` show what is effectively used and where it comes from. */
export function maskedSettings() {
  const s = getState().settings;
  const ai = aiConfig(), li = liaraConfig();
  return {
    ...s,
    aiKey: "", liaraToken: "", // never sent back; see ai.keyMasked / liara.tokenMasked
    mcp: { enabled: s.mcp.enabled, access: s.mcp.access, hasToken: !!s.mcp.token },
    ai: { label: ai.label, baseUrl: ai.baseUrl, model: ai.model, keyMasked: mask(ai.key), hasKey: !!ai.key, from: ai.from },
    liara: { base: li.base, tokenMasked: mask(li.token), hasToken: !!li.token, teamID: li.teamID ?? "", from: li.from },
  };
}

/** Record one LLM call (tokens + estimated cost) so the admin page can show where the money goes. */
export function recordUsage(u: Omit<UsageEntry, "at" | "costUSD">) {
  const { pricing } = getState().settings;
  const miss = Math.max(0, u.promptTokens - u.cacheHitTokens);
  const costUSD = (u.cacheHitTokens * pricing.hit + miss * pricing.miss + u.completionTokens * pricing.out) / 1_000_000;
  getState().usage.push({ at: new Date().toISOString(), costUSD, ...u });
  save();
}

let bumps = 0;
/** Count Liara API requests per endpoint (ids normalized) — the other half of "API usage". */
export function bumpLiara(method: string, path: string) {
  const key = `${method} ${path.replace(/\/projects\/[^/?]+/g, "/projects/{name}").replace(/\/releases\/[^/?]+/g, "/releases/{id}").split("?")[0]}`;
  const c = getState().liaraCalls;
  c[key] = (c[key] ?? 0) + 1;
  if (++bumps % 15 === 0) save();
}
