import { strFromU8 } from "fflate";
import { analyze, type CodebaseReport, type Files } from "../analyzer/codebase";

/**
 * Multi-part projects: find the separately deployable parts (frontend, backend, workers…) and the databases they use.
 * Pure file rules; the AI refines the result afterwards (lib/ai/architect.ts).
 */
export interface Component { id: string; dir: string; role: "frontend" | "backend"; report: CodebaseReport; files: Files }
export interface DbHint { type: "mongodb" | "postgres" | "mysql" | "mariadb" | "redis"; evidence: string; usedBy: string[] }
export interface StackInfo { components: Omit<Component, "files">[]; databases: DbHint[]; multi: boolean }

const MARKER = /^(package\.json|requirements\.txt|pyproject\.toml|Pipfile|composer\.json|go\.mod|Dockerfile|manage\.py)$|\.csproj$/;
const FRONT = ["react", "vue", "angular", "static"];
const text = (b?: Uint8Array) => (b ? strFromU8(b) : "");

/** Folders (depth ≤ 2) that contain a project marker file directly. */
function roots(files: Files): string[] {
  const dirs = new Set<string>();
  for (const f of Object.keys(files)) {
    if (/(^|\/)(node_modules|vendor|\.git|dist|build|venv|\.venv)\//.test(f)) continue;
    const parts = f.split("/"), name = parts[parts.length - 1], dir = parts.slice(0, -1);
    if (dir.length <= 2 && MARKER.test(name)) dirs.add(dir.join("/"));
    if (dir.length >= 1 && dir.length <= 2 && name === "index.html" && !dir.includes("public") && !dir.includes("static")) dirs.add(dir.join("/"));
  }
  // an index.html next to a package.json is part of that project, not a separate one
  const list = [...dirs].sort((a, b) => a.length - b.length);
  return list.filter((d) => !list.some((o) => o !== d && o !== "" && d.startsWith(o + "/")));
}

export function detectComponents(files: Files): Component[] {
  let dirs = roots(files);
  if (dirs.length > 1) dirs = dirs.filter((d) => d !== ""); // a monorepo root only holds tooling
  const out: Component[] = [];
  for (const dir of dirs) {
    const sub: Files = {};
    for (const [f, b] of Object.entries(files)) if (!dir || f.startsWith(dir + "/")) sub[dir ? f.slice(dir.length + 1) : f] = b;
    const report = analyze(sub);
    if (report.framework === "unknown" && !Object.keys(sub).some((f) => /\.(js|py|php|go|cs)$/.test(f))) continue;
    const id = (dir.split("/").pop() || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
    out.push({ id, dir, role: FRONT.includes(report.platform) ? "frontend" : "backend", report, files: sub });
  }
  return out;
}

const DB_RULES: { type: DbHint["type"]; re: RegExp }[] = [
  { type: "mongodb", re: /\b(mongoose|mongodb|pymongo|motor|mongoengine)\b|image:\s*['"]?mongo/i },
  { type: "postgres", re: /\b(pg|pg-promise|postgres|psycopg2(?:-binary)?|asyncpg|pgx|npgsql)\b|image:\s*['"]?postgres|provider\s*=\s*"postgresql"/i },
  { type: "mysql", re: /\b(mysql2?|mysqlclient|pymysql|mysql-connector)\b|image:\s*['"]?mysql/i },
  { type: "mariadb", re: /image:\s*['"]?mariadb/i },
  { type: "redis", re: /\b(redis|ioredis|aioredis|django-redis|connect-redis)\b|image:\s*['"]?redis/i },
];

export function detectDatabases(files: Files, comps: Component[]): DbHint[] {
  const hints = new Map<string, DbHint>();
  const scan = (label: string, id: string | null, body: string) => {
    for (const r of DB_RULES) {
      const m = body.match(r.re);
      if (!m) continue;
      const h = hints.get(r.type) ?? { type: r.type, evidence: `${label}: ${m[0]}`, usedBy: [] };
      if (id && !h.usedBy.includes(id)) h.usedBy.push(id);
      hints.set(r.type, h);
    }
  };
  for (const c of comps) {
    const other = [c.files["requirements.txt"], c.files["composer.json"], c.files["Pipfile"], c.files["pyproject.toml"], c.files["go.mod"]].map(text).join("\n");
    // package.json: dependency names only (not scripts or description text)
    let names = "";
    try { const p = JSON.parse(text(c.files["package.json"])); names = Object.keys({ ...p.dependencies, ...p.devDependencies }).join(" "); } catch { /* not json */ }
    scan(`${c.dir || "."}`, c.id, names + "\n" + other);
  }
  for (const [f, b] of Object.entries(files)) if (/(^|\/)docker-compose[\w.-]*\.ya?ml$/.test(f)) scan(f, null, text(b));
  // a database found only in compose belongs to the backends
  for (const h of hints.values()) if (!h.usedBy.length) h.usedBy = comps.filter((c) => c.role === "backend").map((c) => c.id);
  if (hints.has("mariadb") && hints.has("mysql")) hints.delete("mysql");
  return [...hints.values()];
}

export function detectStack(files: Files): { info: StackInfo; components: Component[] } {
  const components = detectComponents(files);
  const databases = detectDatabases(files, components);
  const multi = components.length >= 2 || (components.length >= 1 && databases.length >= 1);
  return { info: { components: components.map(({ files: _f, ...c }) => c), databases, multi }, components };
}
