"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "./api";
import { ErrorBox } from "./ui";
import { Working, attachZip } from "./upload";

const ROLE: Record<string, string> = { frontend: "فرانت‌اند", backend: "بک‌اند" };
const TIER: Record<string, string> = { small: "کوچک (۰٫۵ گیگ)", medium: "متوسط (۱ گیگ)", large: "بزرگ (۲ گیگ)" };
const toman = (n: number) => `${Math.round(n).toLocaleString("fa-IR")} تومان`;

/** {{db:mongo.url}} → readable Persian, so the user can check what is wired to what. */
const PART: Record<string, string> = { url: "آدرس اتصال", host: "هاست", port: "پورت", user: "نام کاربری", password: "رمز", name: "نام دیتابیس", internal: "آدرس داخلی", public: "آدرس عمومی" };
const human = (v: string) => v.replace(/\{\{secret:(\w+)\}\}/g, "‹رمز تصادفی تولیدشده›").replace(/\{\{(db|app):([a-z0-9-]+)\.(\w+)\}\}/g, (_m, k, id, p) => `‹${k === "db" ? "دیتابیس" : "برنامه"} ${id} · ${PART[p] ?? p}›`);

/**
 * Multi-part project (frontend + backend + database…): the AI designs the stack, the user reviews and confirms,
 * then everything is created on one private network with the connections set as environment variables.
 */
