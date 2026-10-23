"use client";

export interface Pt { t: number; v: number }

/** Console-style area chart: faint grid, filled line, time labels. `fmt` formats y tick labels. */
export function AreaChart({ points, yMax, fmt, color = "#7c6df2", height = 190 }: { points: Pt[]; yMax: number; fmt: (v: number) => string; color?: string; height?: number }) {
  const W = 640, H = height, L = 46, R = 8, T = 10, B = 26;
  if (points.length < 2) return <div className="grid place-items-center text-sm text-muted" style={{ height }}>داده‌ای در این بازه نیست.</div>;
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.min(v, yMax) / yMax) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - B} L${x(t0).toFixed(1)},${H - B} Z`;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const label = (t: number) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full ltr" style={{ height }}>
      {ticks.map((k) => (
        <g key={k}><line x1={L} x2={W - R} y1={y(k * yMax)} y2={y(k * yMax)} stroke="#ffffff10" /><text x={L - 6} y={y(k * yMax) + 3} textAnchor="end" fontSize="10" fill="#8a8f9c">{fmt(k * yMax)}</text></g>
      ))}
      <path d={area} fill={color} fillOpacity=".25" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" />
      {[0, 0.5, 1].map((k) => <text key={k} x={L + k * (W - L - R)} y={H - 8} textAnchor={k === 0 ? "start" : k === 1 ? "end" : "middle"} fontSize="10" fill="#8a8f9c">{label(t0 + k * (t1 - t0))}</text>)}
    </svg>
  );
}
