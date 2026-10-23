"use client";
import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const I = (d: string) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const MENU = [
  { id: "overview", label: "اطلاعات کلی", icon: I("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01") },
  { id: "deploy", label: "استقرار جدید", icon: I("M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-4 12.9 12.9 0 0 1 11-6c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z") },
  { id: "events", label: "رویدادها", icon: I("M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z") },
  { id: "releases", label: "تاریخچه", icon: I("M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2") },
  { id: "monitoring", label: "گزارشات", icon: I("M3 17l6-6 4 4 8-8M17 7h4v4") },
  { id: "ai-log", label: "مانیتورینگ هوشمند", icon: I("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z") },
  { id: "logs", label: "لاگ‌ها", icon: I("M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h8") },
  { id: "disks", label: "دیسک‌ها", icon: I("M3 12h18M5 12V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M5 12v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5M7 16h.01") },
  { id: "domains", label: "دامنه‌ها", icon: I("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z") },
  { id: "resize", label: "تغییر اندازه", icon: I("M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7") },
  { id: "settings", label: "تنظیمات", icon: I("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z") },
];

/** The console's app layout: vertical menu on the right (RTL start), page content beside it. */
export default function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const path = usePathname();
  return (
    <div className="grid md:grid-cols-[230px_minmax(0,1fr)] gap-6 -mx-2">
      <aside className="md:border-l border-[#ffffff14] md:pl-4">
        <nav className="md:sticky md:top-6">
          <div className="text-center text-[#ddd] text-[15px] py-4 ltr truncate">{name}</div>
          <ul className="flex md:flex-col gap-1 overflow-x-auto">
            {MENU.map((m) => {
              const active = path === `/apps/${name}/${m.id}`;
              return (
                <li key={m.id}>
                  <Link href={`/apps/${name}/${m.id}`} className={`flex items-center gap-3 rounded-lg px-4 py-3 text-[16px] whitespace-nowrap transition ${active ? "font-semibold text-[#181818]" : "text-[#e6e6e6] hover:bg-[#ffffff0d]"}`} style={active ? { background: "var(--grad)" } : undefined}>
                    <span className="shrink-0 opacity-90">{m.icon}</span>{m.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
