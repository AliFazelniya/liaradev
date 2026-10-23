"use client";
import { useState } from "react";
import Link from "next/link";
import { api, useApi } from "./api";
import { ErrorBox } from "./ui";
import { AreaChart } from "./charts";

const ST: Record<string, [string, string]> = { pending: ["pill-warn", "منتظر تأیید"], approved: ["pill-ok", "اجرا شد"], rejected: ["pill-muted", "رد شد"], failed: ["pill-bad", "ناموفق"] };
const SEV: Record<string, [string, string]> = { ok: ["pill-ok", "سالم"], warning: ["pill-warn", "هشدار"], critical: ["pill-bad", "بحرانی"], settling: ["pill-muted", "در حال راه‌اندازی"] };
const sevOf = (r: any) => SEV[r.settling ? "settling" : r.severity];

/** One proposed/finished action with its diff, result and the approve/reject buttons. */
export function ApprovalCard({ a, busy, onDecide }: { a: any; busy: boolean; onDecide: (id: string, approve: boolean) => void }) {
  return (
        <div key={a.id} className="card p-5 space-y-2">
          <div className="flex justify-between gap-3"><div className="font-semibold">{a.title}</div><span className={`pill ${ST[a.status][0]}`}>{ST[a.status][1]}</span></div>
          {a.reason && <div className="text-sm text-muted">{a.reason}</div>}
          {a.details?.changes?.length > 0 && (
            <div className="rounded-lg bg-[#0d1220] p-3 text-xs ltr font-mono space-y-1">
              {a.details.changes.map((c: any, i: number) => (
                <div key={i}><span className="text-[#ff8d92]">- {c.from}</span><br /><span className="text-[#87fcc4]">+ {c.to ?? "(removed)"}</span><div className="text-[#8a8f9c] rtl text-right font-sans" dir="rtl">{c.reason}</div></div>
              ))}
            </div>
          )}
          {!a.details?.changes && a.impact && <div className="text-sm">{a.impact}</div>}
          <div className="text-xs text-muted">{a.source === "monitor" ? "پایش خودکار" : a.source === "wizard" ? "ویزارد" : a.source === "mcp" ? "هوش مصنوعی خارجی (MCP)" : "دستیار"} · {new Date(a.createdAt).toLocaleString("fa-IR")}</div>
          {a.result && <div className={`text-sm ltr ${a.status === "failed" ? "text-bad" : "text-ok"}`}>{a.result}</div>}
          {a.verification && <div className="text-sm">{a.verification}</div>}
          {a.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <button className="btn btn-primary" disabled={busy} onClick={() => onDecide(a.id, true)}>{busy ? "در حال اجرا…" : "تأیید و اجرا"}</button>
              <button className="btn" disabled={busy} onClick={() => onDecide(a.id, false)}>رد</button>
            </div>
          )}
        </div>
  );
}

/** Pending/finished approvals. With `project`, only that app's actions are shown. */
export function ApprovalsPanel({ project, withAudit, auditOnly }: { project?: string; withAudit?: boolean; auditOnly?: boolean }) {
  const { data, error, reload } = useApi<any>("/api/approvals", 5000);
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try { await api("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, approve }) }); } finally { setBusy(null); reload(); }
  }
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const list = (data?.approvals ?? []).filter((a: any) => !project || a.args?.name === project);
  return (
    <div className="space-y-3">
      {!auditOnly && data && list.length === 0 && <div className="card p-6 text-center text-muted">موردی نیست.</div>}
      {!auditOnly && list.map((a: any) => <ApprovalCard key={a.id} a={a} busy={busy === a.id} onDecide={decide} />)}
      {(withAudit || auditOnly) && (
        <>
          <h3 className="font-bold pt-3">لاگ حسابرسی</h3>
          <div className="card p-4 text-xs ltr space-y-1 max-h-72 overflow-auto">
            {(data?.audit ?? []).map((e: any, i: number) => (
              <div key={i} className={e.ok ? "" : "text-bad"}>{e.at.slice(11, 19)} [{e.actor}] {e.tool} {JSON.stringify(e.args)} → {e.message}</div>
            ))}
            {!data?.audit?.length && <div className="text-muted">—</div>}
          </div>
        </>
      )}
    </div>
  );
}

const fmtDur = (sec: number) => { const m = Math.max(1, Math.round(sec / 60)); return m >= 60 ? `${Math.floor(m / 60).toLocaleString("fa-IR")} ساعت${m % 60 ? ` و ${(m % 60).toLocaleString("fa-IR")} دقیقه` : ""}` : `${m.toLocaleString("fa-IR")} دقیقه`; };
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });

