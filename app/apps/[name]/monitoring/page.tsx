"use client";
import { use, useEffect, useState } from "react";
import { useApi } from "@/components/api";
import { AreaChart } from "@/components/charts";
import { ErrorBox } from "@/components/ui";
import AiCheck from "@/components/AiCheck";
import { ApprovalsPanel, HealthPanel } from "@/components/panels";

const RANGES = [{ m: 60, l: "یک ساعت گذشته" }, { m: 360, l: "۶ ساعت گذشته" }, { m: 1440, l: "۲۴ ساعت گذشته" }, { m: 10080, l: "هفت روز گذشته" }];
const bytes = (v: number) => (v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB/s` : v >= 1024 ? `${(v / 1024).toFixed(0)} KB/s` : `${Math.round(v)} B/s`);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl bg-[#23252d] p-5"><h3 className="text-lg font-bold mb-3">{title}</h3>{children}</div>;
}

export default function Monitoring({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const [minutes, setMinutes] = useState(60);
  const [live, setLive] = useState(true);
  const ov = useApi<any>(`/api/projects/${name}/overview`);
  const { data, error, reload } = useApi<any>(`/api/projects/${name}/series?minutes=${minutes}`, live ? 15000 : 0);
  useEffect(() => { reload(); }, [minutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = ov.data?.plan;
  const cpu = (data?.series?.cpu ?? []).map((p: any) => ({ t: p.t, v: plan ? (p.v / plan.cpu) * 100 : p.v * 100 }));
  const mem = (data?.series?.memory ?? []).map((p: any) => ({ t: p.t, v: plan ? (p.v / (plan.ramGB * 1024 ** 3)) * 100 : 0 }));
  const rx = data?.series?.["network-receive"] ?? [], tx = data?.series?.["network-transmit"] ?? [];
  const peak = (a: { v: number }[]) => Math.max(1, ...a.map((p) => p.v));


  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <select className="input w-48" value={minutes} onChange={(e) => setMinutes(+e.target.value)}>{RANGES.map((r) => <option key={r.m} value={r.m}>{r.l}</option>)}</select>
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          <button className={`px-3 py-2 ${live ? "bg-[#87fcc41a] text-brand" : ""}`} onClick={() => setLive(true)} title="زنده">▶</button>
          <button className={`px-3 py-2 border-r border-line ${!live ? "bg-[#87fcc41a] text-brand" : ""}`} onClick={() => setLive(false)} title="توقف">❚❚</button>
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      <div className="grid xl:grid-cols-2 gap-5">
        <Card title="میزان مصرف پردازنده (CPU)"><AreaChart points={cpu} yMax={100} fmt={(v) => `${Math.round(v)}%`} /></Card>
        <Card title="میزان مصرف حافظه (RAM)"><AreaChart points={mem} yMax={100} fmt={(v) => `${Math.round(v)}%`} color="#28c1f5" /></Card>
        <Card title="میزان ترافیک ورودی (Network In)"><AreaChart points={rx} yMax={peak(rx) * 1.15} fmt={bytes} color="#57b36a" /></Card>
        <Card title="میزان ترافیک خروجی (Network Out)"><AreaChart points={tx} yMax={peak(tx) * 1.15} fmt={bytes} color="#e99a27" /></Card>
      </div>

      <AiCheck name={name} />

      <section className="space-y-3"><h2 className="font-bold text-lg">گزارش‌های سلامت</h2><HealthPanel project={name} /></section>
      <section className="space-y-3"><h2 className="font-bold text-lg">تأییدیه‌ها</h2><ApprovalsPanel project={name} /></section>
    </div>
  );
}
