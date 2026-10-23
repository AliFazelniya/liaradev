"use client";
import { PLANET_IMG } from "@/lib/platforms";

const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");

/** The console's plan picker: one COLUMN per plan with its planet image, rows for price/RAM/CPU/disk. */
export default function PlanMatrix({ plans, bundle, selected, current, onSelect }: { plans: any[]; bundle: string; selected: string | null; current?: string | null; onSelect: (id: string) => void }) {
  const rows: [string, (p: any, b: any) => string][] = [
    ["قیمت ماهانه", (_, b) => `${fa(b.monthly)} تومان`],
    ["قیمت ساعتی", (_, b) => `${fa(b.hourly)} تومان`],
    ["RAM", (p) => (p.ramGB >= 1 ? `${p.ramGB} GB` : `${p.ramGB * 1024} MB`)],
    ["vCPU", (p) => `${p.cpu} Core`],
    ["Disk", (p) => `${p.volume} GB`],
  ];
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max">
        <div className="w-28 shrink-0 pt-[118px]">
          {rows.map(([label], i) => <div key={label} className={`h-12 flex items-center text-[#ccc] text-sm ${i === 0 ? "" : ""}`}>{label}</div>)}
        </div>
        {plans.map((p) => {
          const b = p.bundles.find((x: any) => x.id === bundle);
          if (!b) return null;
          const sel = selected === p.id;
          return (
            <button key={p.id} onClick={() => onSelect(p.id)} className={`w-[132px] shrink-0 border-x border-t first:rounded-r-xl last:rounded-l-xl transition text-center ${sel ? "border-[#87fcc488] bg-[#87fcc41a]" : "border-line hover:bg-[#ffffff08]"}`}>
              <div className="h-[118px] flex flex-col items-center justify-center gap-2">
                <img src={`/assets/planets/${PLANET_IMG[p.name] ?? "earth.png"}`} alt="" width={64} height={64} className="object-contain" />
                <div className="font-bold">{p.name}{current === p.id && <span className="text-[10px] text-brand mr-1">(فعلی)</span>}</div>
              </div>
              {rows.map(([label, fn]) => <div key={label} className="h-12 flex items-center justify-center text-sm border-t border-line ltr">{fn(p, b)}</div>)}
              <div className={`h-1 ${sel ? "" : ""}`} style={sel ? { background: "var(--grad)" } : undefined} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
