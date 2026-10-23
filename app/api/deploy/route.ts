import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { readZip, toTarGz } from "@/lib/analyzer/codebase";
import { audit } from "@/lib/store";
import { platformMismatch } from "@/lib/analyzer/mismatch";
import { watchRelease } from "@/lib/monitor/scheduler";
import { zipFromForm } from "@/lib/uploads";

export const maxDuration = 900;
export const POST = (req: Request) =>
  handle(async () => {
    const fd = await req.formData();
    const name = String(fd.get("name") ?? ""), platform = String(fd.get("platform") ?? "node"), port = Number(fd.get("port") ?? 3000);
    if (!/^[a-z0-9-]{3,}$/.test(name)) throw Object.assign(new Error("فایل یا نام پروژه نامعتبر است"), { status: 400 });
    const files = readZip(await zipFromForm(fd));
    // the chosen platform must be able to run these files (e.g. PHP files on "static" would deploy fine and never run)
    const mm = platformMismatch(platform === "dotnet" ? "netcore" : platform, files);
    if (mm) throw Object.assign(new Error(`${mm.title}. ${mm.hint}`), { status: 422 });
    const tar = toTarGz(files);
    let releaseID: string | undefined;
    const steps: { step: string; ok: boolean; detail?: string }[] = [{ step: "بسته‌بندی سورس (tar.gz)", ok: true, detail: `${Math.round(tar.length / 1024)}KB` }];
    try {
      const extra = fd.get("mirror") === "false" ? { mirror: false } : undefined; // skip Liara's npm mirror when it lacks a new package
      const r = await liara().deploySource(name, tar, { port, platform, extra });
      releaseID = r.releaseID;
      void watchRelease(name, r.releaseID); // first check as soon as the build is done, no waiting for the timer
      steps.push({ step: "آپلود سورس و ساخت release در لیارا", ok: true, detail: r.sourceID });
      audit({ actor: "user", tool: "deploy", args: { name, platform, port }, ok: true, message: r.sourceID });
    } catch (e: any) {
      steps.push({ step: "آپلود سورس و ساخت release در لیارا", ok: false, detail: e.message });
      audit({ actor: "user", tool: "deploy", args: { name }, ok: false, message: e.message });
    }
    return { steps, releaseID };
  });
