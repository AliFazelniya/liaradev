"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/components/api";
import ConnectionsForm from "@/components/ConnectionsForm";

const MODES = [
  { id: "assistant", t: "دستیار", d: "همه تغییرات با تأیید شما" },
  { id: "autopilot", t: "خلبان خودکار", d: "کارهای کم‌ریسک خودکار" },
  { id: "auto", t: "کاملاً خودکار", d: "فقط هزینه، خاموشی و حذف تأیید می‌خواهد" },
];

/** scope "admin": the operator's connections (Liara token, AI provider). scope "user": how independent the assistant is and how often it checks. */
export default function SettingsView({ scope = "user" }: { scope?: "user" | "admin" }) {
  const { data, reload } = useApi<any>("/api/settings");
  const [f, setF] = useState<any>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);
  async function save(patch: any) {
    const next = { ...f, ...patch }; setF(next);
    await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setSaved(true); setTimeout(() => setSaved(false), 1500); reload();
  }
  if (!data) return <div className="text-muted">…</div>;
  if (scope === "admin") return <div className="space-y-6 max-w-2xl mx-auto"><ConnectionsForm data={data} onSaved={reload} /></div>;
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {saved && <span className="pill pill-ok">ذخیره شد</span>}
      <section className="card p-5 space-y-3">
        <h2 className="font-bold">میزان استقلال هوش مصنوعی</h2>
        {MODES.map((m) => (
          <label key={m.id} className={`flex gap-3 p-3 rounded-xl border cursor-pointer ${f.mode === m.id ? "border-brand bg-brand-soft" : "border-line"}`}>
            <input type="radio" checked={f.mode === m.id} onChange={() => save({ mode: m.id })} />
            <div><div className="font-semibold text-sm">{m.t}</div><div className="text-xs text-muted">{m.d}</div></div>
          </label>
        ))}
      </section>
      <section className="card p-5 space-y-3">
        <h2 className="font-bold">پایش خودکار</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.monitorEnabled} onChange={(e) => save({ monitorEnabled: e.target.checked })} /> فعال</label>
        <label className="text-sm flex items-center gap-2">هر <input type="number" min={1} className="input w-24" value={f.monitorEveryMinutes ?? 60} onChange={(e) => setF({ ...f, monitorEveryMinutes: +e.target.value })} onBlur={() => save({ monitorEveryMinutes: f.monitorEveryMinutes })} /> دقیقه</label>
      </section>
    </div>
  );
}
