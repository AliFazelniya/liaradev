import { strFromU8 } from "fflate";
import type { Files } from "../analyzer/codebase";
import { PLATFORMS } from "../platforms";
import { redactText } from "../redact";
import { detectStack, type Component, type DbHint } from "../stack/detect";
import { preflight } from "../analyzer/preflight";
import { planUploadFix } from "../fix/upload";
import { aiConfigured, callLLM } from "./llm";

/**
 * Turns a multi-part upload (frontend + backend + database…) into one reviewed plan: which parts, which plans, how they connect.
 * The AI reads README / env examples / hard-coded addresses; everything it returns is validated against the real files and Liara's catalog.
 * Nothing is created here: the user confirms the plan first (lib/stack/run.ts executes it).
 */
export type Tier = "small" | "medium" | "large";
export interface PlanComponent { id: string; dir: string; name: string; role: "frontend" | "backend"; platform: string; port: number; tier: Tier; why: string }
export interface PlanDb { id: string; type: string; version: string; tier: Tier; why: string }
export interface PlanEnv { component: string; key: string; value: string; why: string }
export interface PlanEdit { component: string; file: string; search: string; replace: string; why: string }
export interface PlanFix { component: string; changes: { from: string; to: string | null; reason: string }[] }
export interface StackPlan { fixes: PlanFix[]; blocked: { component: string; text: string }[]; summary: string; components: PlanComponent[]; databases: PlanDb[]; env: PlanEnv[]; edits: PlanEdit[]; notes: string[] }

const IDS = PLATFORMS.map((p) => p.id);
const TIERS: Tier[] = ["small", "medium", "large"];
const TOKEN = /\{\{(?:(db|app):([a-z0-9-]+)\.(url|host|port|user|password|name|internal|public)|secret:([A-Za-z0-9_]+))\}\}/g;
export const tierPlan = (t: Tier) => (t === "small" ? "small-g2" : t === "medium" ? "medium-g2" : "standard-base-g2");

const SYSTEM = `You design the deployment of a multi-part web project on Liara (Iranian PaaS). You get its parts (folders), detected databases, README, env examples, env variables each part reads, and hard-coded addresses found in the code.

Rules:
- Use ONLY what you are given. Never invent parts, files or variables.
- All parts and databases share ONE private network. Inside it, a part reaches another by its app name, a database by its hostname. A BROWSER cannot use the private network: a front end that calls the API from the browser needs the API's PUBLIC address.
- Every address between parts must become an environment variable. If the code reads an env var for it, set that exact variable. If the address is hard-coded in code, add an "edit": replace only the hard-coded literal with the env variable read (process.env.X / os.environ["X"] ...), "search" copied VERBATIM from the code line given and unique in that file, minimal. For a React/CRA front end use REACT_APP_*, Vite VITE_*, Vue VUE_APP_*; they are baked in at build time.
- Every database must end up really connected. First use the env vars the code already reads (envVarsRead, envExamples) and map each to the right token (e.g. MONGO_USER={{db:ID.user}}, MONGO_PASSWORD={{db:ID.password}}, MONGO_DB={{db:ID.name}}). If the code still contains a fixed host or scheme (e.g. a mongodb+srv:// Atlas host), add an edit so that part is also read from env (e.g. MONGO_HOST={{db:ID.host}}:{{db:ID.port}}) and use the plain scheme the Liara database needs (mongodb://, ...?authSource=admin for MongoDB). Do not add a variable the code never reads unless you also add the edit that reads it.
- Value tokens (resolved at launch): {{db:ID.url}} full connection URL, {{db:ID.host}} {{db:ID.port}} {{db:ID.user}} {{db:ID.password}} {{db:ID.name}}, {{app:ID.internal}} http://appname:port (server to server), {{app:ID.public}} https://appname.liara.run (browser). ID = a part id or database id. Secrets only via tokens, never literal: database credentials through the db tokens, and any app secret the code needs (JWT / session / cookie secret) as {{secret:NAME}}, which is generated randomly at launch.
- Plans: tier small (0.5GB), medium (1GB), large (2GB). Default small; use medium/large only with a reason from the evidence (heavy dependencies, build-heavy, etc.). Platform must be one of: ${IDS.join(", ")}. A static front end is react/vue/angular/static on port 80.
- Databases: type from the detected list (mongodb, postgres, mysql, mariadb, redis). One database per type unless the evidence says otherwise.
- "why" fields: one short Persian sentence. summary: max 25 Persian words. notes: max 3, only real caveats (for example a database schema the app must create itself).
- Answer only by calling submit_stack.`;

