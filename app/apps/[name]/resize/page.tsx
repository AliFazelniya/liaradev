"use client";
import { use, useEffect, useState } from "react";
import { api, useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import PlanMatrix from "@/components/PlanMatrix";
import Confirm from "@/components/Confirm";
import { BUNDLE_TABS } from "@/lib/platforms";

export default function Resize({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const { data, error, reload } = useApi<any>(`/api/projects/${name}/overview`);
  const [bundle, setBundle] = useState("basic");
  const [sel, setSel] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) { setBundle(data.project.bundlePlanID ?? "basic"); setSel(data.project.planID); } }, [data?.project?.planID, data?.project?.bundlePlanID]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  const p = data.project;
  const plan = data.plans.find((x: any) => x.id === sel);
  const same = sel === p.planID && bundle === p.bundlePlanID;

  async function go() {
    setBusy(true); setMsg(null);
    try { await api(`/api/projects/${name}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "change_plan", args: { planID: sel, bundlePlanID: bundle } }) }); setMsg({ ok: true, text: "تغییر اندازه انجام شد." }); setTimeout(reload, 1500); }
    catch (e: any) { setMsg({ ok: false, text: `ناموفق: ${e.error ?? "خطا"}${e.hint ? " — " + e.hint : ""}` }); } finally { setBusy(false); setAsk(false); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-center">انتخاب منابع</h1>
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-line bg-[#ffffff08] p-1 gap-1">
          {BUNDLE_TABS.map((b) => <button key={b.id} onClick={() => setBundle(b.id)} className={`px-8 py-2 rounded-lg transition ${bundle === b.id ? "bg-[#87fcc41f] border border-[#87fcc488] text-white" : "text-[#ccc]"}`}>{b.label}</button>)}
        </div>
      </div>
      <PlanMatrix plans={data.plans} bundle={bundle} selected={sel} current={p.planID} onSelect={setSel} />
      {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{msg.text}</div>}
      <div className="flex justify-end"><button className="btn btn-primary px-8 py-3 rounded-xl" disabled={same || !sel} onClick={() => setAsk(true)}>تغییر اندازه</button></div>
      {ask && <Confirm title="تغییر اندازه؟" body={`برنامه به «${plan?.name}» (${plan?.ramGB}GB رم) و بسته‌ی ${BUNDLE_TABS.find((b) => b.id === bundle)?.label} تغییر می‌کند و ری‌استارت می‌شود.`} busy={busy} onYes={go} onNo={() => setAsk(false)} />}
    </div>
  );
}
