"use client";
import { use, useState } from "react";
import { useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import { ago } from "@/components/time";

const LABEL: Record<string, string> = { create: "کانتینر ساخته شد", start: "برنامه اجرا شد", die: "برنامه متوقف شد", oom: "کمبود حافظه (OOM)", kill: "برنامه کشته شد", stop: "برنامه خاموش شد", destroy: "کانتینر حذف شد" };
const COLOR: Record<string, string> = { start: "#57b36a", create: "#57b36a", oom: "#ff4d4f", die: "#ff4d4f", kill: "#ffa726", stop: "#8a8f9c", destroy: "#8a8f9c" };

export default function Events({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const { data, error, reload } = useApi<{ events: { status: string; time: number; version: number | null }[] }>(`/api/projects/${name}/events`, 5000);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [older, setOlder] = useState(false);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  const groups = new Map<string, typeof data.events>();
  for (const e of data.events) { const k = `v${e.version ?? "?"}`; groups.set(k, [...(groups.get(k) ?? []), e]); }
  const list = [...groups.entries()].slice(0, older ? 50 : 3);

  return (
    <div className="space-y-4 max-w-3xl">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-[#28c1f522] px-2.5 py-1 text-sm text-[#28c1f5]">● نمایش زنده</span>
      {list.length === 0 && <div className="card p-8 text-center text-muted">رویدادی ثبت نشده.</div>}
      {list.map(([ver, evs]) => {
        const last = evs[0];
        return (
          <div key={ver} className="rounded-xl bg-[#23252d]">
            <button className="w-full flex items-center justify-between gap-3 px-4 py-4" onClick={() => setOpen({ ...open, [ver]: !open[ver] })}>
              <span className="flex items-center gap-3"><span className="rounded border border-[#ffffff44] px-1.5 text-sm ltr">{ver}</span><span style={{ color: COLOR[last.status] }}>{LABEL[last.status] ?? last.status}</span></span>
              <span className="flex items-center gap-3 text-sm text-muted">
                <span className="flex gap-1">{evs.slice(0, 14).reverse().map((e, i) => <i key={i} className="w-2 h-2 rounded-[2px] inline-block" style={{ background: COLOR[e.status] ?? "#8a8f9c" }} title={e.status} />)}</span>
                {ago(last.time)}<span>{open[ver] ? "⌃" : "⌄"}</span>
              </span>
            </button>
            {open[ver] && (
              <ul className="border-t border-[#ffffff11] px-4 py-3 space-y-2 text-sm">
                {evs.map((e, i) => <li key={i} className="flex justify-between"><span style={{ color: COLOR[e.status] }}>● {LABEL[e.status] ?? e.status}</span><span className="text-muted">{ago(e.time)}</span></li>)}
              </ul>
            )}
          </div>
        );
      })}
      {!older && groups.size > 3 && <button className="block mx-auto text-sm text-[#ccc] hover:text-white" onClick={() => setOlder(true)}>نمایش رویدادهای قدیمی‌تر ⌄</button>}
    </div>
  );
}
