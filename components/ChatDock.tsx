"use client";
import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { api, useApi } from "./api";

interface Step { tool: string; title: string; outcome: string; approvalId?: string; impact?: string; error?: string }
interface Msg { role: "user" | "assistant"; content: string; steps?: Step[] }

function ApprovalCard({ step, onResolved }: { step: Step; onResolved: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "running" | "approved" | "rejected" | "failed">("idle");
  const [res, setRes] = useState<{ result?: string; verification?: string } | null>(null);
  async function decide(approve: boolean) {
    setState("running");
    try {
      const a = await api<any>("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: step.approvalId, approve }) });
      setState(a.status === "pending" ? "idle" : a.status);
      setRes({ result: a.result, verification: a.verification });
      onResolved(`[سیستم] اقدام «${step.title}» ${a.status === "approved" ? "توسط کاربر تأیید و اجرا شد" : a.status === "rejected" ? "توسط کاربر رد شد" : "ناموفق بود"}${a.result ? ": " + a.result : ""}${a.verification ? " | " + a.verification : ""}`);
    } catch (e: any) {
      setState("failed"); setRes({ result: e.error ?? "خطا" });
    }
  }
  const done = state === "approved" || state === "rejected" || state === "failed";
  return (
    <div className="mb-2 rounded-xl border border-warn/50 bg-warn-soft p-3 text-sm space-y-2">
      <div className="font-semibold">{done ? (state === "approved" ? "✅" : state === "rejected" ? "🚫" : "❌") : "⏳"} {step.title}</div>
      {step.impact && <div className="text-xs opacity-80">{step.impact}</div>}
      {!done && (
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={state === "running"} onClick={() => decide(true)}>{state === "running" ? "در حال اجرا…" : "تأیید و اجرا"}</button>
          <button className="btn" disabled={state === "running"} onClick={() => decide(false)}>رد</button>
        </div>
      )}
      {done && res?.result && <div className={`text-xs ltr ${state === "failed" ? "text-bad" : ""}`}>نتیجه: {res.result}</div>}
      {done && res?.verification && <div className="text-xs">{res.verification}</div>}
    </div>
  );
}


export default function ChatDock() {
  const path = usePathname();
  // the app whose page the user is on: the assistant answers about it without being told the name
  const app = path.match(/^\/apps\/([^/]+)\/[^/]+/)?.[1];
  const [open, setOpen] = useState(false);
  const projects = useApi<{ projects: { project_id: string }[] }>(open ? "/api/projects" : null);
  // suggestions are built from the account's real apps
  const first = projects.data?.projects[0]?.project_id;
  const SUGGEST = app
    ? [`مشکل ${app} چیست؟`, "منابع این برنامه چطور است؟", "آخرین دیپلوی چه شد؟"]
    : first
    ? ["وضعیت برنامه‌هایم چطور است؟", `سلامت ${first} را بررسی کن`, "می‌خواهم یک برنامه‌ی جدید بسازم"]
    : ["می‌خواهم یک برنامه‌ی جدید بسازم", "چه پلنی برای شروع مناسب است؟"];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const openIt = () => setOpen(true);
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("open-assistant", openIt);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("open-assistant", openIt); window.removeEventListener("keydown", key); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(t: string) {
    if (!t.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await api<{ reply: string; steps: Step[] }>("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app, messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      setMsgs([...next, { role: "assistant", content: r.reply, steps: r.steps }]);
    } catch (e: any) {
      setMsgs([...next, { role: "assistant", content: "⚠️ " + (e.error ?? "خطا در ارتباط با دستیار") }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(!open)} className="fixed bottom-5 left-5 z-40 btn btn-primary shadow-lg rounded-full px-5 py-3">
        {open ? "✕ بستن" : "✦ دستیار هوشمند"}
      </button>
      {open && (
        <div className="fixed bottom-20 left-5 z-40 w-[min(420px,calc(100vw-2.5rem))] h-[min(620px,75vh)] card shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-line font-semibold">دستیار لیارا‌پایلوت</div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            {!msgs.length && (
              <div className="space-y-2">
                <p className="text-muted">سلام! چه کمکی از دستم برمی‌آید؟</p>
                {SUGGEST.map((s) => <button key={s} className="btn w-full justify-start" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-left" : ""}>
                {m.steps?.map((s, j) => s.outcome === "pending_approval" && s.approvalId ? (
                  <ApprovalCard key={j} step={s} onResolved={(t) => setMsgs((cur) => [...cur, { role: "assistant", content: t }])} />
                ) : (
                  <div key={j} className={`mb-1.5 rounded-lg px-3 py-2 text-xs ${s.outcome === "pending_approval" ? "bg-warn-soft text-warn" : s.outcome === "error" ? "bg-bad-soft text-bad" : "bg-brand-soft text-brand"}`}>
                    {s.outcome === "pending_approval" ? "⏳ منتظر تأیید شما: " : s.outcome === "error" ? "✗ " : "✓ "}{s.title}
                    {s.impact && <div className="opacity-80">{s.impact}</div>}
                    {s.error && <div className="ltr">{s.error}</div>}
                  </div>
                ))}
                {m.content && (
                  <div className={`inline-block max-w-[92%] rounded-2xl px-3.5 py-2.5 whitespace-pre-wrap leading-7 ${m.role === "user" ? "bg-brand text-white" : "bg-[#ffffff0d] border border-line"}`}>{m.content}</div>
                )}
              </div>
            ))}
            {busy && <div className="text-muted text-xs">در حال بررسی…</div>}
            <div ref={end} />
          </div>
          <form className="p-3 border-t border-line flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="سؤالت را بنویس…" />
            <button className="btn btn-primary" disabled={busy}>ارسال</button>
          </form>
        </div>
      )}
    </>
  );
}
