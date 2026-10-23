"use client";
import { use, useState } from "react";
import { api, useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import BuildProgress from "@/components/BuildProgress";
import { UploadProgress, Working, attachZip, useUploader } from "@/components/upload";

export default function Deploy({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const ov = useApi<any>(`/api/projects/${name}/overview`);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<any>(null);
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [releaseID, setReleaseID] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const up = useUploader();

  async function pick(f: File) {
    setFile(f); setReport(null); setReleaseID(null); setErr(null); setBusy(true);
    try {
      const id = await up.start(f);
      const fd = new FormData(); fd.append("uploadId", id);
      const r = await api("/api/analyze", { method: "POST", body: fd });
      setReport(r); setPort(String(r.port));
    } catch (e: any) { if (e?.message !== "cancelled") setErr(e); } finally { setBusy(false); }
  }
  async function deploy() {
    if (!file || !ov.data) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); await attachZip(fd, file); fd.append("name", name); fd.append("platform", ov.data.project.type); fd.append("port", port || "3000");
      const r = await api<{ steps: { ok: boolean; step: string; detail?: string }[]; releaseID?: string }>("/api/deploy", { method: "POST", body: fd });
      const bad = r.steps.find((s) => !s.ok);
      if (bad) setErr({ error: `${bad.step}: ${bad.detail ?? ""}` });
      if (r.releaseID) setReleaseID(r.releaseID);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b border-line">
        <span className="inline-block px-4 py-3 border-b-2 border-[#87fcc4] text-brand font-semibold">Drag &amp; Drop</span>
      </div>
      <div>
        <div className="text-sm text-muted">استقرار با استفاده از</div>
        <h1 className="text-2xl font-bold">Drag &amp; Drop</h1>
      </div>

      <div className="rounded-xl border border-[#e99a2755] bg-[#e99a2712] px-4 py-3 text-[15px] leading-7 text-[#f0d9a8]">
        ⚠ در فایل zip، بهتر است که پوشه‌ی <b>node_modules</b> قرار نداشته باشد. لیارا دستور npm install را به صورت خودکار اجرا می‌کند.
      </div>

      {err && <ErrorBox error={err} />}

      <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); e.dataTransfer.files[0] && pick(e.dataTransfer.files[0]); }}
        className={`block rounded-xl border-2 border-dashed text-center cursor-pointer py-16 px-6 transition ${drag ? "border-[#87fcc4aa] bg-[#87fcc412]" : "border-[#ffffff2a] hover:border-[#87fcc466]"}`}>
        <input type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        <div className="text-4xl text-[#ccc] mb-3">⇪</div>
        {file ? <div className="font-bold ltr">{file.name}</div> : <div className="text-[16px]">سورس‌کد خود را در یک فایل .zip قرار داده و در اینجا رها کنید.</div>}
        <span className="btn mt-4">انتخاب کنید</span>
      </label>
      <UploadProgress up={up} />
      {busy && up.st.phase === "done" && !report && <Working label="در حال تحلیل پروژه…" />}
      {busy && report && <Working label="در حال آپلود… ممکن است چند دقیقه طول بکشد" />}

      {report && (
        <div className="space-y-2">
          {report.blockers?.map((b: string, i: number) => <div key={i} className="text-sm rounded-lg bg-bad-soft text-bad px-3 py-2">✗ {b}</div>)}
          {report.warnings?.map((w: string, i: number) => <div key={i} className="text-sm text-warn">⚠ {w}</div>)}
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-[#ccc]">پورت <input className="input ltr w-24" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} /></label>
            <button className="btn btn-primary px-6" disabled={busy || !!report.blockers?.length || !port} onClick={deploy}>{busy ? "در حال ارسال…" : "استقرار"}</button>
          </div>
        </div>
      )}

      {releaseID && <div className="card p-5"><BuildProgress releaseID={releaseID} project={name} /></div>}
    </div>
  );
}