/** Uptime of one app: status, availability, response time, a status-page style bar and the outage list. */
function AppUptime({ name, samples, showName }: { name: string; samples: any[]; showName: boolean }) {
  const last = samples[samples.length - 1];
  const up = samples.filter((x) => x.up);
  const pct = samples.length ? (up.length / samples.length) * 100 : 100;
  const avg = up.length ? Math.round(up.reduce((n, x) => n + (x.ms ?? 0), 0) / up.length) : 0;
  const BARS = 60;
  const bars = Array.from({ length: BARS }, (_, i) => samples[samples.length - BARS + i] ?? null);
  const outages: { from: number; to: number; open: boolean }[] = [];
  let cur: { from: number; to: number; open: boolean } | null = null;
  for (const x of samples) {
    if (!x.up) { if (!cur) outages.push((cur = { from: x.t, to: x.t, open: false })); else cur.to = x.t; }
    else cur = null;
  }
  if (cur && !last.up) (cur as { open: boolean }).open = true;
  const span = samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${last.up ? "bg-ok" : "bg-bad"}`} style={{ boxShadow: `0 0 0 4px ${last.up ? "#57b36a22" : "#ff706f22"}` }} />
          {showName && <b className="ltr">{name}</b>}
          <span className={`font-semibold ${last.up ? "text-ok" : "text-bad"}`}>{last.mode === "process" ? (last.up ? "برنامه در حال اجراست" : "برنامه مرتب از کار می‌افتد") : last.up ? "سایت در دسترس است" : "سایت پاسخ نمی‌دهد"}</span>
        </div>
        <span className="text-xs text-muted">آخرین بررسی {clock(last.t)} · {last.mode === "process" ? "بدون پاسخ HTTP؛ سلامت از روی وضعیت کانتینر و لاگ‌ها" : `HTTP ${last.status ?? last.error ?? "—"}${last.ms ? ` · ${last.ms.toLocaleString("fa-IR")}ms` : ""}`}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          ["دسترس‌پذیری", `${pct.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`, pct >= 99.9 ? "text-ok" : pct >= 95 ? "text-warn" : "text-bad"],
          ["میانگین زمان پاسخ", avg ? `${avg.toLocaleString("fa-IR")}ms` : "—", ""],
          ["بازه‌ی پایش", span ? fmtDur(span) : "تازه شروع شده", ""],
        ].map(([k, v, c]) => (
          <div key={k} className="rounded-xl bg-[#ffffff08] py-3"><div className={`text-xl font-bold ${c}`}>{v}</div><div className="text-xs text-muted mt-1">{k}</div></div>
        ))}
      </div>
      <div>
        <div className="flex gap-[3px] ltr h-9" aria-label="تاریخچه‌ی پایش">
          {bars.map((x, i) => (
            <span key={i} title={x ? `${clock(x.t)} — ${x.up ? `HTTP ${x.status} · ${x.ms}ms` : `قطع (${x.status ?? x.error})`}` : "بدون داده"}
              className={`flex-1 rounded-[3px] ${!x ? "bg-[#ffffff12]" : x.up ? "bg-ok" : "bg-bad"}`} style={x && x.up ? { opacity: 0.55 + Math.min(0.45, 0.45 * (1 - Math.min(1, (x.ms ?? 0) / 2000))) } : undefined} />
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-muted mt-1 ltr"><span>{samples.length > BARS ? clock(samples[samples.length - BARS].t) : samples[0] ? clock(samples[0].t) : ""}</span><span>اکنون</span></div>
      </div>
      {samples.length > 2 && <AreaChart points={samples.filter((x) => x.up).map((x) => ({ t: x.t, v: x.ms ?? 0 }))} yMax={Math.max(300, ...samples.map((x) => x.ms ?? 0)) * 1.15} fmt={(v) => `${Math.round(v)}ms`} color="#28c1f5" height={120} />}
      {outages.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {outages.slice(-5).reverse().map((o, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg bg-bad-soft text-bad px-3 py-2"><span>✗</span>
              <span>{o.open ? `از ${clock(o.from)} تا الان قطع است` : `قطعی از ${clock(o.from)} تا ${clock(o.to)}`} <span className="opacity-70">({fmtDur(o.to - o.from + 300)})</span></span></li>
          ))}
        </ul>
      ) : <div className="text-sm text-ok">در بازه‌ی پایش هیچ قطعی ثبت نشده است.</div>}
    </div>
  );
}

function UptimePanel({ project, data, reload }: { project?: string; data: any; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  async function pingNow() { setBusy(true); try { await api("/api/uptime", { method: "POST" }); } catch { /* shown on reload */ } finally { setBusy(false); reload(); } }
  if (!data) return null;
  const names = Object.keys(data.history ?? {}).filter((n) => (!project || n === project) && data.history[n].length);
  const L = data.liara;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold">پایش زنده</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm">
            <a href="https://liara.online" target="_blank" rel="noreferrer" className="text-brand">وضعیت لیارا</a>:{" "}
            {L.error ? <span className="text-muted">در دسترس نیست</span>
              : L.affecting.length ? <span className="text-bad">{L.affecting.map((a: any) => a.reason).join("؛ ")}</span>
              : <span className="text-ok">پلتفرم پایدار است</span>}
          </span>
          <button className="btn" onClick={pingNow} disabled={busy}>{busy ? "…" : "بررسی همین حالا"}</button>
        </div>
      </div>
      {names.length === 0
        ? <div className="card p-5 text-center text-muted text-sm">هنوز نمونه‌ای ثبت نشده؛ هر ۵ دقیقه وضعیت برنامه‌های روشن بررسی می‌شود (پاسخ HTTP، یا لاگ و وضعیت کانتینر برای ربات‌ها و workerها). برای شروع «بررسی همین حالا» را بزنید.</div>
        : names.map((n) => <AppUptime key={n} name={n} samples={data.history[n]} showName={!project} />)}
    </section>
  );
}

/** Scheduled health reports. With `project`, only that app's reports and a per-app "run now". */
export function HealthPanel({ project }: { project?: string }) {
  const { data, error, reload } = useApi<any>("/api/reports", 10000);
  const up = useApi<any>("/api/uptime", 30000);
  const appr = useApi<any>("/api/approvals", 5000);
  const [deciding, setDeciding] = useState<string | null>(null);
  async function decide(id: string, approve: boolean) {
    setDeciding(id);
    try { await api("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, approve }) }); } finally { setDeciding(null); appr.reload(); reload(); }
  }
  const [running, setRunning] = useState(false);
  async function runNow() {
    setRunning(true);
    try { await api("/api/monitor/run" + (project ? `?project=${encodeURIComponent(project)}` : ""), { method: "POST" }); } catch { /* surfaced on reload */ } finally { setRunning(false); reload(); }
  }
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const list = (data?.reports ?? []).filter((r: any) => !project || r.project === project);
  return (
    <div className="space-y-3">
      <UptimePanel project={project} data={up.data} reload={up.reload} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">{data?.monitorEnabled ? `پایش زنده‌ی سایت هر ۵ دقیقه · بررسی کامل هر ${data.every} دقیقه` : "پایش خودکار خاموش است"}</span>
        <button className="btn btn-primary" onClick={runNow} disabled={running}>{running ? "در حال بررسی…" : "بررسی کامل با هوش مصنوعی"}</button>
      </div>
      {data && list.length === 0 && <div className="card p-6 text-center text-muted">هنوز گزارشی نیست.</div>}
      {list.map((r: any) => (
        <div key={r.id} className="card p-5 space-y-2">
          <div className="flex justify-between items-center">
            {project ? <span className="text-xs text-muted">{new Date(r.at).toLocaleString("fa-IR")}</span> : <Link href={`/apps/${r.project}`} className="font-bold ltr text-brand">{r.project}</Link>}
            <div className="flex items-center gap-2">{!project && <span className="text-xs text-muted">{new Date(r.at).toLocaleString("fa-IR")}</span>}<span className={`pill ${sevOf(r)[0]}`}>{sevOf(r)[1]}</span></div>
          </div>
          <div className="text-sm">{r.summary}</div>
          {r.decision ? (
            <div className="text-sm leading-7 border-r-2 border-brand pr-3 space-y-1">
              <div className="text-[#ddd]">{r.decision.summary}{r.decision.cause && r.decision.verdict !== "ok" ? <span className="text-muted"> — علت: {r.decision.cause}</span> : null}</div>
              {r.decision.evidence?.[0] && <div className="text-xs text-muted ltr break-words">{r.decision.evidence[0]}</div>}
              {r.decision.proposal?.kind === "manual" && <div className="text-warn">نیاز به بررسی دستی: {r.decision.proposal.why}</div>}
              {r.decision.proposal?.kind === "env" && <div className="text-warn">متغیر {r.decision.proposal.key} را در «بررسی عملکرد» وارد کنید.</div>}
              {r.decision.proposal?.kind === "code_fix" && <div className="text-warn">پچ کد آماده‌ی تأیید است ({r.decision.proposal.why}).</div>}
            </div>
          ) : r.narrative && <div className="text-sm leading-7 text-[#ddd] border-r-2 border-brand pr-3">{r.narrative}</div>}
          {r.seen > 1 && <div className="text-xs text-muted">{r.severity === "ok" ? "سالم" : "همچنان باقی است"} — {r.seen.toLocaleString("fa-IR")} بررسی پشت‌سر‌هم، آخرین: {new Date(r.lastSeenAt).toLocaleString("fa-IR")}</div>}
          {r.autoApplied.length > 0 && <div className="text-sm text-ok">✓ اقدام خودکار: {r.autoApplied.join("؛ ")}</div>}
          {r.approvalIds.map((id: string) => {
            const a = (appr.data?.approvals ?? []).find((x: any) => x.id === id);
            return a ? <div key={id} className="[&>.card]:bg-[#ffffff0a] [&>.card]:border [&>.card]:border-line"><ApprovalCard a={a} busy={deciding === id} onDecide={decide} /></div> : null;
          })}
        </div>
      ))}
    </div>
  );
}

const BY: Record<string, string> = { user: "شما", scheduler: "پایش خودکار", ai: "دستیار", mcp: "هوش مصنوعی خارجی" };
/** Timeline of what was done to an app. The AI checks read the same list, so they know what already happened. */
export function HistoryPanel({ project }: { project: string }) {
  const { data } = useApi<any>(`/api/projects/${project}/history`, 15000);
  const list = data?.history ?? [];
  return (
    <section className="space-y-3">
      <h3 className="font-bold">اقدام‌های انجام‌شده روی این برنامه</h3>
      {list.length === 0 ? <div className="card p-4 text-sm text-muted">هنوز اقدامی (ارتقای پلن، ری‌استارت، اصلاح کد…) انجام نشده است.</div> : (
        <ol className="card p-4 space-y-3">
          {list.map((h: any, i: number) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="mt-2 w-2 h-2 rounded-full bg-brand shrink-0" />
              <div className="space-y-0.5">
                <div><b>{h.summary}</b> <span className="text-muted">— {BY[h.by] ?? h.by} · {new Date(h.at).toLocaleString("fa-IR")}</span></div>
                {h.verification && <div className="text-xs text-muted">{h.verification}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
