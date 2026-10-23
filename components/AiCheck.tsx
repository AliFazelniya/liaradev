"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "./api";
import { jalali } from "./time";
import { effectiveSeverity } from "@/lib/severity";
import { ErrorBox } from "./ui";
import Confirm from "./Confirm";

const SEV: Record<string, [string, string]> = { ok: ["pill-ok", "سالم"], warning: ["pill-warn", "هشدار"], critical: ["pill-bad", "بحرانی"], settling: ["pill-muted", "در حال راه‌اندازی"] };
const sevKey = (x: any) => (x?.settling ? "settling" : x?.severity);
const sevOfRes = (d: any, dec: any) => { if (!d) return undefined; const e = effectiveSeverity(d, dec); return e.settling ? "settling" : e.severity; };
const TOOL_FA: Record<string, string> = { fix_dependencies: "اصلاح وابستگی‌ها", change_plan: "تغییر پلن", restart_project: "ری‌استارت", turn_project: "روشن/خاموش", update_port: "تغییر پورت", rollback_release: "بازگرداندن نسخه", set_flag: "تغییر تنظیم", advice: "راهنمایی", fix_code: "رفع با هوش مصنوعی", set_env: "افزودن متغیر محیطی" };

/**
 * "Find the problem" with the AI. Runs only when the user presses the button: collects logs, events, metrics,
 * the latest build and a live request to the site, ranks causes, explains them, and offers executable fixes
 * (each one still needs the user's confirmation).
 */
