"use client";
import { use, useState } from "react";
import { api, useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import Confirm from "@/components/Confirm";
import { ago, fa, jalali } from "@/components/time";

const STATE: Record<string, [string, string]> = { READY: ["موفق", "pill-ok"], FAILED: ["ناموفق", "pill-bad"], UNHEALTHY: ["ناسالم", "pill-bad"], TIMEDOUT: ["زمان‌بر", "pill-bad"], CANCELED: ["لغو شد", "pill-muted"], BUILDING: ["در حال ساخت", "pill-warn"], DEPLOYING: ["در حال استقرار", "pill-warn"] };

function Logs({ id }: { id: string }) {
  const { data } = useApi<{ lines: { at: string; line: string; stream: string }[] }>(`/api/releases/${id}`);
  if (!data) return <div className="text-muted p-4">…</div>;
  return (
    <div className="bg-[#0d1220] rounded-xl p-3 text-xs ltr font-mono max-h-80 overflow-auto space-y-0.5">
      {data.lines.map((l, i) => <div key={i} className={l.stream !== "STDOUT" ? "text-[#ff8d92]" : "text-[#cfd8ee]"}><span className="text-[#6c7690]">{l.at.slice(0, 19).replace("T", " ")} | </span>{l.line}</div>)}
    </div>
  );
}

export default function Releases({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const { data, error, reload } = useApi<{ releases: any[] }>(`/api/projects/${name}/releases`, 10000);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [rb, setRb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function rollback() {
    setBusy(true); setMsg(null);
    try { await api(`/api/projects/${name}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "rollback_release", args: { releaseID: rb.id } }) }); setMsg("عملیات بازگرداندن آغاز شد."); setTimeout(reload, 1500); }
    catch (e: any) { setMsg(e.error ?? "بازگرداندن ناموفق بود"); } finally { setBusy(false); setRb(null); }
  }
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  return (
    <div className="space-y-4 max-w-4xl">
      {msg && <div className="card p-3 text-sm">{msg}</div>}
      {data.releases.length === 0 && <div className="card p-8 text-center text-muted">هنوز استقراری انجام نشده.</div>}
      {data.releases.map((r, idx) => {
        const [label, cls] = STATE[r.state] ?? [r.state, "pill-muted"];
        const dur = r.finishedAt ? Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.createdAt)) / 1000)) : null;
        const isOpen = open[r.id] ?? idx === 0;
        return (
          <div key={r.id} className="rounded-xl bg-[#23252d] p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3"><span className="rounded border border-[#ffffff44] px-1.5 text-sm ltr">v{r.version}</span><span className="text-sm text-muted">{ago(Date.parse(r.createdAt) / 1000)}</span></div>
              <div className="flex gap-2">
                <button className="btn text-sm" disabled={r.current || r.state !== "READY"} onClick={() => setRb(r)}>↺ بازگرداندن</button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[#ffffff08] px-4 py-3 cursor-pointer" onClick={() => setOpen({ ...open, [r.id]: !isOpen })}>
              <span className="flex items-center gap-2 font-semibold">عملیات استقرار {r.current && <span className="pill pill-muted">استقرار فعلی</span>}<span className={`pill ${cls}`}>{label}</span></span>
              <span>{isOpen ? "⌃" : "⌄"}</span>
            </div>
            {isOpen && (
              <>
                <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  {[["پلتفرم", r.platform ?? "—"], ["پورت", r.port ? fa(r.port).replace(/[٬,]/g, "") : "—"], ["زمان شروع", jalali(r.createdAt, { dateStyle: "medium", timeStyle: "medium" })], ["زمان پایان", r.finishedAt ? jalali(r.finishedAt, { dateStyle: "medium", timeStyle: "medium" }) : "—"], ["مدت زمان", dur ? `${fa(dur)} ثانیه` : "—"], ["موقعیت Build", r.buildLocation === "iran" ? "ایران" : r.buildLocation ?? "—"], ["کلاینت", r.client ?? "—"]].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-[#ffffff0d] py-1.5"><span className="text-[#999]">{k}</span><span>{v}</span></div>
                  ))}
                </div>
                <div className="font-semibold">لاگ‌های استقرار</div>
                <Logs id={r.id} />
              </>
            )}
          </div>
        );
      })}
      {rb && <Confirm title={`بازگرداندن به v${rb.version}؟`} body="نسخه‌ی فعلی با این نسخه جایگزین می‌شود." busy={busy} onYes={rollback} onNo={() => setRb(null)} />}
    </div>
  );
}