export default function StackBuilder({ file, stack, defaultBase, single, setSingle }: { file: File | null; stack: any; defaultBase: string; single: boolean; setSingle: (v: boolean) => void }) {
  const [base, setBase] = useState(defaultBase.slice(0, 18));
  const [state, setState] = useState<{ phase: "idle" | "planning" | "review" | "running" | "done"; plan?: any; err?: any; job?: any }>({ phase: "idle" });
  const [skip, setSkip] = useState<number[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => { setBase((b) => b || defaultBase.slice(0, 18)); }, [defaultBase]);

  async function design() {
    if (!file) return;
    setState({ phase: "planning" });
    try {
      const fd = new FormData(); await attachZip(fd, file); fd.append("base", base);
      setState({ phase: "review", plan: await api("/api/stack/plan", { method: "POST", body: fd }) });
      setSkip([]);
    } catch (e) { setState({ phase: "idle", err: e }); }
  }
  async function launch() {
    const plan = state.plan; if (!plan) return;
    try {
      const { jobId } = await api<{ jobId: string }>("/api/stack/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.planId, skipEdits: skip }) });
      setState({ phase: "running", plan });
      timer.current = setInterval(async () => {
        try {
          const job = await api<any>(`/api/stack/${jobId}`);
          setState((s) => ({ ...s, job, phase: job.done ? "done" : "running" }));
          if (job.done && timer.current) clearInterval(timer.current);
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e) { setState({ phase: "review", plan, err: e }); }
  }

  const { plan, job } = state;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#28c1f544] bg-[#28c1f50f] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="font-bold">✦ ساختار چندبخشی تشخیص داده شد</div>
          <div className="flex rounded-lg border border-line overflow-hidden text-sm">
            <button className={`px-3 py-1.5 ${!single ? "bg-brand-soft text-brand font-semibold" : ""}`} onClick={() => setSingle(false)}>ساخت همه‌ی بخش‌ها</button>
            <button className={`px-3 py-1.5 border-r border-line ${single ? "bg-brand-soft text-brand font-semibold" : ""}`} onClick={() => setSingle(true)}>فقط یک برنامه</button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap text-sm">
          {stack.components.map((c: any) => <span key={c.id} className="pill pill-ok">{ROLE[c.role]} · <span className="ltr inline-block">{c.dir || c.id}</span> · {c.report.framework}</span>)}
          {stack.databases.map((d: any) => <span key={d.type} className="pill pill-warn">دیتابیس · {d.type}</span>)}
        </div>
      </div>

      {!single && state.err && <ErrorBox error={state.err} />}

      {!single && state.phase === "idle" && (
        <div className="card p-4 space-y-3">
          <p className="text-sm text-[#ccc]">هوش مصنوعی README، فایل‌های env و آدرس‌های داخل کد را می‌خواند و طرح ساخت همه‌ی بخش‌ها روی یک شبکه‌ی خصوصی را پیشنهاد می‌دهد. تا تأیید شما چیزی ساخته نمی‌شود.</p>
          <label className="block text-sm">نام پایه (برای نام برنامه‌ها و دیتابیس)
            <input className="input ltr mt-2 block w-full max-w-xs" value={base} onChange={(e) => setBase(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={18} />
          </label>
          <button className="btn btn-primary" disabled={!file || base.length < 3} onClick={design}>✦ طراحی با هوش مصنوعی</button>
        </div>
      )}
      {!single && state.phase === "planning" && <Working label="هوش مصنوعی در حال خواندن README و کد برای طراحی ساختار…" />}

      {!single && plan && (state.phase === "review" || state.phase === "running" || state.phase === "done") && (
        <div className="card p-5 space-y-5">
          <p className="text-[15px]">{plan.plan.summary}</p>

          <div className="space-y-2">
            <div className="font-semibold text-sm">بخش‌ها (همه روی یک شبکه‌ی خصوصی)</div>
            {plan.plan.components.map((c: any) => (
              <div key={c.id} className="rounded-lg border border-line p-3 flex items-start justify-between gap-3 flex-wrap">
                <div><div className="font-semibold ltr text-right">{c.name}</div><div className="text-xs text-muted">{ROLE[c.role]} · {c.platform} · پورت {c.port}</div><div className="text-xs text-[#ccc] mt-1">{c.why}</div></div>
                <span className="pill pill-muted">{TIER[c.tier]}</span>
              </div>
            ))}
            {plan.plan.databases.map((d: any) => (
              <div key={d.id} className="rounded-lg border border-[#e99a2744] p-3 flex items-start justify-between gap-3 flex-wrap">
                <div><div className="font-semibold">دیتابیس {d.type}</div><div className="text-xs text-[#ccc] mt-1">{d.why}</div></div>
                <span className="pill pill-muted">{TIER[d.tier]}</span>
              </div>
            ))}
          </div>

          {plan.plan.fixes?.length > 0 && (
            <div className="space-y-2">
              <div className="font-semibold text-sm">اصلاح‌های لازم قبل از استقرار</div>
              {plan.plan.fixes.map((f: any) => f.changes.map((c: any, i: number) => (
                <div key={f.component + i} className="rounded-lg border border-[#e99a2744] p-3 text-xs space-y-1"><div className="text-sm"><span className="ltr">{f.component}</span> — {c.reason}</div><div className="ltr font-mono text-bad break-all">- {c.from}</div>{c.to && <div className="ltr font-mono text-ok break-all">+ {c.to}</div>}</div>
              )))}
            </div>
          )}
          {plan.plan.blocked?.length > 0 && <div className="space-y-1">{plan.plan.blocked.map((b: any, i: number) => <div key={i} className="text-sm rounded-lg bg-bad-soft text-bad px-3 py-2">✗ <span className="ltr">{b.component}</span>: {b.text}</div>)}</div>}

          {plan.plan.env.length > 0 && (
            <div className="space-y-2">
              <div className="font-semibold text-sm">اتصال بخش‌ها (متغیرهای محیطی)</div>
              <div className="rounded-lg border border-line divide-y divide-[#333] text-sm">
                {plan.plan.env.map((e: any, i: number) => (
                  <div key={i} className="p-2.5 flex items-start justify-between gap-3 flex-wrap">
                    <div className="ltr text-right"><b>{e.key}</b> <span className="text-muted">← {human(e.value)}</span></div>
                    <span className="text-xs text-muted">{e.component} · {e.why}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.plan.edits.length > 0 && (
            <div className="space-y-2">
              <div className="font-semibold text-sm">تغییر در کد (آدرس ثابت ← متغیر محیطی)</div>
              {plan.plan.edits.map((e: any, i: number) => (
                <label key={i} className="block rounded-lg border border-line p-3 text-xs space-y-1 cursor-pointer">
                  <span className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={state.phase !== "review"} checked={!skip.includes(i)} onChange={(ev) => setSkip(ev.target.checked ? skip.filter((x) => x !== i) : [...skip, i])} /><span className="ltr">{e.component}/{e.file}</span><span className="text-muted">— {e.why}</span></span>
                  <div className="ltr font-mono text-bad break-all">- {e.search.trim().slice(0, 220)}</div>
                  <div className="ltr font-mono text-ok break-all">+ {e.replace.trim().slice(0, 220)}</div>
                </label>
              ))}
            </div>
          )}

          {plan.plan.notes.length > 0 && <ul className="text-xs text-muted list-disc pr-5 space-y-1">{plan.plan.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>}

          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-line pt-4">
            <div className="text-sm">هزینه‌ی تقریبی ماهانه: <b>{toman(plan.estimate.total)}</b> <span className="text-xs text-muted">(برنامه‌ها {toman(plan.estimate.apps)} + دیتابیس {toman(plan.estimate.databases)})</span></div>
            {state.phase === "review" && (plan.plan.blocked?.length > 0 ? <span className="text-sm text-bad">اول مشکل‌های بالا را در کد رفع کنید.</span> : plan.taken.length > 0
              ? <span className="text-sm text-bad">نام‌های «{plan.taken.join("، ")}» قبلاً استفاده شده؛ نام پایه را عوض کنید.</span>
              : <div className="flex gap-2"><button className="btn" onClick={() => setState({ phase: "idle" })}>بازگشت</button><button className="btn btn-primary" onClick={launch}>تأیید و ساخت همه</button></div>)}
          </div>
        </div>
      )}

      {!single && job && (
        <div className="card p-5 space-y-2">
          <div className="font-semibold">وضعیت ساخت</div>
          {job.steps.map((s: any) => (
            <div key={s.key} className={`text-sm rounded-lg px-3 py-2 flex items-center gap-2 ${s.status === "ok" ? "bg-ok-soft text-ok" : s.status === "failed" ? "bg-bad-soft text-bad" : "bg-[#ffffff0a] text-[#ccc]"}`}>
              {s.status === "running" ? <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[#87fcc4] border-t-transparent animate-spin" /> : s.status === "ok" ? "✓" : "✗"}
              <span>{s.label}</span>{s.detail && <span className="ltr text-xs opacity-80 mr-auto">{s.detail}</span>}
            </div>
          ))}
          {state.phase === "running" && <div className="text-xs text-muted">ساخت دیتابیس و برنامه‌ها چند دقیقه طول می‌کشد.</div>}
          {job.done && job.ok && (
            <div className="pt-2 space-y-2">
              <div className="text-ok text-sm">همه‌ی بخش‌ها ساخته و استقرار آن‌ها شروع شد. بررسی اولیه‌ی هوش مصنوعی پس از پایان ساخت خودکار انجام می‌شود.</div>
              <div className="flex gap-2 flex-wrap">{job.apps.map((a: any) => <Link key={a.id} href={`/apps/${a.name}`} className="btn">{a.name}</Link>)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
