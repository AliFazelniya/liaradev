"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import SettingsView from "@/components/SettingsView";

interface Sum { calls: number; prompt: number; hit: number; completion: number; cost: number }
interface Usage {
  pricing: { hit: number; miss: number; out: number };
  provider: string;
  model: string;
  total: Sum;
  today: Sum;
  bySource: Record<string, Sum>;
  byDay: ({ day: string } & Sum)[];
  recent: { at: string; source: string; provider?: string; model: string; promptTokens: number; cacheHitTokens: number; completionTokens: number; costUSD: number; ms: number; note?: string }[];
  recentTotal: number;
  liaraCalls: { endpoint: string; count: number }[];
  liaraTotal: number;
}

const SRC: Record<string, string> = { chat: "چت دستیار", wizard: "ویزارد ساخت", monitor: "پایش خودکار", diagnose: "بررسی با هوش مصنوعی" };
const usd = (n: number) => "$" + (n < 0.01 ? n.toFixed(5) : n.toFixed(3));
const num = (n: number) => Math.round(n).toLocaleString("fa-IR");

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="text-2xl font-bold mt-1 ltr text-right">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

function UsageTab() {
  const [page, setPage] = useState(1), [size, setSize] = useState(15);
  const { data, error, reload } = useApi<Usage>(`/api/admin/usage?page=${page}&size=${size}`, 8000);
  const [price, setPrice] = useState<{ hit: string; miss: string; out: string } | null>(null);

  async function savePrice() {
    if (!price) return;
    await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pricing: { hit: +price.hit, miss: +price.miss, out: +price.out } }) });
    setPrice(null); reload();
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  const maxDay = Math.max(...data.byDay.map((d) => d.cost), 1e-9);
  const p = price ?? { hit: String(data.pricing.hit), miss: String(data.pricing.miss), out: String(data.pricing.out) };

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="هزینه‌ی امروز (هوش مصنوعی)" value={usd(data.today.cost)} sub={`${num(data.today.calls)} فراخوانی`} />
        <Stat label="هزینه‌ی کل (هوش مصنوعی)" value={usd(data.total.cost)} sub={`${num(data.total.calls)} فراخوانی`} />
        <Stat label="توکن‌ها" value={num(data.total.prompt + data.total.completion)} sub={`ورودی ${num(data.total.prompt)} · خروجی ${num(data.total.completion)}`} />
        <Stat label="درخواست‌های API لیارا" value={num(data.liaraTotal)} sub={`${data.liaraCalls.length.toLocaleString("fa-IR")} endpoint`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-bold mb-4">هزینه به تفکیک بخش</h2>
          {Object.keys(data.bySource).length === 0 && <div className="text-muted text-sm">هنوز فراخوانی ثبت نشده.</div>}
          <div className="space-y-3">
            {Object.entries(data.bySource).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-sm"><span>{SRC[k] ?? k}</span><span className="ltr">{usd(v.cost)} · {num(v.calls)}×</span></div>
                <div className="h-2 rounded bg-[#ffffff12] mt-1"><div className="h-2 rounded" style={{ width: `${Math.max(4, (v.cost / Math.max(data.total.cost, 1e-9)) * 100)}%`, background: "var(--grad)" }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="font-bold mb-4">هزینه‌ی روزانه (۱۴ روز اخیر)</h2>
          {data.byDay.length === 0 && <div className="text-muted text-sm">—</div>}
          <div className="flex items-end gap-2 h-32 ltr px-1">
            {data.byDay.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${d.day} · ${usd(d.cost)}`}>
                <div className="w-full rounded-t" style={{ height: `${Math.round(6 + (d.cost / maxDay) * 90)}px`, background: "var(--grad)" }} />
                <span className="text-[10px] text-muted">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="font-bold">نرخ‌ها (دلار به ازای هر ۱ میلیون توکن) · <span className="ltr inline-block">{data.provider || "—"} / {data.model}</span></h2>
          {price && <button className="btn btn-primary" onClick={savePrice}>ذخیره</button>}
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-xl ltr">
          {([["hit", "Cache hit"], ["miss", "Cache miss"], ["out", "Output"]] as const).map(([k, label]) => (
            <label key={k} className="text-xs text-muted">{label}
              <input className="input mt-1" inputMode="decimal" value={p[k]} onChange={(e) => setPrice({ ...p, [k]: e.target.value })} />
            </label>
          ))}
        </div>
      </div>

      <div className="card p-5 overflow-x-auto">
        <h2 className="font-bold mb-3">آخرین فراخوانی‌ها</h2>
        <table className="w-full text-sm">
          <thead className="text-muted"><tr>{["زمان", "بخش", "ورودی", "از کش", "خروجی", "هزینه", "مدت"].map((h) => <th key={h} className="text-right font-normal p-2">{h}</th>)}</tr></thead>
          <tbody>
            {data.recent.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="p-2 ltr text-right">{new Date(r.at).toLocaleTimeString("en-GB")}</td>
                <td className="p-2">{SRC[r.source] ?? r.source}<span className="text-xs text-muted ltr inline-block mr-1">{r.provider ? ` · ${r.provider}` : ""}</span>{r.note && <span className="text-xs text-muted"> · {r.note}</span>}</td>
                <td className="p-2">{num(r.promptTokens)}</td>
                <td className="p-2">{num(r.cacheHitTokens)}</td>
                <td className="p-2">{num(r.completionTokens)}</td>
                <td className="p-2 ltr text-right">{usd(r.costUSD)}</td>
                <td className="p-2">{(r.ms / 1000).toFixed(1)}s</td>
              </tr>
            ))}
            {data.recent.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted">—</td></tr>}
          </tbody>
        </table>
        {data.recentTotal > 0 && (() => {
          const pages = Math.max(1, Math.ceil(data.recentTotal / size));
          return (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-line text-sm">
              <span className="text-muted">{num(data.recentTotal)} فراخوانی</span>
              <div className="flex items-center gap-2">
                <button className="btn !py-1" disabled={page >= pages} onClick={() => setPage(page + 1)}>قدیمی‌تر</button>
                <span className="px-2">صفحه {num(page)} از {num(pages)}</span>
                <button className="btn !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>جدیدتر</button>
              </div>
              <label className="flex items-center gap-2 text-muted">تعداد در صفحه
                <select className="input !w-20 !py-1" value={size} onChange={(e) => { setSize(+e.target.value); setPage(1); }}>{[10, 15, 25, 50].map((n) => <option key={n} value={n}>{num(n)}</option>)}</select>
              </label>
            </div>
          );
        })()}
      </div>

    </div>
  );
}

const TABS = [
  { id: "usage", label: "هزینه‌ی هوش مصنوعی" },
  { id: "settings", label: "تنظیمات و اتصال‌ها" },
];

export default function Admin() {
  const [tab, setTab] = useState("usage");
  useEffect(() => { const h = window.location.hash.slice(1); if (TABS.some((t) => t.id === h)) setTab(h); }, []);
  const pick = (id: string) => { setTab(id); history.replaceState(null, "", `#${id}`); };
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">پنل مدیریت</h1>
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => pick(t.id)} className={`px-4 py-3 whitespace-nowrap border-b-2 transition ${tab === t.id ? "border-[#87fcc4] text-brand font-semibold" : "border-transparent text-[#ccc] hover:text-white"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "usage" && <UsageTab />}
      {tab === "settings" && <SettingsView scope="admin" />}
    </div>
  );
}