const TOOL = [{
  type: "function",
  function: {
    name: "submit_stack",
    description: "The deployment plan.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        components: { type: "array", items: { type: "object", properties: { id: { type: "string" }, platform: { type: "string" }, port: { type: "number" }, tier: { type: "string", enum: TIERS }, why: { type: "string" } }, required: ["id", "platform", "port", "tier", "why"] } },
        databases: { type: "array", items: { type: "object", properties: { id: { type: "string" }, type: { type: "string" }, tier: { type: "string", enum: TIERS }, why: { type: "string" } }, required: ["id", "type", "tier", "why"] } },
        env: { type: "array", items: { type: "object", properties: { component: { type: "string" }, key: { type: "string" }, value: { type: "string" }, why: { type: "string" } }, required: ["component", "key", "value", "why"] } },
        edits: { type: "array", items: { type: "object", properties: { component: { type: "string" }, file: { type: "string" }, search: { type: "string" }, replace: { type: "string" }, why: { type: "string" } }, required: ["component", "file", "search", "replace", "why"] } },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "components", "databases", "env"],
    },
  },
}];

const text = (b?: Uint8Array) => (b ? strFromU8(b) : "");

/** What each part reads from the environment, and addresses written into the code. */
function evidence(c: Component) {
  const envKeys = new Map<string, string>(), hard: string[] = [];
  const example = Object.entries(c.files).filter(([f]) => /(^|\/)(\.env\.(example|sample|template)|nodemon\.json|env\.example)$/.test(f)).map(([f, b]) => `${f}: ${redactText(text(b)).slice(0, 600)}`);
  for (const [f, b] of Object.entries(c.files)) {
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|py|php|go|cs|vue|html)$/.test(f) || /(^|\/)(node_modules|dist|build|vendor)\//.test(f) || b.length > 250_000) continue;
    const lines = text(b).split("\n");
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|os\.environ(?:\.get)?\(?\[?["']([A-Z][A-Z0-9_]+)|getenv\(["']([A-Z][A-Z0-9_]+)/g)) { const k = m[1] ?? m[2] ?? m[3]; if (!envKeys.has(k)) envKeys.set(k, f); }
      if (hard.length < 20 && /(https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)[:\d/\w.-]*|mongodb(\+srv)?:\/\/[^\s'"`]+|postgres(ql)?:\/\/[^\s'"`]+|mysql:\/\/[^\s'"`]+|redis:\/\/[^\s'"`]+|["'`]localhost["'`]|\b(host|HOST)\s*[:=]\s*["'](localhost|127\.0\.0\.1)["'])/.test(l) && !/^\s*(\/\/|#|\*)/.test(l))
        hard.push(`${f}:${i + 1}: ${redactText(l.trim()).slice(0, 170)}`);
    });
  }
  const pkg = (() => { try { const p = JSON.parse(text(c.files["package.json"])); return { scripts: p.scripts, deps: Object.keys(p.dependencies ?? {}).slice(0, 18) }; } catch { return undefined; } })();
  return { id: c.id, dir: c.dir || ".", detected: { role: c.role, platform: c.report.platform, framework: c.report.framework, port: c.report.port }, package: pkg, envVarsRead: [...envKeys].slice(0, 25).map(([k, f]) => `${k} (${f})`), envExamples: example, hardCodedAddresses: hard };
}

export async function planStack(files: Files, hint?: { baseName?: string }): Promise<{ plan: StackPlan; components: Component[]; dbHints: DbHint[] }> {
  if (!aiConfigured()) throw Object.assign(new Error("برای طراحی ساختار چندبخشی کلید هوش مصنوعی را در تنظیمات وارد کنید."), { status: 400 });
  const { info, components } = detectStack(files);
  if (!info.multi) throw Object.assign(new Error("این پروژه چندبخشی تشخیص داده نشد."), { status: 422 });
  const docs = Object.entries(files).filter(([f]) => /^(README|readme)(\.md)?$/.test(f) || /^(docs?\/)?(install|running|setup)\.md$/i.test(f) || /(^|\/)docker-compose[\w.-]*\.ya?ml$/.test(f))
    .map(([f, b]) => `--- ${f}\n${redactText(text(b)).slice(0, f.toLowerCase().includes("compose") ? 2500 : 3500)}`).join("\n");
  const user = JSON.stringify({ project: hint?.baseName, parts: components.map(evidence), databasesDetected: info.databases.map((d) => ({ type: d.type, evidence: d.evidence, usedBy: d.usedBy })), docs });
  const { message } = await callLLM({ messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], tools: TOOL, tool_choice: { type: "function", function: { name: "submit_stack" } }, max_tokens: 1800, temperature: 0 }, { source: "wizard", note: "stack plan" });
  const out_fixes: PlanFix[] = [], out_blocked: { component: string; text: string }[] = [];
  let a: any = {};
  try { a = JSON.parse(message.tool_calls?.[0]?.function?.arguments ?? "{}"); } catch { throw Object.assign(new Error("پاسخ هوش مصنوعی قابل استفاده نبود؛ دوباره تلاش کنید."), { status: 502 }); }

  // what would break each part's build/start (lock file mismatch, missing start script…): fix it now, show it in the plan
  for (const c of components) {
    const pf = await preflight(c.files, c.report);
    if (!pf.blockers.length) continue;
    const fix = await planUploadFix(c.files).catch(() => null);
    if (fix?.changes.length) { c.files = fix.files; out_fixes.push({ component: c.id, changes: fix.changes }); }
    for (const b of (await preflight(c.files, c.report)).blockers) out_blocked.push({ component: c.id, text: b });
  }
  const byId = new Map(components.map((c) => [c.id, c]));
  const out: StackPlan = { fixes: [], blocked: [], summary: String(a.summary ?? "").slice(0, 300), components: [], databases: [], env: [], edits: [], notes: (Array.isArray(a.notes) ? a.notes : []).map((n: unknown) => String(n).slice(0, 200)).slice(0, 3) };
  // parts: every detected part is deployed; the AI only tunes platform / port / tier
  for (const c of components) {
    const x = (Array.isArray(a.components) ? a.components : []).find((y: any) => y.id === c.id) ?? {};
    const platform = IDS.includes(x.platform) ? x.platform : c.report.platform === "dotnet" ? "netcore" : c.report.platform;
    const port = Number.isInteger(x.port) && x.port > 0 && x.port < 65536 ? x.port : c.report.port;
    const isStatic = ["static", "react", "vue", "angular"].includes(platform);
    out.components.push({ id: c.id, dir: c.dir, name: "", role: isStatic ? "frontend" : "backend", platform, port: isStatic ? 80 : port, tier: TIERS.includes(x.tier) ? x.tier : "small", why: String(x.why ?? "").slice(0, 200) });
  }
  const dbIds = new Set<string>();
  for (const h of info.databases) {
    const x = (Array.isArray(a.databases) ? a.databases : []).find((y: any) => y.type === h.type) ?? {};
    const id = String(x.id ?? h.type).toLowerCase().replace(/[^a-z0-9-]/g, "") || h.type;
    if (dbIds.has(id)) continue;
    dbIds.add(id);
    out.databases.push({ id, type: h.type, version: "", tier: TIERS.includes(x.tier) ? x.tier : "small", why: String(x.why ?? "").slice(0, 200) });
  }
  const refOk = (v: string) => [...v.matchAll(TOKEN)].every((m) => (m[4] ? true : m[1] === "db" ? dbIds.has(m[2]) : byId.has(m[2])));
  for (const e of Array.isArray(a.env) ? a.env : []) {
    const key = String(e.key ?? ""), value = String(e.value ?? "");
    if (!byId.has(e.component) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.length > 500 || !refOk(value)) continue;
    if (!out.env.some((x) => x.component === e.component && x.key === key)) out.env.push({ component: e.component, key, value, why: String(e.why ?? "").slice(0, 160) });
  }
  for (const e of Array.isArray(a.edits) ? a.edits : []) {
    const c = byId.get(e.component), raw = c && c.files[e.file] ? text(c.files[e.file]) : "";
    if (!raw || !e.search || raw.split(e.search).length !== 2 || String(e.replace ?? "").length > 600) continue; // must match the real file exactly once
    out.edits.push({ component: e.component, file: e.file, search: String(e.search), replace: String(e.replace), why: String(e.why ?? "").slice(0, 160) });
  }
  out.fixes = out_fixes; out.blocked = out_blocked;
  return { plan: out, components, dbHints: info.databases };
}

export { TOKEN };
