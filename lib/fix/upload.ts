import { strFromU8, strToU8 } from "fflate";
import { analyze, type Files } from "../analyzer/codebase";
import { checkSyntax } from "../analyzer/syntax";
import { planDependencyFix } from "./dependencies";
import { planCodeFix } from "./code";
import { lockMismatch, scriptUsesTsc, viteConfigFile, viteOutDirProblem } from "../analyzer/preflight";

export interface UploadChange { from: string; to: string | null; reason: string }
export interface UploadFix { changes: UploadChange[]; blocked: string[]; files: Files }

/** Fix what blocks a deploy, before any app exists: bad dependencies, missing start script, syntax errors (AI patch). */
export async function planUploadFix(input: Files): Promise<UploadFix> {
  const out: UploadFix = { changes: [], blocked: [], files: { ...input } };
  const platform = analyze(input).platform;
  const staticLike = ["static", "react", "vue", "angular"].includes(platform); // built to files: no start script needed

  if (input["package.json"]) {
    // missing start script: deterministic
    try {
      const pkg = JSON.parse(strFromU8(input["package.json"]));
      if (!staticLike && !pkg.scripts?.start && !pkg.main) {
        const entry = ["server.js", "index.js", "app.js", "main.js"].find((f) => input[f])
          // otherwise the root script that actually starts a server (e.g. chatServer.js)
          ?? Object.keys(input).filter((f) => /^[^/]+\.(js|mjs|cjs)$/.test(f)).find((f) => /\.listen\(|createServer\(/.test(strFromU8(input[f])));
        if (entry) {
          pkg.scripts = { ...(pkg.scripts ?? {}), start: `node ${entry}` };
          out.files["package.json"] = strToU8(JSON.stringify(pkg, null, 2) + "\n");
          out.changes.push({ from: "package.json: بدون اسکریپت start", to: `"start": "node ${entry}"`, reason: "لیارا برای اجرای برنامه به اسکریپت start نیاز دارد." });
        } else out.blocked.push("اسکریپت start تعریف نشده و فایل ورودی مشخصی (server.js / index.js …) پیدا نشد.");
      }
    } catch { out.blocked.push("package.json نامعتبر است (JSON خراب)؛ باید دستی اصلاح شود."); return out; }

    // a lock file that disagrees with package.json breaks `npm ci`; without it Liara runs a normal `npm install`
    try {
      const pk = JSON.parse(strFromU8(out.files["package.json"]));
      const lockProblem = lockMismatch(out.files, pk);
      if (lockProblem) {
        // drop every stale lock (Liara picks yarn when a yarn.lock is present), so dependencies install plainly from package.json
        for (const f of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "yarn-error.log"]) delete out.files[f];
        out.changes.push({ from: "package-lock.json (ناهماهنگ با package.json)", to: null, reason: "با حذف فایل‌های lock قدیمی، لیارا وابستگی‌ها را با npm install از روی package.json نصب می‌کند." });
      }
      if (scriptUsesTsc(pk) && !pk.dependencies?.typescript && !pk.devDependencies?.typescript) {
        pk.devDependencies = { ...(pk.devDependencies ?? {}), typescript: "^4.9.5" };
        out.files["package.json"] = strToU8(JSON.stringify(pk, null, 2) + "\n");
        out.changes.push({ from: "package.json: بدون typescript", to: '"typescript": "^4.9.5"', reason: "اسکریپت‌ها tsc را اجرا می‌کنند و باید در وابستگی‌ها باشد." });
        // a fresh TypeScript against old @types packages reports errors inside node_modules; skipLibCheck is the standard remedy
        if (out.files["tsconfig.json"]) {
          try {
            const ts = JSON.parse(strFromU8(out.files["tsconfig.json"]));
            if (!ts.compilerOptions?.skipLibCheck) {
              ts.compilerOptions = { ...(ts.compilerOptions ?? {}), skipLibCheck: true };
              out.files["tsconfig.json"] = strToU8(JSON.stringify(ts, null, 2) + "\n");
              out.changes.push({ from: "tsconfig.json", to: '"skipLibCheck": true', reason: "جلوگیری از خطای نوع‌ها داخل node_modules هنگام build با TypeScript جدید." });
            }
          } catch { /* tsconfig with comments: leave it */ }
        }
      }
    } catch { /* invalid package.json handled above */ }
    const dep = await planDependencyFix(out.files);
    if (dep.changes.length) {
      out.files = dep.files;
      for (const c of dep.changes) out.changes.push({ from: c.from, to: c.to, reason: c.reason });
    }
    out.blocked.push(...dep.blocked);
  }

  // Vite front end on the React platform: Liara serves ./build
  if (input["package.json"] && platform === "react" && viteOutDirProblem(out.files)) {
    const f = viteConfigFile(out.files)!;
    let src = strFromU8(out.files[f]);
    const before = src;
    if (/outDir\s*:\s*["'`][^"'`]*["'`]/.test(src)) src = src.replace(/outDir\s*:\s*["'`][^"'`]*["'`]/, 'outDir: "build"');
    else if (/\bbuild\s*:\s*\{/.test(src)) src = src.replace(/\bbuild\s*:\s*\{/, 'build: {\n    outDir: "build",');
    else src = src.replace(/defineConfig\(\s*\{/, 'defineConfig({\n  build: { outDir: "build" },');
    if (src !== before) { out.files[f] = strToU8(src); out.changes.push({ from: `${f}: خروجی build در dist`, to: 'build: { outDir: "build" }', reason: "پلتفرم React لیارا پوشه‌ی build را سرو می‌کند و Vite به‌طور پیش‌فرض dist می‌سازد." }); }
    else out.blocked.push(`${f}: تنظیم build.outDir به‌طور خودکار ممکن نشد؛ آن را دستی "build" کنید.`);
  }

  const hasPy = Object.keys(input).some((f) => /\.py$/.test(f));
  if (hasPy && !input["package.json"] && !input["composer.json"] && !input["requirements.txt"] && !input["Pipfile"] && !input["pyproject.toml"]) {
    const { found, unknown } = await guessPythonRequirements(input);
    if (found.length) {
      out.files["requirements.txt"] = strToU8(found.join("\n") + "\n");
      out.changes.push({ from: "requirements.txt: وجود ندارد", to: found.join(", "), reason: "لیارا وابستگی‌ها را از requirements.txt نصب می‌کند؛ فهرست از روی importهای کد ساخته شد (نسخه‌ها پین نشده‌اند)." });
    }
    for (const u of unknown) out.blocked.push(`ماژول «${u}» در PyPI پیدا نشد؛ اگر پکیج خارجی است به requirements.txt اضافه کنید.`);
  }

  for (const issue of checkSyntax(out.files).slice(0, 3)) {
    const err = `SyntaxError: ${issue.message}\n    at ${issue.file}:${issue.line}`;
    const fix = await planCodeFix(`upload:${issue.file}:${out.files[issue.file].length}:${issue.message}`, out.files, err);
    if (!fix.edits.length) { out.blocked.push(`«${issue.file}»: ${fix.blocked.join(" ") || "اصلاح خودکار ممکن نشد."}`); continue; }
    out.files = fix.files;
    for (const e of fix.edits) out.changes.push({ from: `${e.file}\n${e.search}`, to: e.replace, reason: e.reason });
  }
  if (checkSyntax(out.files).length) out.blocked.push("پس از اصلاح هنوز خطای نحوی باقی مانده است؛ باید دستی بررسی شود.");
  return out;
}

const STDLIB = new Set("abc argparse array ast asyncio base64 binascii bisect builtins calendar cgi codecs collections colorsys concurrent configparser contextlib copy csv ctypes dataclasses datetime decimal difflib dis email enum errno fcntl fnmatch fractions ftplib functools gc getpass glob gzip hashlib heapq hmac html http imaplib importlib inspect io itertools json keyword linecache locale logging math mimetypes multiprocessing numbers operator os pathlib pickle pkgutil platform pprint queue random re secrets select shelve shlex shutil signal smtplib socket sqlite3 ssl stat statistics string struct subprocess sys tempfile textwrap threading time timeit token traceback types typing unicodedata unittest urllib uuid warnings weakref xml zipfile zlib __future__".split(" "));
const ALIAS: Record<string, string> = { PIL: "Pillow", yaml: "PyYAML", cv2: "opencv-python-headless", sklearn: "scikit-learn", bs4: "beautifulsoup4", dotenv: "python-dotenv", jwt: "PyJWT", MySQLdb: "mysqlclient", psycopg2: "psycopg2-binary", django: "Django", flask: "Flask", dateutil: "python-dateutil", serial: "pyserial", Crypto: "pycryptodome" };

/** Third-party packages a Python project imports (no requirements file to read), checked against PyPI. */
async function guessPythonRequirements(files: Files): Promise<{ found: string[]; unknown: string[] }> {
  const local = new Set(Object.keys(files).flatMap((f) => (f.endsWith(".py") ? [f.split("/").pop()!.replace(/\.py$/, ""), ...f.split("/").slice(0, -1)] : f.split("/").slice(0, -1))));
  const mods = new Set<string>();
  for (const [f, b] of Object.entries(files)) {
    if (!f.endsWith(".py") || b.length > 300_000) continue;
    for (const m of strFromU8(b).matchAll(/^\s*(?:from\s+([A-Za-z_][\w]*)[\w.]*\s+import|import\s+([A-Za-z_][\w]*))/gm)) mods.add(m[1] ?? m[2]);
  }
  const found: string[] = [], unknown: string[] = [];
  for (const m of [...mods].filter((x) => !STDLIB.has(x) && !local.has(x))) {
    const name = ALIAS[m] ?? m;
    const ok = await fetch(`https://pypi.org/pypi/${name}/json`, { method: "HEAD", signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => null);
    if (ok === false) unknown.push(m); else found.push(name);
  }
  return { found, unknown };
}
