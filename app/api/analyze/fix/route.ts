import { zipSync } from "fflate";
import { handle } from "@/lib/api";
import { readZip } from "@/lib/analyzer/codebase";
import { planUploadFix } from "@/lib/fix/upload";
import { zipFromForm } from "@/lib/uploads";

export const maxDuration = 90;

/** Preview (default) or apply (?apply=1 -> returns the patched zip) of the automatic fixes for an uploaded project. */
export async function POST(req: Request) {
  const apply = new URL(req.url).searchParams.get("apply") === "1";
  let zipOut: Uint8Array | null = null;
  const res = await handle(async () => {
    const fix = await planUploadFix(readZip(await zipFromForm(await req.formData())));
    if (apply) {
      if (!fix.changes.length) throw Object.assign(new Error(fix.blocked.join(" ") || "چیزی برای اصلاح خودکار پیدا نشد."), { status: 422 });
      zipOut = zipSync(fix.files);
    }
    return { changes: fix.changes, blocked: fix.blocked };
  });
  if (apply && zipOut) return new Response(zipOut as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "application/zip" } });
  return res;
}
