import { handle } from "@/lib/api";
import { analyze, readZip } from "@/lib/analyzer/codebase";
import { preflight } from "@/lib/analyzer/preflight";
import { zipFromForm } from "@/lib/uploads";
import { detectStack } from "@/lib/stack/detect";
import { aiClassify } from "@/lib/ai/classify";
import { providerToPlatform, railpackInfo } from "@/lib/analyzer/railpack";

const STATIC_LIKE = ["static", "react", "vue", "angular"]; // built to files and served by Liara on port 80

export const POST = (req: Request) =>
  handle(async () => {
    const files = readZip(await zipFromForm(await req.formData()));
    const base = analyze(files);
    const rp = await railpackInfo(files); // local detector (optional): provider, start command, runtime versions
    if (rp) base.railpack = rp;
    const r = await aiClassify(files, base);
    if (rp?.providers[0]) {
      const guess = providerToPlatform(rp.providers[0], files);
      const same = guess === r.platform || (guess === "netcore" && r.platform === "dotnet");
      if (!guess) r.warnings.push(`Railpack این پروژه را ${rp.providers[0]} تشخیص داد؛ لیارا برای آن پلتفرم آماده ندارد (Docker را بررسی کنید).`);
      else if (same && !STATIC_LIKE.includes(r.platform)) r.startCommand ??= rp.startCommand; // its start command only counts when it agrees with the final platform
    }
    if (STATIC_LIKE.includes(r.platform)) { r.port = 80; r.startCommand = undefined; }
    r.warnings = r.warnings.filter((w) => !(w.includes("تشخیص داده نشد") && r.platform)); // the AI/Railpack settled it
    const pf = await preflight(files, r);
    // a missing start script is now reported as a blocker; drop the older duplicate warning
    const warnings = [...r.warnings.filter((w) => !(pf.blockers.some((b) => b.includes("اسکریپت start")) && w.includes("start"))), ...pf.warnings];
    const { info } = detectStack(files);
    return { ...r, warnings, blockers: pf.blockers, stack: info.multi ? info : undefined };
  });
