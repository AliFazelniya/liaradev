"use client";
import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import { platformLogo } from "@/lib/platforms";

function EmptyArt() {
  const row = (y: number, x: number, w: number) => (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height="62" rx="9" fill="#2a2c36" stroke="#ffffff10" />
      <rect x="9" y="9" width="44" height="44" rx="8" fill="url(#ea)" />
      <path d="M31 19l11 6v12l-11 6-11-6V25z M20 25l11 6 11-6 M31 31v12" fill="none" stroke="#0b1f17" strokeWidth="2" strokeLinejoin="round" />
      <rect x="66" y="25" width={w - 90} height="12" rx="6" fill="#4a4d5c" />
    </g>
  );
  return (
    <svg width="360" height="230" viewBox="0 0 360 230" aria-hidden>
      <defs><linearGradient id="ea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#87fcc4" /><stop offset="1" stopColor="#28c1f5" /></linearGradient></defs>
      <path d="M70 30c60-14 150-26 215-8 40 12 36 80 38 120 2 40-40 62-120 66-70 3-140-8-150-50-8-36-6-96 17-128z" fill="none" stroke="#87fcc455" strokeWidth="1.5" />
      {row(30, 40, 190)}{row(84, 120, 190)}{row(138, 40, 190)}
    </svg>
  );
}

const Bar = ({ pct }: { pct: number | null }) => (
  <div className="w-[120px] h-1.5 rounded-full bg-[#303030] overflow-hidden"><div className="h-full rounded-full bg-[#28c1f5]" style={{ width: `${Math.max(pct ?? 0, pct ? 3 : 0)}%` }} /></div>
);

function statusOf(p: any): [string, string] {
  if (p.status === "SHUTDOWN") return ["خاموش", "#ff706f"];
  if (!p.isDeployed) return ["آماده به کار", "#28c1f5"];
  return ["روشن", "#57b36a"];
}

function RowMenu({ name }: { name: string }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    const onDoc = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-rowmenu]")) close(); };
    document.addEventListener("click", onDoc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("click", onDoc); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [pos]);
  const toggle = () => {
    if (pos) return close();
    const r = btn.current!.getBoundingClientRect();
    const MENU_W = 192, MENU_H = 6 * 40 + 8;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - MENU_W - 8);
    // render in a portal (the table card clips overflow); open upward when there is no room below
    setPos(window.innerHeight - r.bottom < MENU_H + 12 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };
  return (
    <div onClick={(e) => e.stopPropagation()} data-rowmenu>
      <button ref={btn} className="w-10 h-10 rounded-full hover:bg-[#ffffff12] text-xl" onClick={toggle} aria-label="More">⋮</button>
      {pos && createPortal(
        <div data-rowmenu className="fixed z-[70] w-48 rounded-xl border border-line bg-[#272932] py-1 shadow-2xl text-sm" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}>
          {[["اطلاعات کلی", "overview"], ["استقرار جدید", "deploy"], ["لاگ‌ها", "logs"], ["گزارشات", "monitoring"], ["تغییر اندازه", "resize"], ["تنظیمات", "settings"]].map(([l, r]) => (
            <Link key={r} href={`/apps/${name}/${r}`} onClick={close} className="block px-4 py-2.5 hover:bg-[#ffffff0d]">{l}</Link>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function Apps() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ projects: any[] }>("/api/projects", 15000);
  const [showFilter, setShowFilter] = useState(false);
  const [plats, setPlats] = useState<string[]>([]);
  const [nets, setNets] = useState<string[]>([]);
  const all = data?.projects ?? [];
  const platOpts = [...new Set(all.map((p) => p.type))];
  const netOpts = [...new Set(all.map((p) => p.networkName).filter(Boolean))] as string[];
  const rows = all.filter((p) => (!plats.length || plats.includes(p.type)) && (!nets.length || nets.includes(p.networkName)));
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <div className="text-muted text-center py-20">…</div>;
  if (data && !all.length)
    return (
      <div className="flex flex-col items-center text-center pt-10 pb-6">
        <EmptyArt />
        <p className="mt-6 text-[17px] leading-9 text-[#e6e6e6]">شما تا الان هیچ برنامه‌ای ایجاد نکرده‌اید.<br />با کلیک روی دکمه‌ی ایجاد برنامه، یک برنامه‌ی جدید بسازید.</p>
        <Link href="/apps/create" className="btn btn-primary mt-6 px-7 py-3 text-base rounded-xl">＋ ایجاد برنامه</Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/apps/create" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[14px] font-bold text-[#181818]" style={{ background: "var(--grad)" }}>＋ ایجاد برنامه</Link>
        <button className="flex items-center gap-1 px-1.5 py-1 rounded text-[13px] font-medium text-[#ccc] hover:bg-[#ffffff0d]" onClick={() => setShowFilter(!showFilter)}>☰ فیلتر</button>
      </div>

      {showFilter && (
        <div className="card p-4 flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <div className="flex items-center gap-3 flex-wrap"><span className="text-muted">نوع پلتفرم:</span>{platOpts.map((o) => (
            <label key={o} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={plats.includes(o)} onChange={() => toggle(plats, setPlats, o)} /><img src={platformLogo(o)} alt="" width={18} height={18} />{o.toUpperCase()}</label>))}</div>
          <div className="flex items-center gap-3 flex-wrap"><span className="text-muted">شبکه خصوصی:</span>{netOpts.map((o) => (
            <label key={o} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={nets.includes(o)} onChange={() => toggle(nets, setNets, o)} />{o}</label>))}</div>
        </div>
      )}

      <div className="rounded-xl bg-[#23252d] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[13px] font-medium text-[#808080]">
              {["شناسه برنامه", "شبکه خصوصی", "وضعیت", "گزارش لحظه‌ای", ""].map((h, i) => <th key={i} className="text-right py-[15px] pr-6 pl-14 first:pr-14 border-b border-[#ffffff11] font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const [label, color] = statusOf(p);
              return (
                <tr key={p._id} onClick={() => router.push(`/apps/${p.project_id}/overview`)} className="cursor-pointer hover:bg-[#ffffff05]">
                  <td className="h-16 px-4 border-b border-[#ffffff11]">
                    <div className="flex items-center gap-3 pr-10">
                      <img src={platformLogo(p.type)} alt={p.type} width={30} height={30} className="rounded-[7px] bg-[#ffffff11] p-0.5 object-contain" />
                      <span className="text-[15px] ltr">{p.project_id}</span>
                    </div>
                  </td>
                  <td className="px-4 border-b border-[#ffffff11] pr-6">{p.networkName && <span className="inline-block rounded-md px-2 py-0.5 text-xs text-[#985eff] ltr" style={{ background: "rgba(152,94,255,.133)" }}>{p.networkName}</span>}</td>
                  <td className="px-4 border-b border-[#ffffff11] pr-6 text-[14px]"><span style={{ color }}>●</span> {label}</td>
                  <td className="px-4 border-b border-[#ffffff11] pr-6">
                    <div className="grid grid-cols-[auto_120px] items-center gap-x-3 gap-y-1.5 text-[11px] text-[#808080] w-max">
                      <span>RAM</span><Bar pct={p.memPct} /><span>CPU</span><Bar pct={p.cpuPct} />
                    </div>
                  </td>
                  <td className="px-2 border-b border-[#ffffff11]"><RowMenu name={p.project_id} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
