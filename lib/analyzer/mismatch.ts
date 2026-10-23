import type { Files } from "./codebase";

export interface Mismatch { title: string; evidence: string[]; hint: string }

const names = (f: Files) => Object.keys(f).filter((p) => !/(^|\/)(node_modules|vendor|\.git|venv|\.venv|__pycache__)\//.test(p));
const has = (f: Files, re: RegExp) => names(f).filter((p) => re.test(p));

/**
 * Does the platform an app runs on fit the files it contains? Pure file/extension rules, no AI.
 * Catches the classic "it deploys fine and answers 200, but the backend never runs".
 */
export function platformMismatch(platform: string, files: Files): Mismatch | null {
  const php = has(files, /\.php$/i), py = has(files, /\.py$/i), js = has(files, /(^|\/)(server|app|index|main)\.(c|m)?js$/i);
  const pkg = files["package.json"], req = files["requirements.txt"] || files["pyproject.toml"], composer = files["composer.json"];
  const e = (l: string[]) => l.slice(0, 3).map((x) => `فایل ${x}`);
  const staticLike = ["static", "react", "vue", "angular"].includes(platform);

  if (platform !== "php" && platform !== "laravel" && php.length && !composer?.length && (staticLike || ["node", "next", "python", "django", "flask"].includes(platform)))
    return { title: `فایل PHP روی پلتفرم ${platform} اجرا نمی‌شود`, evidence: e(php), hint: "این پروژه کد PHP دارد؛ پلتفرم PHP لازم است. برنامه را با پلتفرم PHP دوباره بسازید (پلتفرم برنامه‌ی موجود قابل تغییر نیست)." };
  if ((platform === "php" || platform === "laravel") && !php.length)
    return { title: "پلتفرم PHP انتخاب شده اما هیچ فایل PHP وجود ندارد", evidence: [], hint: "نوع پروژه را بررسی کنید؛ احتمالاً پلتفرم دیگری (Node، static، …) لازم است." };
  if (["node", "next"].includes(platform) && !pkg && (req || py.length))
    return { title: "پروژه‌ی پایتون روی پلتفرم Node", evidence: [req ? "فایل requirements.txt" : "", ...e(py)].filter(Boolean), hint: "با پلتفرم Python، Django یا Flask دوباره بسازید." };
  if (["node", "next"].includes(platform) && !pkg && !js.length)
    return { title: "پلتفرم Node اما package.json وجود ندارد", evidence: [], hint: "فایل package.json با اسکریپت start لازم است، یا پلتفرم دیگری انتخاب کنید." };
  if (["python", "django", "flask"].includes(platform) && !req && !py.length)
    return { title: "پلتفرم Python اما کد پایتون پیدا نشد", evidence: [], hint: "نوع پروژه را بررسی کنید." };
  if (staticLike && pkg) {
    try {
      const j = JSON.parse(new TextDecoder().decode(pkg));
      const server = ["express", "fastify", "koa", "@nestjs/core", "next"].find((d) => j.dependencies?.[d]);
      if (server && j.scripts?.start && !/vite|serve|http-server|nginx/.test(j.scripts.start)) return { title: `پروژه‌ی Node (${server}) روی پلتفرم ${platform}`, evidence: [`وابستگی ${server}`, `start: ${j.scripts.start}`], hint: "سرور Node روی پلتفرم static اجرا نمی‌شود؛ با پلتفرم Node دوباره بسازید." };
    } catch { /* not JSON */ }
  }
  return null;
}
