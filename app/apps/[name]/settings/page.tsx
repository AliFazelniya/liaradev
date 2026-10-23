"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import Toggle from "@/components/Toggle";
import Confirm from "@/components/Confirm";

type Env = { key: string; value: string };

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-5 border-b border-[#ffffff11]">
      <div className="space-y-1"><div className="text-[17px] font-bold">{title}</div>{desc && <div className="text-sm text-[#bbb] leading-7">{desc}</div>}</div>
      <div className="shrink-0 pt-1">{children}</div>
    </div>
  );
}

export default function Settings({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const router = useRouter();
  const { data, error, reload } = useApi<any>(`/api/projects/${name}/overview`);
  const envs = useApi<{ envs: Env[] }>(`/api/projects/${name}/envs`);
  const [port, setPort] = useState("");
  const [list, setList] = useState<Env[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [del, setDel] = useState(false);
  const [delName, setDelName] = useState("");
  const [reveal, setReveal] = useState<Record<number, boolean>>({});
  useEffect(() => { if (envs.data) setList(envs.data.envs); }, [envs.data]);
  useEffect(() => { if (data) { const e = data.project.envs?.find((x: any) => x.key === "PORT"); setPort(String(e?.value ?? "")); } }, [data]);

  const act = async (label: string, tool: string, args: any, after?: () => void) => {
    setBusy(label); setMsg(null);
    try { await api(`/api/projects/${name}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) }); setMsg({ ok: true, text: `${label} انجام شد.` }); after?.(); setTimeout(() => { reload(); envs.reload(); }, 1200); }
    catch (e: any) { setMsg({ ok: false, text: `${label} ناموفق بود: ${e.error ?? "خطا"}${e.hint ? " — " + e.hint : ""}` }); } finally { setBusy(null); }
  };

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  const p = data.project;
  const flag = (f: "fixed-ip" | "read-only" | "default-subdomain" | "zero-downtime", on: boolean, label: string) => act(label, "set_flag", { flag: f, on });
  const secret = (k: string) => /pass|secret|token|key|auth|dsn|url/i.test(k);

  return (
    <div className="max-w-3xl">
      {msg && <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{msg.text}</div>}

      <Row title="فعال‌کردن آی‌پی ثابت"><Toggle on={!!p.fixedIPStatus && p.fixedIPStatus !== "DISABLED"} disabled={!!busy} onChange={(v) => flag("fixed-ip", v, "آی‌پی ثابت")} /></Row>
      <Row title="فایل‌سیستم Read Only"><Toggle on={!!p.readOnlyRootFilesystem} disabled={!!busy} onChange={(v) => flag("read-only", v, "فایل‌سیستم Read Only")} /></Row>
      <Row title="زیردامنه‌ی پیش‌فرض"><Toggle on={!!p.defaultSubdomain} disabled={!!busy} onChange={(v) => flag("default-subdomain", v, "زیردامنه‌ی پیش‌فرض")} /></Row>
      <Row title="استقرار بدون اختلال"><Toggle on={!!p.zeroDowntime} disabled={!!busy} onChange={(v) => flag("zero-downtime", v, "استقرار بدون اختلال")} /></Row>

      <Row title="پورت برنامه">
        <div className="flex gap-2"><input className="input ltr w-28" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} /><button className="btn" disabled={!port || !!busy} onClick={() => act("تغییر پورت", "update_port", { port: Number(port) })}>بروزرسانی</button></div>
      </Row>

      <div className="py-5 space-y-4">
        <div className="text-[17px] font-bold">متغیرها</div>
        <div className="rounded-xl bg-[#23252d] divide-y divide-[#ffffff11] ltr">
          {list.map((e, i) => (
            <div key={i} className="flex gap-2 p-3 items-center">
              <input className="input w-1/3" placeholder="KEY" value={e.key} onChange={(ev) => setList(list.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x)))} />
              <input className="input flex-1" type={secret(e.key) && !reveal[i] ? "password" : "text"} placeholder="value" value={e.value} onChange={(ev) => setList(list.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))} />
              {secret(e.key) && <button className="btn" onClick={() => setReveal({ ...reveal, [i]: !reveal[i] })}>{reveal[i] ? "🙈" : "👁"}</button>}
              <button className="btn" onClick={() => setList(list.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {list.length === 0 && <div className="p-5 text-center text-muted">متغیری تعریف نشده.</div>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn" onClick={() => setList([...list, { key: "", value: "" }])}>＋ افزودن متغیر جدید</button>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => act("ثبت متغیرها", "update_envs", { variables: list.filter((e) => e.key.trim()) })}>ثبت تغییرات</button>
        </div>
      </div>

      <div className="pt-4"><button className="btn btn-danger" onClick={() => setDel(true)}>حذف برنامه</button></div>

      {del && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center z-[60] p-4">
          <div className="card p-6 max-w-md w-full space-y-4">
            <h3 className="font-bold text-lg">حذف برنامه</h3>
            <p className="text-[#ddd] leading-7">این کار برگشت‌پذیر نیست. برای تأیید، نام برنامه (<b className="ltr inline-block">{name}</b>) را بنویسید.</p>
            <input className="input ltr" value={delName} onChange={(e) => setDelName(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button className="btn" onClick={() => setDel(false)}>انصراف</button>
              <button className="btn btn-danger" disabled={delName !== name || !!busy} onClick={() => act("حذف برنامه", "delete_project", {}, () => router.push("/apps"))}>حذف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
