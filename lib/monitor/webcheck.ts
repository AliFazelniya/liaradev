import { redactText } from "../redact";

/**
 * Does the actual website work? Not just "HTTP 200": fetch the page, then what it depends on (scripts, styles,
 * images, and the backend/data endpoints its own code calls) and look at what really comes back.
 */
export interface WebIssue { sev: "critical" | "warning"; kind: string; url: string; detail: string }
export interface WebCheck { url: string; title?: string; textSample: string; checked: number; issues: WebIssue[] }

const MAX_REQ = 14;
const ERROR_TEXT = /(Fatal error|Parse error|Warning: .{3,80} on line \d+|Traceback \(most recent|Cannot GET \/|Application error|Internal Server Error|Service Unavailable|Bad Gateway|Welcome to nginx|It works!|Index of \/|Unhandled Runtime Error|ReferenceError|TypeError:)/i;

const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#\d+;|&\w+;/g, " ").replace(/\s+/g, " ").trim();

async function get(url: string, ms = 8000): Promise<{ status: number; type: string; body: string; ms: number } | { error: string }> {
  const t = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(ms), headers: { "User-Agent": "LiaraPilot-healthcheck", Accept: "*/*" } });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, type: (res.headers.get("content-type") ?? "").toLowerCase(), body: new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 300_000)), ms: Date.now() - t };
  } catch (e: any) { return { error: e?.cause?.code ?? e?.name ?? "network error" }; }
}

const isHtml = (b: string) => /^\s*(<!doctype html|<html|<head|<body)/i.test(b);
const isPhpSource = (b: string) => /^\s*<\?php/i.test(b);
const looksData = (u: string) => /\.(php|json)(\?|$)|\/api\//i.test(u);

/** URLs a page's own code reads with GET (fetch/axios/$.get/XHR), plain string literals only. Mutating calls are never replayed. */
function endpoints(code: string): string[] {
  const safe = new Set<string>(), mutating = new Set<string>();
  for (const m of code.matchAll(/fetch\(\s*["'`]([^"'`$]+)["'`]([\s\S]{0,160})/g)) (/method\s*:\s*["'`](?:POST|PUT|DELETE|PATCH)/i.test(m[2].split(/\bfetch\(/)[0]) ? mutating : safe).add(m[1]);
  for (const m of code.matchAll(/axios\.get\(\s*["'`]([^"'`$]+)["'`]/g)) safe.add(m[1]);
  for (const m of code.matchAll(/\$\.(?:get|getJSON)\(\s*["'`]([^"'`$]+)["'`]/g)) safe.add(m[1]);
  for (const m of code.matchAll(/\.open\(\s*["']GET["']\s*,\s*["'`]([^"'`$]+)["'`]/g)) safe.add(m[1]);
  return [...safe];
}

export async function webCheck(origin: string): Promise<WebCheck> {
  const issues: WebIssue[] = [];
  const home = await get(origin + "/");
  const base = new URL(origin + "/");
  const res: WebCheck = { url: origin, textSample: "", checked: 1, issues };
  if ("error" in home) { issues.push({ sev: "critical", kind: "unreachable", url: origin, detail: home.error }); return res; }
  // a bare 404 on "/" with a tiny plain-text/JSON body is an API without a root route, not a broken site
  const bareApi404 = home.status === 404 && !isHtml(home.body) || (home.status === 404 && home.body.length < 400 && /Cannot GET|Not Found|"(error|message|detail)"/i.test(home.body));
  if (home.status >= 400 && !bareApi404) issues.push({ sev: home.status >= 500 ? "critical" : "warning", kind: "page-status", url: origin, detail: `HTTP ${home.status}` });
  if (isPhpSource(home.body)) issues.push({ sev: "critical", kind: "php-source", url: origin, detail: "صفحه‌ی اصلی به‌جای اجرا، کد PHP را نشان می‌دهد" });
  const html = home.body;
  res.title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 100);
  const text = strip(html);
  res.textSample = redactText(text).slice(0, 600);
  if (home.status < 400 && isHtml(html) && text.length < 20 && !/<(script|img|canvas|iframe)/i.test(html)) issues.push({ sev: "warning", kind: "empty-page", url: origin, detail: "صفحه تقریباً خالی است" });
  const et = text.match(ERROR_TEXT) ?? html.match(ERROR_TEXT);
  if (et && home.status < 400) issues.push({ sev: "critical", kind: "error-text", url: origin, detail: `متن خطا داخل صفحه: «${et[0].slice(0, 80)}»` });

  // what the page loads
  const refs = new Set<string>(), scripts: string[] = [];
  for (const m of html.matchAll(/<(script|img|link|source)\b[^>]*?(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)) {
    const u = m[2];
    if (/^(data:|mailto:|tel:|javascript:|blob:)/i.test(u)) continue;
    let abs: URL; try { abs = new URL(u, base); } catch { continue; }
    if (abs.origin !== base.origin) { if (abs.protocol === "http:" && base.protocol === "https:" && m[1] !== "link") issues.push({ sev: "warning", kind: "mixed-content", url: abs.href, detail: "منبع http در صفحه‌ی https (مرورگر مسدود می‌کند)" }); continue; }
    refs.add(abs.href);
    if (m[1].toLowerCase() === "script") scripts.push(abs.href);
  }
  // what the page's own code calls (inline scripts + up to 3 same-origin script files)
  let code = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  for (const s of scripts.slice(0, 3)) { const r = await get(s); res.checked++; if (!("error" in r) && r.status < 400) code += "\n" + r.body; }
  const calls = new Set<string>();
  for (const u of endpoints(code)) { try { const abs = new URL(u, base); if (abs.origin === base.origin) calls.add(abs.href); } catch { /* skip */ } }

  const targets = [...calls, ...[...refs].filter((r) => !calls.has(r) && !scripts.slice(0, 3).includes(r))].slice(0, MAX_REQ - res.checked);
  for (const u of targets) {
    const r = await get(u, 10_000); res.checked++;
    const isCall = calls.has(u), where = new URL(u).pathname;
    if ("error" in r) { issues.push({ sev: isCall ? "critical" : "warning", kind: isCall ? "endpoint-failed" : "asset-failed", url: u, detail: r.error }); continue; }
    if (r.status >= 500) issues.push({ sev: "critical", kind: isCall ? "endpoint-error" : "asset-error", url: u, detail: `HTTP ${r.status}` });
    else if (r.status >= 400 && r.status !== 405 && r.status !== 401 && r.status !== 403) issues.push({ sev: isCall ? "critical" : "warning", kind: isCall ? "endpoint-missing" : "asset-missing", url: u, detail: `HTTP ${r.status} برای ${where}` });
    else if (isPhpSource(r.body)) issues.push({ sev: "critical", kind: "php-source", url: u, detail: `${where} کد PHP را به‌جای اجرا برمی‌گرداند (سرور PHP اجرا نمی‌کند)` });
    else if (isCall && looksData(u) && isHtml(r.body)) issues.push({ sev: "critical", kind: "endpoint-html", url: u, detail: `${where} داده نمی‌دهد و صفحه‌ی HTML برمی‌گرداند` });
    else if (/\.js(\?|$)/i.test(u) && r.type.includes("text/html")) issues.push({ sev: "warning", kind: "asset-html", url: u, detail: `${where} فایل JS نیست و HTML برگردانده شده` });
  }
  return res;
}
