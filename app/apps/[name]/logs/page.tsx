"use client";
import { use, useEffect, useRef, useState } from "react";
import { useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";

const RANGES = [{ m: 15, l: "۱۵ دقیقه قبل" }, { m: 60, l: "۱ ساعت قبل" }, { m: 360, l: "۶ ساعت قبل" }, { m: 1440, l: "۲۴ ساعت قبل" }];

export default function Logs({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const [minutes, setMinutes] = useState(60);
  const [release, setRelease] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const url = `/api/projects/${name}/logs?minutes=${minutes}${query ? `&q=${encodeURIComponent(query)}` : ""}${release ? `&release=${release}` : ""}`;
  const { data, error, reload } = useApi<any>(url, 10000);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [data?.logs?.length]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select className="input w-44" value={release} onChange={(e) => setRelease(e.target.value)}>
          <option value="">تمام استقرارها</option>
          {data?.releases?.map((r: any) => <option key={r.id} value={r.id}>v{r.version}</option>)}
        </select>
        <input className="input flex-1 min-w-[200px] ltr" placeholder="Press Enter to search..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setQuery(q)} />
        <select className="input w-40" value={minutes} onChange={(e) => setMinutes(+e.target.value)}>{RANGES.map((r) => <option key={r.m} value={r.m}>{r.l}</option>)}</select>
        <button className="btn" onClick={reload} title="بروزرسانی">↻</button>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      <div ref={box} className="rounded-xl bg-[#1b1d24] border border-line max-h-[620px] overflow-auto ltr">
        {!data && <div className="p-6 text-muted text-center">…</div>}
        {data?.logs?.length === 0 && <div className="p-6 text-muted text-center">لاگی در این بازه نیست.</div>}
        {data?.logs?.map((l: any, i: number) => (
          <div key={i} className={`px-4 py-2.5 border-b border-[#ffffff0d] text-[13px] leading-6 break-all ${l.type === "stderr" ? "text-[#ff8d92]" : "text-[#e2e6f0]"}`}>
            <span className="text-[#8a8f9c]">v{l.version ?? "?"} | {l.datetime.slice(0, 19).replace("T", " ")} | </span>{l.message}
          </div>
        ))}
      </div>
    </div>
  );
}
