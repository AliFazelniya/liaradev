"use client";
import { use } from "react";
import { useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";

export default function Disks({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const { data, error, reload } = useApi<{ disks: any[] }>(`/api/projects/${name}/disks`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  if (!data.disks.length) return <div className="rounded-xl bg-[#23252d] p-12 text-center text-[#ccc]">دیسکی برای این برنامه ساخته نشده است.</div>;
  return (
    <div className="rounded-xl bg-[#23252d] divide-y divide-[#ffffff11]">
      {data.disks.map((d, i) => (
        <div key={i} className="flex items-center justify-between px-5 py-4"><span className="ltr font-semibold">{d.name}</span><span className="text-sm text-muted ltr">{d.size} GB · {d.mountPath ?? d.path ?? ""}</span></div>
      ))}
    </div>
  );
}
