"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import AiCheck from "./AiCheck";

const PHASES = [
  { id: "queued", label: "صف" },
  { id: "building", label: "ساخت" },
  { id: "pushing", label: "ارسال" },
  { id: "deploying", label: "راه‌اندازی" },
  { id: "ready", label: "آماده" },
];

interface Res { state: string; analysis: { phase: string; done: boolean; ok: boolean; label: string; hint?: string }; lines: { stream: string; line: string }[] }

/** Live build/deploy tracker: polls the release until it reaches a terminal state. */
export default function BuildProgress({ releaseID, project, onDone }: { releaseID: string; project: string; onDone?: (ok: boolean) => void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const fired = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fired.current = false;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api<Res>(`/api/releases/${releaseID}`);
        if (stop) return;
        setRes(r); setErr(null);
        if (r.analysis.done) {
          if (!fired.current) { fired.current = true; onDone?.(r.analysis.ok); }
          return;
        }
      } catch (e: any) { if (!stop) setErr(e.error ?? "خطا در دریافت وضعیت ساخت"); }
      timer = setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [releaseID]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [res?.lines.length]);

  if (err && !res) return <div className="text-sm text-bad">{err}</div>;
  if (!res) return <div className="text-sm text-muted">در حال دریافت وضعیت ساخت…</div>;
  const a = res.analysis;
  const idx = a.phase === "failed" ? -1 : PHASES.findIndex((p) => p.id === a.phase);
  const open = showLog || (!a.done) || !a.ok;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {PHASES.map((p, i) => {
          const done = a.ok || (idx >= 0 && i < idx);
          const cur = !a.done && i === idx;
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              <span className={`pill ${done ? "pill-ok" : cur ? "pill-warn" : a.phase === "failed" && i === 1 ? "pill-bad" : "pill-muted"}`}>
                {done ? "✓ " : cur ? "● " : ""}{p.label}
              </span>
              {i < PHASES.length - 1 && <span className="text-muted">/</span>}
            </div>
          );
        })}
      </div>
      <div className={`text-sm rounded-xl px-3 py-2 ${a.done ? (a.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad") : "bg-brand-soft text-brand"}`}>
        {a.done ? (a.ok ? "✓ " : "✗ ") : "⏳ "}{a.label}
        {a.hint && <div className="mt-1 text-xs leading-6 text-ink">{a.hint}</div>}
        {a.done && a.ok && (
          <div className="mt-1 text-xs ltr"><a className="underline" target="_blank" rel="noreferrer" href={`https://${project}.liara.run`}>https://{project}.liara.run</a></div>
        )}
      </div>
      {a.done && !a.ok && <div className="rounded-xl border border-[#87fcc433] p-4"><div className="font-semibold mb-3"><span className="text-brand">✦</span> دستیار می‌تواند علت را بررسی کند</div><AiCheck name={project} compact /></div>}
      {a.done && a.ok && <button className="text-xs text-muted underline" onClick={() => setShowLog(!showLog)}>{showLog ? "پنهان کردن لاگ ساخت" : "نمایش لاگ ساخت"}</button>}
      {open && res.lines.length > 0 && (
        <div ref={box} className="bg-[#0d1220] text-[#cfd8ee] rounded-xl p-3 text-xs ltr font-mono max-h-56 overflow-auto space-y-0.5">
          {res.lines.slice(-80).map((l, i) => <div key={i} className={l.stream !== "STDOUT" ? "text-[#ff8d92]" : ""}>{l.line}</div>)}
        </div>
      )}
    </div>
  );
}
