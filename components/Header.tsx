"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "./api";

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0" stopColor="#87fcc4" />
          <stop offset="1" stopColor="#28c1f5" />
        </linearGradient>
      </defs>
      <path d="M17 2 31 10v14L17 32 3 24V10z" fill="url(#lg)" />
      <path d="M17 2 31 10 17 18 3 10z" fill="#ffffff55" />
      <path d="M17 18v14" stroke="#0b1f17" strokeOpacity=".35" strokeWidth="1.5" />
    </svg>
  );
}

const I = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICON = {
  cube: I("M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10"),
  check: I("M20 6 9 17l-5-5"),
  heart: I("M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"),
  gear: I("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"),
  bell: I("M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"),
  search: I("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3"),
  chart: I("M3 3v18h18M7 15l4-4 3 3 6-7"),
  spark: I("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"),
};

const TABS = [
  { href: "/apps", label: "پلتفرم", icon: ICON.cube, match: (p: string) => p === "/" || p.startsWith("/apps") },
];

const LINKS = [
  { label: "مستندات", href: "https://docs.liara.ir" },
  { label: "API", href: "https://openapi.liara.ir" },
];

export default function Header() {
  const path = usePathname();
  const billing = useApi<{ team: number | null; user: number }>("/api/billing", 60000);
  const me = useApi<{ fullname: string; avatar?: string }>("/api/me");
  const approvals = useApi<{ approvals: { status: string }[] }>("/api/approvals", 8000);
  const pending = approvals.data?.approvals.filter((a) => a.status === "pending").length ?? 0;
  const b = billing.data;
  const credit = b ? (b.team ?? b.user) : null;

  if (path.startsWith("/apps/create")) return null; // the create wizard is full-screen, like the console
  return (
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur">
      <div className="h-16 px-5 flex items-center justify-between border-b border-line gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/apps" className="flex items-center gap-2 shrink-0">
            <Logo size={32} />
            <span className="font-extrabold grad-text text-xl">لیارا‌پایلوت</span>
          </Link>
          {me.data && <span className="text-muted hidden md:inline">/</span>}
          {me.data && <span className="hidden md:flex items-center gap-2 text-sm text-[#ccc]">
            <span className="w-7 h-7 rounded-full grid place-items-center text-[#0b1f17] font-bold text-xs" style={{ background: "var(--grad)" }}>{me.data.fullname.trim().charAt(0)}</span>
            {me.data.fullname}
          </span>}
          <nav className="hidden lg:flex items-center gap-5 text-sm text-[#ccc] mr-3">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="hover:text-white ltr">{l.label}</a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {credit !== null && (
            <span className="hidden md:inline text-[#ccc]">
              {b?.team != null ? "اعتبار تیم" : "اعتبار"}: <b className="text-white">{Math.round(credit).toLocaleString("fa-IR")}</b> تومان
            </span>
          )}
          <Link href="/approvals" className="relative text-[#ccc] hover:text-white p-1" aria-label="تأییدیه‌ها">
            {ICON.bell}
            {pending > 0 && <span className="absolute -top-1 -left-1 min-w-4 h-4 px-1 rounded-full bg-[#e53735] text-white text-[10px] grid place-items-center">{pending}</span>}
          </Link>
          <span className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs`}>
            <span className={`w-2 h-2 rounded-full ${billing.error ? "bg-bad" : "bg-brand"}`} />
            {billing.error ? "خطا در اتصال" : "متصل به لیارا"}
          </span>
          <button
            onClick={() => window.dispatchEvent(new Event("open-assistant"))}
            className="hidden sm:flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#ffffff0d]"
          >
            {ICON.search}<span>پرسش از دستیار</span><span className="ltr text-muted">⌘K</span>
          </button>
          <Link href="/admin" title="پنل مدیریت" className={`p-1.5 rounded-lg hover:bg-[#ffffff0d] ${path.startsWith("/admin") ? "text-brand" : "text-[#ccc]"}`}>{ICON.chart}</Link>
          <Link href="/settings" title="تنظیمات" className={`p-1.5 rounded-lg hover:bg-[#ffffff0d] ${path.startsWith("/settings") ? "text-brand" : "text-[#ccc]"}`}>{ICON.gear}</Link>
        </div>
      </div>
      <div className="bg-[#1f2027] border-b border-line px-5 overflow-x-auto">
        <div className="flex items-center gap-2 h-[68px] min-w-max">
          {TABS.map((t) => {
            const active = t.match(path);
            return (
              <Link key={t.href} href={t.href} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[15px] transition ${active ? "text-brand" : "text-[#ccc] hover:text-white"}`}>
                <span className={`w-9 h-9 rounded-lg grid place-items-center ${active ? "bg-[#87fcc41f] border border-[#87fcc433]" : "bg-[#ffffff0d]"}`}>{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
