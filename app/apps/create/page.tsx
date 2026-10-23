"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/components/api";
import { ErrorBox, toman } from "@/components/ui";
import Confirm from "@/components/Confirm";
import BuildProgress from "@/components/BuildProgress";
import PlanMatrix from "@/components/PlanMatrix";
import { UploadProgress, Working, attachZip, useUploader } from "@/components/upload";
import StackBuilder from "@/components/StackBuilder";
import { PLATFORMS, BUNDLE_TABS, VAT } from "@/lib/platforms";

type Level = "manual" | "assistant";
type Key = "level" | "project" | "platform" | "name" | "network" | "plan" | "review";

const FLOW: Record<Level, Key[]> = {
  assistant: ["level", "project", "review"],
  manual: ["level", "platform", "name", "network", "plan", "review"],
};
const SUB: Record<Key, string> = {
  level: "تجربه‌ی شما در ساخت و استقرار برنامه چقدر است؟",
  project: "کد پروژه را انتخاب کنید؛ بقیه‌ی کارها با دستیار.",
  platform: "لطفا نوع برنامه‌ی خود را انتخاب کنید.",
  name: "شناسه‌ی برنامه را انتخاب کنید.",
  network: "شبکه‌ی خصوصی برنامه را مشخص کنید.",
  plan: "پلن و بسته‌ی امکانات برنامه را انتخاب کنید.",
  review: "انتخاب‌ها و هزینه‌ها را مرور کنید و برنامه را بسازید.",
};
const TRAFFIC = [
  { l: "تازه شروع کرده‌ام", s: "کمتر از ۵۰۰ بازدید در روز", v: 300 },
  { l: "چند هزار بازدید", s: "در روز", v: 3000 },
  { l: "ده‌ها هزار بازدید", s: "در روز", v: 25000 },
  { l: "بیش از ۵۰ هزار", s: "بازدید در روز", v: 80000 },
];
const NAME_RE = /^[a-z0-9][a-z0-9-]{2,30}$/;

const Svg = ({ d }: { d: string }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const LEVELS: { id: Level; title: string; line: string; tag: string; icon: string }[] = [
  { id: "assistant", title: "دستیار لیارا کمکم کنه", line: "کد را بررسی می‌کند و بهترین تنظیمات را پیشنهاد می‌دهد؛ تأیید نهایی با شماست", tag: "هوشمند", icon: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" },
  { id: "manual", title: "دستی", line: "خودم مراحل را طی می‌کنم و همه‌چیز را انتخاب می‌کنم", tag: "کنترل کامل", icon: "M4 17l6-6-6-6M12 19h8" },
];

function Preflight({ report, file, onFixed }: { report: any; file: File | null; onFixed: (f: File) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [plan, setPlan] = useState<null | { changes: any[]; blocked: string[] }>(null);
  if (!report) return null;

  async function preview() {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); await attachZip(fd, file);
      const r = await api<{ changes: any[]; blocked: string[] }>("/api/analyze/fix", { method: "POST", body: fd });
      if (!r.changes.length) setMsg(r.blocked.join(" ") || "اصلاح خودکار مطمئنی پیدا نشد؛ باید دستی بررسی شود.");
      else setPlan(r);
    } catch (e: any) { setMsg(e.error ?? "بررسی ناموفق بود"); } finally { setBusy(false); }
  }
  async function apply() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); await attachZip(fd, file);
      const res = await fetch("/api/analyze/fix?apply=1", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "اصلاح ناموفق بود");
      const fixed = new File([await res.blob()], file.name.replace(/\.zip$/i, "") + "-fixed.zip", { type: "application/zip" });
      setPlan(null); onFixed(fixed);
    } catch (e: any) { setMsg(e.message); setPlan(null); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      {report.blockers?.map((b: string, i: number) => <div key={i} className="text-sm rounded-lg bg-bad-soft text-bad px-3 py-2">✗ {b}</div>)}
      {report.blockers?.length > 0 && file && (
        <button className="btn btn-primary" disabled={busy} onClick={preview}>{busy ? "در حال بررسی…" : "✦ رفع با هوش مصنوعی"}</button>
      )}
      {msg && <div className="text-sm rounded-lg bg-warn-soft text-warn px-3 py-2">{msg}</div>}
      {report.warnings?.map((w: string, i: number) => <div key={i} className="text-sm text-warn">⚠ {w}</div>)}
      {plan && (
        <Confirm title="این تغییرات روی پروژه اعمال شود؟" yesLabel="اعمال و تحلیل دوباره" busy={busy} onYes={apply} onNo={() => setPlan(null)}
          body={plan.changes.map((c) => `• ${c.from}  ←  ${c.to ?? "حذف"}\n  ${c.reason}`).join("\n") + (plan.blocked.length ? `\n\nنیاز به بررسی دستی: ${plan.blocked.join(" ")}` : "")} />
      )}
    </div>
  );
}

