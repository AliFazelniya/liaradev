import { strFromU8, strToU8 } from "fflate";
import type { Files } from "../analyzer/codebase";
import { callLLM } from "../ai/llm";
import { redactText } from "../redact";

export interface CodeEdit { file: string; search: string; replace: string; reason: string }
export interface CodeFix { confidence: number; explanation: string; edits: CodeEdit[]; files: Files; blocked: string[] }

const MIN_CONFIDENCE = 0.85;
const SRC = /\.(js|mjs|cjs|ts|tsx|jsx|py|php)$/;
const MANIFEST = /(^|\/)(requirements\.txt|package\.json|composer\.json|Pipfile)$/; // a version pin there is a valid code-side fix
const cache = new Map<string, { at: number; fix: CodeFix }>();

/** Source files that matter for this error: those named in the stack trace first, then entry files, capped in size. */
function pickFiles(files: Files, error: string): string[] {
  const names = Object.keys(files).filter((f) => SRC.test(f) && !f.includes("node_modules") && files[f].length < 60_000);
  const mentioned = names.filter((f) => error.includes(f.split("/").pop()!));
  const manifests = Object.keys(files).filter((f) => MANIFEST.test(f) && !f.includes("node_modules") && files[f].length < 20_000);
  const entry = names.filter((f) => /(^|\/)(server|index|app|main)\.(js|ts|py|mjs)$/.test(f));
  return [...new Set([...mentioned, ...manifests, ...entry, ...names])].slice(0, 7);
}

/**
 * Ask the AI for a minimal source patch for a runtime error. Returns edits only when the model is highly confident
 * AND every edit applies to the real file exactly once; otherwise `blocked` explains why nothing is offered.
 * Cached per release+error so the preview the user approves is the patch that is deployed.
 */
export async function planCodeFix(key: string, files: Files, error: string): Promise<CodeFix> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.fix;
  const out: CodeFix = { confidence: 0, explanation: "", edits: [], files: { ...files }, blocked: [] };
  const picked = pickFiles(files, error);
  if (!picked.length) { out.blocked.push("فایل کد قابل‌بررسی پیدا نشد."); return out; }
  const bundle = picked.map((f) => `=== ${f} ===\n${redactText(strFromU8(files[f]))}`).join("\n\n");
  let parsed: any;
  try {
    const { message } = await callLLM({
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You fix runtime bugs in small web apps. Given the error from production logs and the source files, return ONLY JSON: {\"confidence\":0..1,\"explanation\":\"one or two plain Persian sentences\",\"edits\":[{\"file\":\"path\",\"search\":\"exact existing text, unique in the file\",\"replace\":\"new text\",\"reason\":\"short Persian reason\"}]}. Rules: minimal edits; search must be copied verbatim from the file; do not touch secrets; do not invent environment variables or external services; an import/version incompatibility between installed packages (e.g. a library removed an API a pinned framework still imports) IS fixable by pinning a compatible version in the dependency file (requirements.txt / package.json / composer.json) - do that with a minimal edit; if the error is caused by missing configuration/credentials/infrastructure rather than a code bug, or you are not sure, return confidence below 0.5 and an empty edits array." },
        { role: "user", content: `Error:\n${redactText(error).slice(0, 1500)}\n\nFiles:\n${bundle.slice(0, 24000)}` },
      ],
    }, { source: "diagnose", note: "fix_code" });
    parsed = JSON.parse(String(message.content).replace(/^```(?:json)?|```$/g, "").trim());
  } catch (e: any) { out.blocked.push(e.message === "NO_KEY" ? "برای رفع خودکار کد، کلید هوش مصنوعی را در تنظیمات وارد کنید." : "پاسخ هوش مصنوعی قابل استفاده نبود."); return out; }

  out.confidence = Number(parsed.confidence) || 0;
  out.explanation = String(parsed.explanation ?? "");
  const edits: CodeEdit[] = Array.isArray(parsed.edits) ? parsed.edits : [];
  if (out.confidence < MIN_CONFIDENCE || !edits.length) { out.blocked.push("هوش مصنوعی به اندازه‌ی کافی مطمئن نیست که این خطا با تغییر کد حل شود؛ باید دستی بررسی شود."); cache.set(key, { at: Date.now(), fix: out }); return out; }
  const next: Files = { ...files };
  for (const e of edits) {
    const raw = next[e.file] && strFromU8(next[e.file]);
    if (!raw || !e.search || raw.split(e.search).length !== 2) { out.blocked.push(`تغییر پیشنهادی برای «${e.file}» دقیقاً با فایل واقعی نمی‌خواند؛ رد شد.`); out.edits = []; cache.set(key, { at: Date.now(), fix: out }); return out; }
    next[e.file] = strToU8(raw.replace(e.search, () => e.replace));
    out.edits.push({ file: e.file, search: e.search, replace: e.replace, reason: String(e.reason ?? "") });
  }
  out.files = next;
  cache.set(key, { at: Date.now(), fix: out });
  return out;
}
