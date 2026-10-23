import { strFromU8 } from "fflate";
import type { CodebaseReport, Files } from "./codebase";
import { checkSyntax } from "./syntax";

/** Checks that can be done before deploying: things that would make the build or start fail. */
export async function preflight(files: Files, r: CodebaseReport): Promise<{ blockers: string[]; warnings: string[] }> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const exists = async (url: string): Promise<boolean | null> => {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000), cache: "no-store" });
      if (res.status === 404) return false;
      return res.ok ? true : null; // anything else = unknown, never block on it
    } catch {
      return null;
    }
  };
  const inPool = async <T,>(items: T[], fn: (x: T) => Promise<void>) => {
    const q = [...items];
    await Promise.all(Array.from({ length: 8 }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await fn(x); }));
  };

  if (files["package.json"]) {
    let pkg: any = {};
    try { pkg = JSON.parse(strFromU8(files["package.json"])); } catch { blockers.push("package.json نامعتبر است (JSON خراب)."); }
    if (r.platform === "node" && !pkg.scripts?.start && !pkg.main) blockers.push("اسکریپت start در package.json تعریف نشده؛ لیارا نمی‌داند برنامه را چطور اجرا کند.");
    // the start file loads compiled output (dist/ build/ …) that is not in the upload, and nothing builds it
    const startFile = String(pkg.scripts?.start ?? "").match(/\bnode\s+(?:--[\w-]+\s+)*(\.?\/?[\w./-]+)/)?.[1]?.replace(/^\.\//, "");
    const src = startFile && files[startFile] ? strFromU8(files[startFile]) : "";
    for (const m of src.matchAll(/require\(\s*["'](\.{1,2}\/[^"']*?\b(dist|build|out)\/[^"']*)["']\s*\)/g)) {
      const dir = m[2], has = Object.keys(files).some((f) => f === dir || f.startsWith(dir + "/") || f.includes("/" + dir + "/"));
      if (!has && !pkg.scripts?.build) { blockers.push(`«${startFile}» فایل ساخته‌شده‌ی «${dir}/» را اجرا می‌کند ولی این پوشه در سورس نیست و در package.json اسکریپت build هم تعریف نشده؛ برنامه هنگام شروع کرش می‌کند.`); break; }
    }
    const lock = lockMismatch(files, pkg);
    if (lock) blockers.push(lock);
    if (scriptUsesTsc(pkg) && !pkg.dependencies?.typescript && !pkg.devDependencies?.typescript) blockers.push("اسکریپت‌های package.json از tsc استفاده می‌کنند ولی typescript در وابستگی‌ها نیست؛ ساخت یا اجرا شکست می‌خورد.");
    const deps = Object.entries({ ...(pkg.dependencies ?? {}) } as Record<string, string>)
      .filter(([, v]) => typeof v === "string" && !/^(file:|git|http|workspace:|npm:|link:)/.test(v))
      .slice(0, 60);
    await inPool(deps, async ([name, ver]) => {
      const base = `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
      const pkgOk = await exists(base);
      if (pkgOk === false) { blockers.push(`پکیج «${name}» در npm وجود ندارد؛ ساخت هنگام نصب وابستگی‌ها شکست می‌خورد.`); return; }
      if (pkgOk && /^\d+\.\d+\.\d+$/.test(ver) && (await exists(`${base}/${ver}`)) === false) blockers.push(`نسخه‌ی ${ver} از پکیج «${name}» وجود ندارد.`);
    });
  }

  if (["python", "django", "flask"].includes(r.platform) && !files["requirements.txt"] && !files["Pipfile"] && !files["pyproject.toml"])
    blockers.push("فایل requirements.txt وجود ندارد؛ لیارا وابستگی‌های پایتون را از روی آن نصب می‌کند و بدون آن ساخت شکست می‌خورد.");

  if (r.platform === "docker" && !files["Dockerfile"]) {
    const nested = Object.keys(files).find((f) => /(^|\/)Dockerfile$/.test(f));
    blockers.push(nested ? `Dockerfile در ریشه‌ی پروژه نیست (${nested})؛ لیارا فقط Dockerfile ریشه را می‌خواند. محتوای آن پوشه را به‌تنهایی zip کنید.` : "پلتفرم Docker انتخاب شده اما Dockerfile وجود ندارد.");
  }
  if (r.platform === "docker" && Object.keys(files).some((f) => /(^|\/)docker-compose[\w.-]*\.ya?ml$/.test(f)))
    warnings.push("docker-compose پیدا شد؛ لیارا فقط یک کانتینر اجرا می‌کند. سرویس‌های دیگر (مثل Redis یا دیتابیس) را جداگانه بسازید و با متغیر محیطی وصل کنید.");

  if (r.platform === "react" && viteOutDirProblem(files)) blockers.push("Vite خروجی را در پوشه‌ی dist می‌سازد ولی پلتفرم React لیارا پوشه‌ی build را سرو می‌کند؛ ساخت بدون خروجی شکست می‌خورد (در vite.config باید build.outDir برابر \"build\" باشد).");

  const req = files["requirements.txt"] ? strFromU8(files["requirements.txt"]) : "";
  if (req) {
    const pins = req.split("\n").map((l) => l.trim().match(/^([A-Za-z0-9_.\-]+)\s*(?:==\s*([\w.]+))?/)).filter((m): m is RegExpMatchArray => !!m && !!m[1] && !/^(-|#)/.test(m[0])).slice(0, 60);
    await inPool(pins, async (m) => {
      const base = `https://pypi.org/pypi/${m[1]}`;
      const ok = await exists(`${base}/json`);
      if (ok === false) { blockers.push(`پکیج «${m[1]}» در PyPI وجود ندارد.`); return; }
      if (ok && m[2] && (await exists(`${base}/${m[2]}/json`)) === false) blockers.push(`نسخه‌ی ${m[2]} از پکیج «${m[1]}» وجود ندارد.`);
    });
  }

  for (const i of checkSyntax(files).slice(0, 3)) blockers.push(`خطای نحوی در «${i.file}»${i.line ? ` (خط ${i.line})` : ""}: ${i.message}. برنامه هنگام اجرا بلافاصله کرش می‌کند.`);

  // code listens on a fixed port while also not reading PORT: the deploy port must match
  const code = ["server.js", "index.js", "app.js", "main.js"].map((f) => files[f]).filter(Boolean).map((b) => strFromU8(b)).join("\n");
  if (code && /\.listen\(\s*\d{2,5}/.test(code) && !/process\.env\.PORT/.test(code)) {
    warnings.push(`برنامه روی پورت ثابت ${r.port} گوش می‌دهد و PORT را نمی‌خواند؛ هنگام دیپلوی همین پورت استفاده می‌شود.`);
  }
  return { blockers: [...new Set(blockers)], warnings };
}

/** `npm ci` (what Liara runs when a lock file exists) fails when package-lock.json does not list what package.json declares. */
export function lockMismatch(files: Files, pkg: any): string | null {
  const raw = files["package-lock.json"];
  if (!raw) return null;
  let lock: any;
  try { lock = JSON.parse(strFromU8(raw)); } catch { return "package-lock.json نامعتبر است؛ npm ci شکست می‌خورد."; }
  const declared = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  const locked = lock.lockfileVersion >= 2 ? { ...(lock.packages?.[""]?.dependencies ?? {}), ...(lock.packages?.[""]?.devDependencies ?? {}) } : (lock.dependencies ?? {});
  const missing = declared.filter((d) => !(d in locked) && !(lock.packages && lock.packages[`node_modules/${d}`]));
  return missing.length ? `package-lock.json با package.json هماهنگ نیست (${missing.slice(0, 4).join("، ")} در lock نیست)؛ دستور npm ci شکست می‌خورد.` : null;
}
export const scriptUsesTsc = (pkg: any) => Object.values(pkg.scripts ?? {}).some((v) => typeof v === "string" && /(^|[\s"'&;|])tsc(\s|$)/.test(v));

const VITE_CFG = /^vite\.config\.(js|mjs|cjs|ts)$/;
export const viteConfigFile = (files: Files) => Object.keys(files).find((f) => VITE_CFG.test(f));
/** Liara's React platform serves ./build, Vite writes ./dist unless told otherwise. */
export function viteOutDirProblem(files: Files): boolean {
  const f = viteConfigFile(files);
  if (!f) return false;
  return !/outDir\s*:\s*["'`](\.\/)?build["'`]/.test(strFromU8(files[f]));
}
