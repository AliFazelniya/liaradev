"use client";
import { use } from "react";
import { useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";

export default function Domains({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const { data, error, reload } = useApi<{ domains: any[] }>(`/api/projects/${name}/domains`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  if (!data.domains.length) return <div className="rounded-xl bg-[#23252d] p-12 text-center leading-9 text-[#ccc]">شما تا الان هیچ دامنه‌ای اضافه نکرده‌اید.</div>;
  return (
    <div className="rounded-xl bg-[#23252d] divide-y divide-[#ffffff11]">
      {data.domains.map((d, i) => (
        <div key={i} className="flex items-center justify-between px-5 py-4"><span className="ltr font-semibold">{d.name}</span><span className="text-sm text-muted">{d.status ?? ""}</span></div>
      ))}
    </div>
  );
}
