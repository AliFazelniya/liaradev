import { gunzipSync, gzipSync, unzipSync, strFromU8 } from "fflate";

export interface CodebaseReport {
  platform: string; // Liara platform id
  framework: string;
  port: number;
  heavyDeps: boolean;
  needsDb: boolean;
  buildCommand?: string;
  startCommand?: string;
  envHints: string[];
  warnings: string[];
  blockers: string[];
  fileCount: number;
  /** how the platform was decided: file rules, or the AI when the rules were unsure/wrong */
  detectedBy?: "rules" | "ai";
  aiReason?: string;
  /** what the rules alone had guessed, when the AI overrode it */
  rulesGuess?: string;
  /** local Railpack analysis, when installed */
  railpack?: { providers: string[]; startCommand?: string; runtime: Record<string, string> };
}

const HEAVY = ["puppeteer", "playwright", "sharp", "tensorflow", "torch", "opencv", "canvas", "ffmpeg", "pandas", "numpy"];
const DB = ["mongoose", "mongodb", "pg", "mysql", "mysql2", "prisma", "sequelize", "typeorm", "redis", "psycopg2", "pymongo", "sqlalchemy", "django.db"];

export type Files = Record<string, Uint8Array>;

export function readZip(buf: Uint8Array): Files {
  const raw = unzipSync(buf, { filter: (f) => !/(^|\/)(node_modules|\.git|\.next|__pycache__|venv|\.venv)\//.test(f.name) });
  // strip a single top-level folder if present
  const names = Object.keys(raw);
  const top = names.length && names.every((n) => n.split("/")[0] === names[0].split("/")[0] && n.includes("/")) ? names[0].split("/")[0] + "/" : "";
  const out: Files = {};
  for (const [n, d] of Object.entries(raw)) if (!n.endsWith("/")) out[top ? n.slice(top.length) : n] = d;
  return out;
}

export function analyze(files: Files): CodebaseReport {
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : undefined);
  const r: CodebaseReport = { platform: "node", framework: "unknown", port: 3000, heavyDeps: false, needsDb: false, envHints: [], warnings: [], blockers: [], fileCount: Object.keys(files).length };

  const pkgRaw = text("package.json");
  const req = text("requirements.txt") ?? text("Pipfile") ?? text("pyproject.toml");
  const composer = text("composer.json");

  if (text("Dockerfile") && !pkgRaw && !req) {
    r.platform = "docker"; r.framework = "Dockerfile";
    const m = text("Dockerfile")!.match(/EXPOSE\s+(\d+)/); if (m) r.port = +m[1];
  } else if (pkgRaw) {
    let pkg: any = {};
    try { pkg = JSON.parse(pkgRaw); } catch { r.warnings.push("package.json نامعتبر است."); }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
    const has = (n: string) => n in deps;
    if (has("next")) { r.platform = "next"; r.framework = "Next.js"; r.port = 3000; }
    else if (has("nuxt")) { r.platform = "node"; r.framework = "Nuxt"; }
    else if (has("express")) { r.framework = "Express"; }
    else if (has("fastify")) { r.framework = "Fastify"; }
    else if (has("@nestjs/core")) { r.framework = "NestJS"; }
    else if (has("vite") && !pkg.scripts?.start) { r.platform = "static"; r.framework = "Vite (static)"; r.port = 80; }
    else r.framework = "Node.js";
    // a UI framework with a build step and no server framework is a static front end (Liara builds it and serves the files)
    const ui = has("react") || has("vue") || has("@angular/core");
    const server = ["express", "fastify", "koa", "@nestjs/core", "@hapi/hapi", "hapi", "next", "nuxt", "restify"].some(has);
    if (ui && !server && pkg.scripts?.build) {
      r.platform = has("@angular/core") ? "angular" : has("vue") ? "vue" : "react"; r.port = 80;
      r.framework = has("react-scripts") ? "Create React App" : has("vite") ? `${r.platform === "vue" ? "Vue" : r.platform === "angular" ? "Angular" : "React"} (Vite)` : r.platform === "vue" ? "Vue" : r.platform === "angular" ? "Angular" : "React";
    }
    r.buildCommand = pkg.scripts?.build; r.startCommand = pkg.scripts?.start;
    if (r.platform === "node" && !pkg.scripts?.start && !pkg.main) r.warnings.push("اسکریپت start در package.json پیدا نشد؛ لیارا برای اجرا به آن نیاز دارد.");
    r.heavyDeps = HEAVY.some(has);
    r.needsDb = DB.some(has);
    const m = text("server.js") ?? text("index.js") ?? text("app.js") ?? "";
    const pm = m.match(/listen\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{2,5})/); if (pm) r.port = +pm[1];
  } else if (req) {
    r.platform = "python";
    const l = req.toLowerCase();
    r.framework = l.includes("django") ? "Django" : l.includes("flask") ? "Flask" : l.includes("fastapi") ? "FastAPI" : "Python";
    if (l.includes("streamlit")) { r.framework = "Streamlit"; r.port = 8501; r.warnings.push("Streamlit با دستور «streamlit run» اجرا می‌شود و روی پورت ۸۵۰۱ گوش می‌دهد؛ لیارا پلتفرم آماده‌ای برای آن ندارد و باید با Docker (Dockerfile) اجرا شود."); }
    if (r.framework === "Django") r.platform = "django";
    if (r.framework === "Flask") r.platform = "flask";
    if (r.framework !== "Streamlit") r.port = r.framework === "FastAPI" ? 8000 : r.framework === "Flask" ? 5000 : 8000;
    r.heavyDeps = HEAVY.some((h) => l.includes(h));
    r.needsDb = DB.some((d) => l.includes(d));
  } else if (composer) {
    r.platform = composer.includes("laravel") ? "laravel" : "php"; r.framework = r.platform === "laravel" ? "Laravel" : "PHP"; r.port = 80; r.needsDb = true;
  } else if (text("go.mod")) {
    r.platform = "go"; r.framework = "Go"; r.port = 8080;
  } else if (Object.keys(files).some((f) => /\.csproj$/.test(f))) {
    r.platform = "dotnet"; r.framework = ".NET"; r.port = 80;
  } else if (Object.keys(files).some((f) => /\.php$/i.test(f))) {
    // PHP without composer.json (plain scripts next to an index.html is common): static hosting would never run them
    r.platform = "php"; r.framework = "PHP"; r.port = 80;
  } else if (files["index.html"]) {
    r.platform = "static"; r.framework = "Static HTML"; r.port = 80;
  } else r.warnings.push("نوع پروژه به‌طور خودکار تشخیص داده نشد؛ لطفاً پلتفرم را دستی انتخاب کنید.");

  for (const [p, d] of Object.entries(files)) {
    if (!/\.(js|ts|py|php|env\.example|json)$/.test(p) || d.length > 200_000) continue;
    const s = strFromU8(d);
    for (const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})|os\.environ(?:\.get)?\(?\[?["']([A-Z][A-Z0-9_]{2,})/g)) {
      const k = m[1] ?? m[2]; if (k !== "PORT" && k !== "NODE_ENV" && !r.envHints.includes(k)) r.envHints.push(k);
    }
  }
  r.envHints = r.envHints.slice(0, 15);
  if (files[".env"]) r.warnings.push("فایل .env داخل سورس است؛ مقادیر محرمانه را در بخش متغیرهای محیطی لیارا وارد کنید و این فایل را حذف کنید.");
  return r;
}

// Minimal ustar writer -> .tar.gz (the format Liara's /sources endpoint expects).
export function toTarGz(files: Files): Uint8Array {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const [name, data] of Object.entries(files)) {
    const h = new Uint8Array(512);
    const put = (s: string, off: number, len: number) => h.set(enc.encode(s).slice(0, len), off);
    put(name, 0, 100);
    put("0000644\0", 100, 8); put("0000000\0", 108, 8); put("0000000\0", 116, 8);
    put(data.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    put(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12);
    put("        ", 148, 8); put("0", 156, 1); put("ustar\0" + "00", 257, 8);
    let sum = 0; for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    blocks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const tar = new Uint8Array(total);
  let o = 0; for (const b of blocks) { tar.set(b, o); o += b.length; }
  return gzipSync(tar);
}

/** Read a .tar.gz (ustar) into a file map. Liara serves release sources in this format. */
export function readTarGz(buf: Uint8Array): Files {
  const tar = gunzipSync(buf);
  const out: Files = {};
  let off = 0;
  const str = (a: number, n: number) => strFromU8(tar.subarray(off + a, off + a + n)).replace(/\0[\s\S]*$/, "");
  while (off + 512 <= tar.length) {
    const name = str(0, 100);
    if (!name) break; // end-of-archive marker
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = str(156, 1);
    off += 512;
    if (type === "0" || type === "") out[name.replace(/^\.\//, "")] = tar.slice(off, off + size);
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}
