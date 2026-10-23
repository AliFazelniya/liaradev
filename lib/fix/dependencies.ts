import { strFromU8, strToU8 } from "fflate";
import type { Files } from "../analyzer/codebase";

export interface DepChange {
  kind: "rename" | "version" | "remove";
  pkg: string;
  from: string;
  to: string | null; // new "name@spec" (or null when the package is removed)
  newName?: string;
  reason: string;
}
export interface DepFix { changes: DepChange[]; files: Files; blocked: string[] }

const REG = "https://registry.npmjs.org";

const get = async (url: string, accept?: string) => {
  try {
    const res = await fetch(url, { headers: accept ? { Accept: accept } : undefined, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (res.status === 404) return { status: 404 as const };
    return res.ok ? { status: 200 as const, json: await res.json() } : { status: 0 as const };
  } catch {
    return { status: 0 as const }; // unreachable: callers leave the dependency untouched
  }
};
const meta = (name: string) => get(`${REG}/${name.replace("/", "%2F")}`, "application/vnd.npm.install-v1+json");

const lev = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const semverKey = (v: string) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
const cmp = (a: string, b: string) => { const x = semverKey(a), y = semverKey(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
const majorOf = (spec: string) => spec.match(/(\d+)\./)?.[1];
const esc = (t: string) => t.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

/** Highest published version with the requested major (else the latest dist-tag), keeping the user's pin style. */
function pickVersion(m: any, spec: string): string {
  const all = Object.keys(m.versions ?? {}).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(cmp);
  const mj = majorOf(spec);
  const same = mj ? all.filter((v) => v.startsWith(mj + ".")) : [];
  const chosen = same.length ? same[same.length - 1] : (m["dist-tags"]?.latest ?? all[all.length - 1]);
  return /^[\^~]/.test(spec) ? `${spec[0]}${chosen}` : chosen;
}

/** Likely typo corrections of a package name: drop one letter, swap two neighbours (registry search ranks typos poorly). */
function typoCandidates(name: string): string[] {
  const set = new Set<string>();
  const slash = name.startsWith("@") ? name.indexOf("/") + 1 : 0;
  const scope = name.slice(0, slash), base = name.slice(slash);
  for (let i = 0; i < base.length; i++) set.add(base.slice(0, i) + base.slice(i + 1));
  for (let i = 0; i < base.length - 1; i++) set.add(base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2));
  return [...set].filter((c) => c.length >= 2 && c !== base).map((c) => scope + c);
}

/** Candidate real names for a bad package name: generated typo fixes first, then registry search. */
async function nearNames(name: string): Promise<string[]> {
  const search = await get(`${REG}/-/v1/search?text=${encodeURIComponent(name)}&size=8`);
  const found: { name: string; score: number }[] = ((search as any).json?.objects ?? []).map((o: any) => ({ name: o.package.name, score: o.score?.final ?? 0 }));
  const fromSearch = found.filter((c) => c.name !== name && lev(c.name, name) <= 2).sort((a, b) => lev(a.name, name) - lev(b.name, name) || b.score - a.score).map((c) => c.name);
  return [...new Set([...typoCandidates(name), ...fromSearch])].slice(0, 40);
}

/** Does any source file reference the package? (never auto-remove something the code imports) */
function usedInCode(files: Files, pkg: string): boolean {
  const re = new RegExp("(?:require\\(|from\\s+|import\\s+)[\"']" + esc(pkg) + "(?:/[^\"']*)?[\"']");
  return Object.entries(files).some(([f, d]) => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(f) && !f.includes("node_modules") && d.length < 400_000 && re.test(strFromU8(d)));
}

/** Plan an automatic fix for dependency problems that break `npm install`: typo'd names and non-existent versions. */
export async function planDependencyFix(files: Files): Promise<DepFix> {
  const out: DepFix = { changes: [], files: { ...files }, blocked: [] };
  const raw = files["package.json"];
  if (!raw) { out.blocked.push("package.json پیدا نشد؛ فعلاً فقط پروژه‌های Node پشتیبانی می‌شوند."); return out; }
  let pkg: any;
  try { pkg = JSON.parse(strFromU8(raw)); } catch { out.blocked.push("package.json نامعتبر است (JSON خراب)."); return out; }
  const deps: Record<string, string> = { ...(pkg.dependencies ?? {}) };
  const next: Record<string, string> = {};

  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== "string" || /^(file:|git|http|workspace:|npm:|link:)/.test(spec)) { next[name] = spec; continue; }
    const m = await meta(name);
    if (m.status === 0) { next[name] = spec; continue; }

    if (m.status === 404) {
      let near: string | undefined;
      for (const c of await nearNames(name)) { if ((await meta(c)).status === 200) { near = c; break; } }
      if (near) {
        const nm = await meta(near);
        const to = nm.status === 200 ? pickVersion((nm as any).json, spec) : spec;
        out.changes.push({ kind: "rename", pkg: name, from: `${name}@${spec}`, to: `${near}@${to}`, newName: near, reason: `«${name}» در npm وجود ندارد؛ نزدیک‌ترین پکیج «${near}» است (احتمالاً غلط املایی).` });
        next[near] = to;
      } else if (!usedInCode(files, name)) {
        out.changes.push({ kind: "remove", pkg: name, from: `${name}@${spec}`, to: null, reason: `«${name}» در npm وجود ندارد و در کد استفاده نشده؛ حذف می‌شود.` });
      } else {
        out.blocked.push(`«${name}» در npm وجود ندارد و در کد استفاده شده؛ جایگزین مطمئنی پیدا نشد و باید دستی اصلاح شود.`);
        next[name] = spec;
      }
      continue;
    }

    // the package exists: is the requested exact version real?
    const exact = spec.match(/^[\^~]?(\d+\.\d+\.\d+)$/)?.[1];
    if (exact && !(exact in ((m as any).json.versions ?? {}))) {
      // a name one typo away may be the real package (typo-squatted placeholders exist on npm, e.g. "expresss")
      let renamed = false;
      for (const cand of await nearNames(name)) {
        const cm = await meta(cand);
        if (cm.status === 200 && exact in ((cm as any).json.versions ?? {})) {
          out.changes.push({ kind: "rename", pkg: name, from: `${name}@${spec}`, to: `${cand}@${spec}`, newName: cand, reason: `نسخه‌ی ${exact} در «${name}» وجود ندارد ولی در «${cand}» هست؛ احتمالاً غلط املایی در نام پکیج است.` });
          next[cand] = spec; renamed = true; break;
        }
      }
      if (!renamed) {
        const to = pickVersion((m as any).json, spec);
        const sameMajor = majorOf(to.replace(/^[\^~]/, "") + ".") === majorOf(spec);
        out.changes.push({ kind: "version", pkg: name, from: `${name}@${spec}`, to: `${name}@${to}`, reason: `نسخه‌ی ${exact} از «${name}» وجود ندارد؛ نزدیک‌ترین نسخه‌ی موجود ${to.replace(/^[\^~]/, "")} است.${sameMajor ? "" : " نسخه‌ی اصلی متفاوت است؛ پس از استقرار سازگاری را بررسی کنید."}` });
        next[name] = to;
      }
    } else next[name] = spec;
  }

  if (out.changes.length) {
    out.files["package.json"] = strToU8(JSON.stringify({ ...pkg, dependencies: next }, null, 2) + "\n");
    // a lock file written for the old dependency set would conflict with the patched one
    for (const lock of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]) delete out.files[lock];
  }
  return out;
}