function Stepper({ n, step }: { n: number; step: number }) {
  return (
    <div className="flex items-center w-full">
      {Array.from({ length: n }).map((_, i) => {
        const done = i < step, cur = i === step;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className={`w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0 border ${
              cur ? "text-[#0b1f17] border-transparent shadow-[0_0_0_5px_#87fcc425]" : done ? "border-[#87fcc488] text-brand bg-[#87fcc41a]" : "border-line text-muted bg-[#ffffff08]"}`}
              style={cur ? { background: "var(--grad)" } : undefined}>
              {done ? "✓" : (i + 1).toLocaleString("fa-IR")}
            </div>
            {i < n - 1 && <div className={`h-px flex-1 mx-2 ${done ? "bg-[#87fcc488]" : "bg-line"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default function NewApp() {
  const router = useRouter();
  const [level, setLevel] = useState<Level | null>(null);
  const [step, setStep] = useState(0);
  const [single, setSingle] = useState(false); // multi-part project: user chose to deploy it as one app
  const [custom, setCustom] = useState(false); // assistant path where the user opened individual settings for manual editing
  const [platform, setPlatform] = useState("node");
  const [name, setName] = useState("");
  const [nameState, setNameState] = useState<"idle" | "loading" | "ok" | "taken" | "error">("idle");
  const [network, setNetwork] = useState<string | null>(null);
  const [newNet, setNewNet] = useState("");
  const [bundle, setBundle] = useState("basic");
  const [planID, setPlanID] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const up = useUploader();
  const [report, setReport] = useState<any>(null);
  const [traffic, setTraffic] = useState(TRAFFIC[0].v);
  const [needsDb, setNeedsDb] = useState(false);
  const [budget, setBudget] = useState("");
  const [ai, setAi] = useState<any>(null); // assistant result
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [timeline, setTimeline] = useState<{ step: string; ok: boolean; detail?: string }[]>([]);
  const [releaseID, setReleaseID] = useState<string | null>(null);
  const [buildOk, setBuildOk] = useState<boolean | null>(null);
  const [created, setCreated] = useState(false);

  const plans = useApi<{ plans: any[] }>("/api/plans");
  const nets = useApi<{ networks: { _id: string; name: string }[] }>("/api/networks");
  const billing = useApi<{ team: number | null; user: number }>("/api/billing");
  const settings = useApi<{ level: Level | null }>("/api/settings");

  const keys = level === "assistant" && custom ? (["level", "project", "platform", "name", "network", "plan", "review"] as Key[]) : FLOW[level ?? "manual"];
  const editAt = (k: Key) => { setCustom(true); setStep(["level", "project", "platform", "name", "network", "plan", "review"].indexOf(k)); };
  const key = keys[step];
  const plan = plans.data?.plans.find((p) => p.id === planID);
  const bundleRow = plan?.bundles.find((b: any) => b.id === bundle) ?? plan?.bundles[0];
  const monthly = bundleRow?.monthly ?? 0;
  const vat = Math.round(monthly * VAT);
  const credit = billing.data ? (billing.data.team ?? billing.data.user) : null;
  const nameOk = NAME_RE.test(name) && nameState === "ok";
  const plat = PLATFORMS.find((p) => p.id === platform)!;

  useEffect(() => { if (settings.data?.level && !level) setLevel(settings.data.level); }, [settings.data, level]);
  useEffect(() => { if (nets.data && !network) setNetwork(nets.data.networks[0]?._id ?? "auto"); }, [nets.data, network]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy && !created) router.push("/apps"); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [router, busy, created]);

  // live availability check (names are unique across all of Liara)
  useEffect(() => {
    if (!NAME_RE.test(name)) { setNameState("idle"); return; }
    setNameState("loading");
    const t = setTimeout(async () => {
      try { setNameState((await api<{ available: boolean }>(`/api/check-name?name=${encodeURIComponent(name)}`)).available ? "ok" : "taken"); }
      catch { setNameState("error"); }
    }, 450);
    return () => clearTimeout(t);
  }, [name]);

  function pickLevel(l: Level) {
    setLevel(l);
    api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: l }) }).catch(() => {});
  }

  async function analyze(f: File) {
    setFile(f); setErr(null); setBusy(true); setReport(null);
    try {
      const id = await up.start(f);
      const fd = new FormData(); fd.append("uploadId", id);
      const r = await api("/api/analyze", { method: "POST", body: fd });
      setReport(r);
      setNeedsDb(!!r.needsDb);
      if (level === "assistant") {
        const mapped = r.platform === "dotnet" ? "netcore" : r.platform;
        if (PLATFORMS.some((p) => p.id === mapped)) setPlatform(mapped);
        if (!name) setName(f.name.replace(/\.zip$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30));
      }
    } catch (e: any) { if (e?.message !== "cancelled") setErr(e); } finally { setBusy(false); }
  }

  // Assistant path: one call decides everything; the user only approves the summary + cost.
  async function planForBeginner() {
    if (!report || !file) return;
    setErr(null); setBusy(true);
    try {
      const r = await api("/api/assistant/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report, dailyUsers: traffic, maxBudgetToman: budget ? +budget : undefined, fileName: file.name.replace(/-fixed(?=\.zip$)/i, "") }) });
      setAi(r); setPlatform(r.platform); setName(r.name); setNetwork(r.network.id); setPlanID(r.plan.id); setBundle(r.plan.bundleID);
      setStep(2);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  async function addNetwork() {
    setErr(null);
    try {
      const c = await api<{ _id: string }>("/api/networks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newNet }) });
      setNewNet(""); await nets.reload(); setNetwork(c._id);
    } catch (e) { setErr(e); }
  }

  function canNext() {
    if (key === "level") return !!level;
    if (key === "project") return !!report && !busy && !report.blockers?.length;
    if (key === "platform") return !report?.blockers?.length;
    if (key === "name") return nameOk;
    if (key === "network") return !!network;
    if (key === "plan") return !!planID;
    return true;
  }

  async function launch() {
    setErr(null); setBusy(true); setCreated(true); setTimeline([]); setReleaseID(null); setBuildOk(null);
    const tl: typeof timeline = [];
    const push = (s: (typeof tl)[number]) => { tl.push(s); setTimeline([...tl]); };
    try {
      await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, planID, platform, bundlePlanID: bundle, network: network === "auto" ? undefined : network }) });
      push({ step: "ساخت برنامه در لیارا", ok: true, detail: `${name} · ${plan?.name} (${planID}) · بسته ${bundle}` });
    } catch (e: any) { push({ step: "ساخت برنامه در لیارا", ok: false, detail: `${e.error}${e.hint ? " — " + e.hint : ""}` }); setBusy(false); return; }
    if (file) {
      try {
        const fd = new FormData(); await attachZip(fd, file); fd.append("name", name); fd.append("platform", platform); fd.append("port", String(report?.port ?? plat.port));
        const r = await api<{ steps: { step: string; ok: boolean; detail?: string }[]; releaseID?: string }>("/api/deploy", { method: "POST", body: fd });
        r.steps.forEach(push);
        if (r.releaseID) setReleaseID(r.releaseID);
      } catch (e: any) { push({ step: "دیپلوی", ok: false, detail: e.error }); }
    } else push({ step: "دیپلوی", ok: true, detail: "بدون کد" });
    setBusy(false);
  }

  const allOk = timeline.length > 0 && timeline.every((s) => s.ok);
  const finished = created && !busy && allOk && (!releaseID || buildOk !== null);
  const isLast = key === "review";
  const editingFromSummary = custom && !!ai && !isLast && key !== "level" && key !== "project"; // edits made from the AI summary go straight back to it
  const nextLabel = editingFromSummary ? "ثبت و بازگشت به خلاصه" : isLast ? (file ? "ایجاد و دیپلوی برنامه" : "ایجاد برنامه") : key === "project" ? "بررسی و پیشنهاد" : "بعدی";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto text-ink" style={{ background: "radial-gradient(ellipse at 50% -10%, #2a2c36 0%, #181818 60%)" }}>
      <div className="mx-auto max-w-[1100px] min-h-full flex flex-col px-5 pt-6 pb-4">
        <Link href="/apps" className="self-start text-sm text-[#ccc] hover:text-white flex items-center gap-2 mb-8">→ بازگشت <span className="ltr text-muted">(ESC)</span></Link>
        <h1 className="text-3xl font-bold">ساخت برنامه‌ی جدید</h1>
        <p className="text-[#ccc] mt-2 mb-7">{SUB[key]}</p>
        <Stepper n={keys.length} step={created ? keys.length : step} />

        <div className="flex-1 mt-7 mb-5 space-y-4">
          {err && <ErrorBox error={err} />}

          {/* level */}
          {key === "level" && !created && (
            <div className="grid md:grid-cols-2 gap-5 pt-2 max-w-4xl mx-auto">
              {LEVELS.map((l) => {
                const on = level === l.id;
                return (
                  <button key={l.id} onClick={() => pickLevel(l.id)}
                    className={`text-right rounded-2xl border p-6 transition flex flex-col gap-4 min-h-[210px] ${on ? "border-[#87fcc4aa] bg-gradient-to-b from-[#87fcc41f] to-[#28c1f512] shadow-[0_0_30px_#87fcc41a]" : "border-line bg-[#2a2c36] hover:border-[#ffffff33]"}`}>
                    <div className="flex items-center justify-between">
                      <span className={`w-14 h-14 rounded-xl grid place-items-center ${on ? "text-[#0b1f17]" : "text-brand bg-[#87fcc41a]"}`} style={on ? { background: "var(--grad)" } : undefined}><Svg d={l.icon} /></span>
                      <span className={`pill ${on ? "pill-ok" : "pill-muted"}`}>{l.tag}</span>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{l.title}</div>
                      <div className="text-[#ccc] mt-1">{l.line}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* assistant: project */}
          {key === "project" && !created && (
            <div className="max-w-2xl mx-auto space-y-6">
              <label className={`block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition ${report ? "border-[#87fcc488] bg-[#87fcc412]" : "border-line hover:border-[#87fcc466]"}`}>
                <input type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
                {!file && <div className="text-lg">فایل zip پروژه را انتخاب کنید</div>}
                {file && busy && !report && <div className="text-[#ccc]">در حال تحلیل…</div>}
                {report && (
                  <div className="space-y-2">
                    <div className="text-lg font-bold ltr">{file?.name}</div>
                    <div className="flex gap-2 justify-center flex-wrap">
                      <span className="pill pill-ok">{report.framework}</span>
                      <span className="pill pill-muted ltr">port {report.port}</span>
                      {report.needsDb && <span className="pill pill-warn">دیتابیس</span>}
                      {report.heavyDeps && <span className="pill pill-warn">کتابخانه‌ی سنگین</span>}
                    </div>
                  </div>
                )}
              </label>
              <UploadProgress up={up} />
              {report?.stack && <StackBuilder file={file} stack={report.stack} single={single} setSingle={setSingle} defaultBase={(file?.name ?? "app").replace(/\.zip$/i, "").replace(/-fixed$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")} />}
              {(single || !report?.stack) && (<>
              <Preflight report={report} file={file} onFixed={analyze} />
              <div>
                <div className="mb-3 font-semibold">چند نفر در روز از برنامه استفاده می‌کنند؟</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {TRAFFIC.map((t) => (
                    <button key={t.v} onClick={() => setTraffic(t.v)} className={`rounded-xl border p-3 text-right transition ${traffic === t.v ? "border-[#87fcc4aa] bg-[#87fcc41a]" : "border-line bg-[#2a2c36]"}`}>
                      <div className="font-semibold">{t.l}</div><div className="text-xs text-muted">{t.s}</div>
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-sm">سقف بودجه‌ی ماهانه (تومان) — اختیاری
                <input className="input ltr mt-2 block w-full max-w-xs" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} />
              </label>
              </>)}
            </div>
          )}

          {/* platform (+ optional zip) */}
          {key === "platform" && !created && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {PLATFORMS.map((p) => (
                  <button key={p.id} onClick={() => setPlatform(p.id)}
                    className={`h-36 rounded-xl border flex flex-col items-center justify-between py-4 transition ${platform === p.id ? "border-[#87fcc4aa] text-brand bg-gradient-to-b from-[#87fcc41f] to-[#28c1f512] shadow-[0_0_24px_#87fcc41a]" : "border-line bg-[#2a2c36] hover:border-[#ffffff33]"}`}>
                    <img src={`/assets/platforms/${p.logo}`} alt="" className="flex-1 min-h-0 object-contain py-1" />
                    <span className="text-sm font-semibold tracking-wide">{p.name}</span>
                  </button>
                ))}
              </div>
              <label className="card p-4 flex items-center justify-between gap-4 cursor-pointer hover:border-[#87fcc466]">
                <span className="font-semibold">{file ? <span className="ltr">{file.name}</span> : "کد پروژه (zip) — اختیاری"}</span>
                <span className="btn">{file ? "تغییر فایل" : "انتخاب فایل"}</span>
                <input type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
              </label>
              <UploadProgress up={up} />
              <Preflight report={report} file={file} onFixed={analyze} />
            </>
          )}

          {/* name */}
          {key === "name" && !created && (
            <div className="space-y-3 max-w-3xl">
              <div className="flex ltr rounded-lg overflow-hidden border border-line bg-[#15161c]">
                <span className="px-4 py-3 bg-[#2a2c36] text-[#ccc]">https://</span>
                <input autoFocus className="flex-1 bg-transparent px-3 text-white outline-none ltr" value={name} placeholder="my-site" onChange={(e) => setName(e.target.value.toLowerCase())} />
                <span className="px-4 py-3 bg-[#2a2c36] text-[#ccc]">.liara.run</span>
              </div>
              {name && !NAME_RE.test(name) && <div className="text-sm text-bad">فقط حروف کوچک انگلیسی، عدد و خط تیره (حداقل ۳ حرف).</div>}
              {nameState === "loading" && <div className="text-sm text-muted">در حال بررسی...</div>}
              {nameState === "ok" && <div className="text-sm text-ok">✓ این شناسه قابل انتخاب است.</div>}
              {nameState === "taken" && <div className="text-sm text-bad">✗ این شناسه قبلا گرفته شده‌است. لطفا شناسه‌ی دیگری را انتخاب کنید.</div>}
              {nameState === "error" && <div className="text-sm text-warn">بررسی نام انجام نشد؛ دوباره تلاش کنید.</div>}
            </div>
          )}

          {/* network */}
          {key === "network" && !created && (
            <div className="max-w-xl space-y-4 pt-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-xl font-bold">شبکه‌ی خصوصی</h2>
                <div className="flex gap-2">
                  <input className="input ltr w-40" placeholder="my-network" value={newNet} onChange={(e) => setNewNet(e.target.value)} />
                  <button className="btn" disabled={newNet.length < 3} onClick={addNetwork}>＋ شبکه‌ی جدید</button>
                </div>
              </div>
              {nets.loading && <div className="text-muted">…</div>}
              {nets.data?.networks.length === 0 && (
                <label className={`flex items-center justify-between rounded-xl border p-4 cursor-pointer ${network === "auto" ? "border-[#87fcc4aa] bg-[#87fcc41a]" : "border-line"}`}>
                  <span className="ltr">my-network</span><input type="radio" checked={network === "auto"} onChange={() => setNetwork("auto")} />
                </label>
              )}
              {nets.data?.networks.map((n) => (
                <label key={n._id} className={`flex items-center justify-between rounded-xl border p-4 cursor-pointer ${network === n._id ? "border-[#87fcc4aa] bg-[#87fcc41a]" : "border-line bg-[#2a2c36]"}`}>
                  <span className="ltr">{n.name}</span><input type="radio" checked={network === n._id} onChange={() => setNetwork(n._id)} />
                </label>
              ))}
            </div>
          )}

          {/* plan */}
          {key === "plan" && !created && (
            <div className="space-y-4">

              <div className="flex justify-center">
                <div className="inline-flex rounded-xl border border-line bg-[#ffffff08] p-1 gap-1">
                  {BUNDLE_TABS.map((b) => (
                    <button key={b.id} onClick={() => setBundle(b.id)} className={`px-8 py-2 rounded-lg transition ${bundle === b.id ? "bg-[#87fcc41f] border border-[#87fcc488] text-white" : "text-[#ccc]"}`}>{b.label}</button>
                  ))}
                </div>
              </div>

              {plans.loading && <div className="text-muted text-center">…</div>}
              {plans.data && <PlanMatrix plans={plans.data.plans} bundle={bundle} selected={planID} onSelect={setPlanID} />}
            </div>
          )}

          {/* review */}
          {isLast && !created && (
            <div className="space-y-4">
              {level === "assistant" && ai && (
                <div className="card p-5 border-[#87fcc455] bg-gradient-to-l from-[#87fcc412] to-transparent flex gap-4 items-start">
                  <span className="w-10 h-10 shrink-0 rounded-xl grid place-items-center text-[#0b1f17]" style={{ background: "var(--grad)" }}>✦</span>
                  <div className="leading-8 flex-1">{ai.summary}</div>
                  <button className="btn shrink-0" onClick={() => editAt("plan")}>✎ تغییر دستی تنظیمات</button>
                </div>
              )}
              <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
                <div className="card divide-y divide-line">
                  {([
                    ["نوع برنامه", plat.name, "platform"],
                    ["شناسه‌ی برنامه", `${name} (${name}.liara.run)`, "name"],
                    ["شبکه‌ی خصوصی", network === "auto" ? "my-network" : nets.data?.networks.find((n) => n._id === network)?.name ?? "—", "network"],
                    ["پلن", plan ? `${plan.name} (${plan.id})` : "—", "plan"],
                    ["بسته‌ی امکانات", BUNDLE_TABS.find((b) => b.id === bundle)?.label ?? bundle, "plan"],
                    ["منابع", plan ? `${plan.ramGB} GB RAM · ${plan.cpu} Core · ${plan.volume} GB Disk` : "—", null],
                    ["کد پروژه", file ? file.name : "—", level === "assistant" ? "project" : null],
                  ] as [string, string, Key | null][]).map(([k, v, edit]) => (
                    <div key={k} className="flex items-center justify-between gap-4 p-4">
                      <span className="text-[#ccc]">{k}</span>
                      <span className="flex items-center gap-3"><span className="ltr font-semibold">{v}</span>{edit && <button className="text-sm text-brand hover:underline shrink-0" onClick={() => editAt(edit)}>✎ تغییر</button>}</span>
                    </div>
                  ))}
                </div>
                <div className="card p-5 space-y-3">
                  <div className="flex justify-between"><span className="text-[#ccc]">هزینه‌ی پلن + بسته</span><span>{toman(monthly)}</span></div>
                  <div className="flex justify-between"><span className="text-[#ccc]">مالیات بر ارزش افزوده (۱۰٪)</span><span>{toman(vat)}</span></div>
                  <div className="border-t border-dashed border-line pt-3 flex justify-between items-end">
                    <span className="text-[#ccc]">معادل ماهانه</span><span className="text-2xl font-bold grad-text">{toman(monthly + vat)}</span>
                  </div>
                  {credit !== null && credit < monthly + vat && <div className="text-sm text-warn">اعتبار فعلی ({toman(credit)}) کمتر از هزینه‌ی یک ماه است.</div>}
                </div>
              </div>
            </div>
          )}

          {/* result */}
          {created && (
            <div className="card p-5 space-y-3 max-w-3xl mx-auto">
              <h2 className="font-bold">وضعیت عملیات</h2>
              {timeline.map((s, i) => (
                <div key={i} className={`text-sm rounded-lg px-3 py-2 ${s.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{s.ok ? "✓" : "✗"} {s.step}{s.detail && <span className="ltr block text-xs opacity-80">{s.detail}</span>}</div>
              ))}
              {busy && <Working label={!timeline.length ? "در حال ساخت برنامه در لیارا…" : `در حال آپلود${file ? ` (${(file.size / 1048576).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت)` : ""}… ممکن است چند دقیقه طول بکشد`} />}
              {releaseID && <div className="pt-2"><BuildProgress releaseID={releaseID} project={name} onDone={setBuildOk} /></div>}
              {(finished || (timeline.length > 0 && !allOk && !busy)) && (
                <div className="flex gap-2 pt-1">
                  {allOk && <Link href={`/apps/${name}`} className="btn btn-primary">رفتن به صفحه برنامه</Link>}
                  {!allOk && <button className="btn" onClick={() => { setCreated(false); setTimeline([]); }}>بازگشت و اصلاح</button>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* bottom bar (console order: next on the left, previous on the right) */}
        {!created && !(key === "project" && report?.stack && !single) && (
          <div className="border-t border-line pt-4 flex items-center justify-between sticky bottom-0 bg-[#181818]/90 backdrop-blur pb-2">
            <button className="text-[#ccc] disabled:opacity-30 flex items-center gap-1" disabled={step === 0} onClick={() => setStep(step - 1)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>قبلی</button>
            <span className="text-sm text-muted">مرحله‌ی {(step + 1).toLocaleString("fa-IR")} از {keys.length.toLocaleString("fa-IR")}</span>
            <button className="btn btn-primary px-8 py-3 rounded-xl min-w-[170px] justify-center" disabled={!canNext() || busy}
              onClick={() => (editingFromSummary ? setStep(keys.length - 1) : isLast ? launch() : key === "project" && !(custom && ai) ? planForBeginner() : setStep(step + 1))}>
              {busy && key === "project" ? "در حال بررسی…" : nextLabel}{!editingFromSummary && !isLast && !(busy && key === "project") && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mr-1"><path d="M15 6l-6 6 6 6" /></svg>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