export default function AiCheck({ name, title = "بررسی عملکرد با هوش مصنوعی", compact = false, onDone, onSeverity }: { name: string; title?: string; compact?: boolean; onDone?: () => void; onSeverity?: (s: string | undefined) => void }) {
  const [st, setSt] = useState<{ state: "idle" | "running" | "done" | "error"; res?: any; err?: any }>({ state: "idle" });
  const [confirm, setConfirm] = useState<null | { tool: string; args: any; label: string; body: string }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function investigate() {
    setSt({ state: "running" }); setMsg(null);
    try { setSt({ state: "done", res: await api(`/api/projects/${name}/diagnose`, { method: "POST" }) }); }
    catch (e: any) { setSt({ state: "error", err: e }); }
  }
  async function run(c: NonNullable<typeof confirm>) {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/projects/${name}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: c.tool, args: c.args }) });
      setMsg({ ok: true, text: `${c.label} انجام شد؛ چند ثانیه بعد دوباره بررسی کنید.` }); onDone?.();
    } catch (e: any) { setMsg({ ok: false, text: `${c.label} ناموفق بود: ${e.error ?? "خطا"}${e.hint ? " — " + e.hint : ""}` }); }
    finally { setBusy(false); setConfirm(null); }
  }
  const d = st.res?.diagnosis;
  const dec = st.res?.decision;
  // with the AI decision, only its single proposal is offered; without it, the rule-based actions
  const acts: any[] = !d ? [] : !dec ? d.actions : dec.proposal?.kind === "action" ? [{ tool: dec.proposal.tool, args: dec.proposal.args, why: dec.proposal.why }]
    : dec.proposal?.kind === "code_fix" ? [{ tool: "fix_code", args: { name, error: dec.evidence.join("\n") || dec.cause }, why: dec.proposal.why }]
    : dec.proposal?.kind === "env" ? [{ tool: "set_env", args: { name, key: dec.proposal.key }, why: dec.proposal.why }] : [];
  const [envVal, setEnvVal] = useState("");
  // default view: the latest stored check (scheduler or manual), until the user runs a fresh one
  const { data: rep } = useApi<any>("/api/reports", 30000);
  const last = (rep?.reports ?? []).find((r: any) => r.project === name);
  const shown = sevOfRes(d, dec) ?? sevKey(last);
  useEffect(() => { onSeverity?.(shown); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  /** update-envs replaces the whole list, so merge the new key into the current variables. */
  async function saveEnv(key: string) {
    setBusy(true); setMsg(null);
    try {
      const cur = await api<{ envs: { key: string; value: string }[] }>(`/api/projects/${name}/envs`);
      const variables = [...cur.envs.filter((e) => e.key !== key), { key, value: envVal }];
      await api(`/api/projects/${name}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "update_envs", args: { variables } }) });
      await api(`/api/projects/${name}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "restart_project", args: {} }) });
      setEnvVal(""); setMsg({ ok: true, text: `${key} ثبت شد و برنامه دوباره راه‌اندازی شد؛ چند ثانیه بعد دوباره بررسی کنید.` }); onDone?.();
    } catch (e: any) { setMsg({ ok: false, text: `ثبت متغیر ناموفق بود: ${e.error ?? "خطا"}` }); }
    finally { setBusy(false); }
  }

  async function ask(a: any) {
    const label = TOOL_FA[a.tool] ?? a.tool;
    if (a.tool !== "fix_dependencies" && a.tool !== "fix_code") return setConfirm({ tool: a.tool, args: a.args, label, body: a.why });
    setMsg({ ok: true, text: "در حال بررسی کد…" });
    try {
      const pv = await api<{ changes: any[]; blocked: string[]; explanation?: string }>(`/api/projects/${name}/fix-preview${a.tool === "fix_code" ? `?kind=code&error=${encodeURIComponent(String(a.args.error ?? ""))}` : ""}`);
      setMsg(null);
      if (!pv.changes.length) return setMsg({ ok: false, text: pv.blocked.join(" ") || "چیزی برای اصلاح خودکار پیدا نشد." });
      setConfirm({ tool: a.tool, args: a.args, label, body: (pv.explanation ? pv.explanation + "\n\n" : "") + pv.changes.map((c) => `• ${c.from}  ←  ${c.to ?? "حذف"}\n  ${c.reason}`).join("\n") + (pv.blocked.length ? `\n\nنیاز به بررسی دستی: ${pv.blocked.join(" ")}` : "") });
    } catch (e: any) { setMsg({ ok: false, text: e.error ?? "پیش‌نمایش اصلاح ناموفق بود" }); }
  }

  return (
    <div className={compact ? "space-y-4" : "rounded-xl bg-[#23252d] p-6 space-y-4"}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {!compact && <h2 className="font-bold text-lg">{title}</h2>}
        <button className="btn btn-primary px-6 py-2.5" disabled={st.state === "running"} onClick={investigate}>
          {st.state === "running" ? "در حال بررسی…" : st.state === "done" ? "بررسی دوباره" : "✦ بررسی عملکرد"}
        </button>
      </div>
      {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{msg.text}</div>}
      {st.state === "error" && <ErrorBox error={st.err} />}
      {!d && st.state !== "running" && (last ? (
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className={`pill ${SEV[sevKey(last)][0]}`}>{SEV[sevKey(last)][1]}</span>
          <span className="text-[#ccc]">{last.decision?.summary || last.summary}</span>
          <span className="text-muted text-xs">آخرین بررسی: {jalali(last.lastSeenAt ?? last.at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      ) : rep && <div className="text-sm text-muted">هنوز بررسی‌ای انجام نشده است.</div>)}
      {d && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`pill ${SEV[sevOfRes(d, dec)!][0]}`}>{SEV[sevOfRes(d, dec)!][1]}</span>
            {d.probe && <span className="text-xs text-muted ltr">GET {d.probe.url.replace("https://", "")} → {d.probe.status ?? d.probe.error} · {d.probe.ms}ms</span>}
          </div>
          {dec ? (
            <div className="space-y-3">
              <div className="font-semibold leading-8">{dec.summary || d.summary}</div>
              {dec.cause && dec.verdict !== "ok" && <div className="text-sm text-[#ccc]"><span className="text-muted">علت: </span>{dec.cause}</div>}
              {dec.evidence?.length > 0 && <ul className="text-xs text-muted ltr space-y-1 border-l-2 border-line pl-3">{dec.evidence.map((e: string, i: number) => <li key={i} className="break-words">{e}</li>)}</ul>}
              {(dec.verdict === "unsure" || dec.unverified) && <div className="text-sm text-warn">هوش مصنوعی مطمئن نیست؛ پیشنهادی ثبت نشد.</div>}
              {dec.proposal?.kind === "manual" && <div className="rounded-xl border border-[#ffc44e55] bg-warn-soft p-3 text-sm leading-7"><b>نیاز به بررسی دستی: </b>{dec.proposal.why}</div>}
              {dec.proposal?.kind === "wait" && <div className="text-sm text-muted">فعلاً اقدامی لازم نیست: {dec.proposal.why}</div>}
            </div>
          ) : <p className="leading-8">{d.summary}</p>}
          {acts.length > 0 && (
            <div className="space-y-2">
              {acts.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-[#87fcc412] border border-[#87fcc42a] p-3">
                  <div className="text-sm leading-7">{!dec && <span className={`pill ml-2 ${a.kind === "fix" ? "pill-ok" : "pill-warn"}`}>{a.kind === "fix" ? "راه‌حل اصلی" : "راه‌حل موقت"}</span>}<b>{TOOL_FA[a.tool] ?? a.tool}</b> — {a.why}</div>
                  {a.tool === "set_env" && (
                    <div className="flex gap-2 shrink-0">
                      <input className="input ltr w-64" placeholder={`مقدار ${a.args.key}`} value={envVal} onChange={(e) => setEnvVal(e.target.value)} />
                      <button className="btn btn-primary" disabled={busy || !envVal.trim()} onClick={() => saveEnv(String(a.args.key))}>ثبت و راه‌اندازی</button>
                    </div>
                  )}
                  {a.tool !== "advice" && a.tool !== "set_env" && <button className="btn btn-primary shrink-0" onClick={() => ask(a)}>{a.tool === "fix_code" ? "✦ رفع با هوش مصنوعی" : "اجرا…"}</button>}
                </div>
              ))}
            </div>
          )}
          {d.causes.length > 0 && (
            <details className="rounded-xl border border-line bg-[#ffffff05]">
              <summary className="cursor-pointer p-3 text-sm text-muted">جزئیات تشخیص و شواهد</summary>
              <div className="px-3 pb-3 space-y-3">
                {d.causes.map((c: any, i: number) => (
                  <div key={i}>
                    <div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{c.title}</span><span className="text-muted shrink-0">{Math.round(c.confidence * 100)}٪</span></div>
                    <ul className="text-xs text-muted space-y-0.5 ltr list-disc pl-5">{c.evidence.map((e: string, j: number) => <li key={j}>{e}</li>)}</ul>
                  </div>
                ))}
              </div>
            </details>
          )}
          {d.limitations?.length > 0 && <div className="text-xs text-muted border-t border-line pt-3">{d.limitations.join(" ")}</div>}
        </div>
      )}
      {confirm && <Confirm title={`تأیید «${confirm.label}»؟`} body={confirm.body} busy={busy} onYes={() => run(confirm)} onNo={() => setConfirm(null)} />}
    </div>
  );
}
