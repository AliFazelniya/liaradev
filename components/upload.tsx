"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const CHUNK = 2 * 1024 * 1024;
const ids = new WeakMap<File, string>(); // finished uploads, so a file is sent once per session

export interface UpState { phase: "idle" | "uploading" | "paused" | "done" | "error"; loaded: number; total: number; speed: number; error?: string }

const sendChunk = (url: string, body: Blob, holder: { xhr: XMLHttpRequest | null }, onBytes: (n: number) => void) =>
  new Promise<{ received: number; resync?: boolean }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    holder.xhr = x;
    x.open("PUT", url);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => {
      try {
        const j = JSON.parse(x.responseText);
        x.status < 300 ? resolve(j) : reject(new Error(j.error ?? `HTTP ${x.status}`));
      } catch { reject(new Error(`HTTP ${x.status}`)); }
    };
    x.onerror = () => reject(new Error("network"));
    x.onabort = () => reject(new Error("aborted"));
    x.send(body);
  });

/** Chunked, resumable upload with pause/resume. A dropped connection is retried from the server's byte count. */
export function useUploader() {
  const [st, setSt] = useState<UpState>({ phase: "idle", loaded: 0, total: 0, speed: 0 });
  const ctl = useRef({ paused: false, cancelled: false, xhr: null as XMLHttpRequest | null, wake: null as null | (() => void) });

  const start = useCallback(async (file: File): Promise<string> => {
    const cached = ids.get(file);
    if (cached) { setSt({ phase: "done", loaded: file.size, total: file.size, speed: 0 }); return cached; }
    const c = ctl.current;
    c.paused = false; c.cancelled = false;
    const total = file.size;
    setSt({ phase: "uploading", loaded: 0, total, speed: 0 });
    try {
      const init = await fetch("/api/upload", { method: "POST" });
      const ij = await init.json();
      if (!init.ok) throw new Error(ij.error ?? "upload init failed");
      const id: string = ij.id;
      let offset = 0, fails = 0;
      let t0 = Date.now(), b0 = 0, speed = 0;
      while (offset < total) {
        if (c.cancelled) throw new Error("cancelled");
        if (c.paused) {
          setSt((s) => ({ ...s, phase: "paused", speed: 0 }));
          await new Promise<void>((r) => (c.wake = r));
          c.wake = null;
          if (c.cancelled) throw new Error("cancelled");
          // the server knows how much it really has (an aborted chunk may or may not have landed)
          offset = (await (await fetch(`/api/upload/${id}`)).json()).received;
          t0 = Date.now(); b0 = offset;
          setSt((s) => ({ ...s, phase: "uploading", loaded: offset }));
          continue;
        }
        const end = Math.min(offset + CHUNK, total);
        try {
          const r = await sendChunk(`/api/upload/${id}?offset=${offset}`, file.slice(offset, end), c, (n) => {
            const loaded = offset + n, dt = (Date.now() - t0) / 1000;
            if (dt > 0.4) { speed = (loaded - b0) / dt; }
            setSt({ phase: "uploading", loaded, total, speed });
          });
          offset = r.received; fails = 0;
        } catch (e: any) {
          if (e.message === "aborted") continue; // paused or cancelled: handled at the loop top
          if (++fails > 6) throw e;
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** fails, 8000)));
          offset = (await fetch(`/api/upload/${id}`).then((r) => r.json()).catch(() => ({ received: offset }))).received;
        }
      }
      ids.set(file, id);
      setSt({ phase: "done", loaded: total, total, speed: 0 });
      return id;
    } catch (e: any) {
      setSt((s) => ({ ...s, phase: "error", error: e.message === "cancelled" ? "آپلود لغو شد" : e.message }));
      throw e;
    }
  }, []);

  const pause = () => { ctl.current.paused = true; ctl.current.xhr?.abort(); };
  const resume = () => { ctl.current.paused = false; ctl.current.wake?.(); };
  const cancel = () => { ctl.current.cancelled = true; ctl.current.xhr?.abort(); ctl.current.wake?.(); };
  return { st, start, pause, resume, cancel };
}

/** Adds the zip to a form: by upload id when it was uploaded already, otherwise uploads it first (no UI). */
export async function attachZip(fd: FormData, file: File) {
  let id = ids.get(file);
  if (!id) {
    const ij = await (await fetch("/api/upload", { method: "POST" })).json();
    id = ij.id as string;
    for (let off = 0; off < file.size; off += CHUNK) {
      const r = await fetch(`/api/upload/${id}?offset=${off}`, { method: "PUT", body: file.slice(off, off + CHUNK) });
      if (!r.ok) throw new Error((await r.json()).error ?? "upload failed");
    }
    ids.set(file, id);
  }
  fd.append("uploadId", id);
}

const mb = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024)).toLocaleString("fa-IR")} کیلوبایت` : `${(n / 1048576).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`);

export function UploadProgress({ up }: { up: ReturnType<typeof useUploader> }) {
  const { st } = up;
  if (st.phase === "idle") return null;
  const pct = st.total ? Math.min(100, Math.round((st.loaded / st.total) * 100)) : 0;
  const eta = st.speed > 0 ? Math.ceil((st.total - st.loaded) / st.speed) : 0;
  return (
    <div className="rounded-xl border border-[#333] bg-[#23252d] p-4 space-y-2 text-sm" onClick={(e) => e.preventDefault()}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[#ccc]">
          {st.phase === "uploading" && "در حال آپلود…"}{st.phase === "paused" && "متوقف شد"}{st.phase === "done" && "آپلود کامل شد"}{st.phase === "error" && <span className="text-bad">{st.error}</span>}
        </span>
        <span className="flex gap-2">
          {st.phase === "uploading" && <button type="button" className="btn" onClick={up.pause}>⏸ توقف</button>}
          {st.phase === "paused" && <button type="button" className="btn btn-primary" onClick={up.resume}>▶ ادامه</button>}
          {(st.phase === "uploading" || st.phase === "paused") && <button type="button" className="btn" onClick={up.cancel}>لغو</button>}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[#ffffff14] overflow-hidden"><div className={`h-full transition-all ${st.phase === "paused" ? "bg-[#e99a27]" : st.phase === "error" ? "bg-[#ff706f]" : "bg-[#87fcc4]"}`} style={{ width: `${pct}%` }} /></div>
      <div className="flex justify-between text-xs text-muted">
        <span>{pct.toLocaleString("fa-IR")}٪ · {mb(st.loaded)} از {mb(st.total)}</span>
        {st.phase === "uploading" && st.speed > 0 && <span>{mb(st.speed)} بر ثانیه · {eta.toLocaleString("fa-IR")} ثانیه مانده</span>}
      </div>
    </div>
  );
}

/** "Something is happening" row for a long server-side step: spinner, label and elapsed seconds. */
export function Working({ label }: { label: string }) {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const s = Math.floor((now - t0) / 1000);
  return (
    <div className="text-sm rounded-lg px-3 py-2 bg-[#ffffff0a] text-[#ccc] flex items-center gap-3">
      <span className="inline-block w-4 h-4 rounded-full border-2 border-[#87fcc4] border-t-transparent animate-spin" />
      <span>{label}</span>
      <span className="text-muted text-xs ms-auto">{s.toLocaleString("fa-IR")} ثانیه</span>
    </div>
  );
}
