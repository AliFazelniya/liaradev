"use client";
import type { ApiError } from "./api";

export function ErrorBox({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="card p-4 border-bad/40 bg-bad-soft text-sm">
      <div className="font-semibold text-bad mb-1">
        {error.source === "liara" ? `لیارا خطا برگرداند${error.status ? ` (${error.status})` : ""}` : "خطا"}
      </div>
      <div className="ltr">{error.error}</div>
      {error.hint && <div className="mt-1 text-muted">{error.hint}</div>}
      {onRetry && <button className="btn mt-3" onClick={onRetry}>تلاش دوباره</button>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    RUNNING: ["pill-ok", "در حال اجرا"], SHUTDOWN: ["pill-bad", "خاموش"], BUILDING: ["pill-warn", "در حال ساخت"],
  };
  const [c, l] = m[status] ?? ["pill-muted", status];
  return <span className={`pill ${c}`}>{l}</span>;
}

export function Spark({ data, color = "var(--primary)", h = 48, max }: { data: number[]; color?: string; h?: number; max?: number }) {
  if (data.length < 2) return <div className="text-xs text-muted h-12 grid place-items-center">داده‌ای نیست</div>;
  const mx = max ?? Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${h - (Math.min(v, mx) / mx) * (h - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export const toman = (n: number) => Math.round(n).toLocaleString("fa-IR") + " تومان";
export const monthlyToman = (hourly: number) => toman(hourly * 720) + " در ماه";
