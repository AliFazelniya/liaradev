import fs from "node:fs";
import path from "node:path";

/**
 * Resumable uploads: the browser sends the zip in chunks, which are appended to a file under .data/uploads.
 * The limit is ours, not Liara's — the zip is unpacked in memory for analysis, so it caps what the server holds.
 */
export const MAX_UPLOAD = 300 * 1024 * 1024;
const DIR = path.join(process.cwd(), ".data", "uploads");
const ID = /^[a-f0-9]{16}$/;
const file = (id: string) => {
  if (!ID.test(id)) throw Object.assign(new Error("شناسه‌ی آپلود نامعتبر است"), { status: 400 });
  return path.join(DIR, id + ".part");
};

export function createUpload(): string {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) { // drop abandoned uploads
    const p = path.join(DIR, f);
    if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600_000) fs.rmSync(p, { force: true });
  }
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  fs.writeFileSync(file(id), "");
  return id;
}

export const uploadSize = (id: string) => { try { return fs.statSync(file(id)).size; } catch { return -1; } };

export function appendChunk(id: string, offset: number, data: Uint8Array): number {
  const have = uploadSize(id);
  if (have < 0) throw Object.assign(new Error("آپلود پیدا نشد؛ دوباره شروع کنید."), { status: 404 });
  if (offset !== have) throw Object.assign(new Error("offset mismatch"), { status: 409, received: have });
  if (have + data.length > MAX_UPLOAD) throw Object.assign(new Error(`حداکثر حجم ${Math.round(MAX_UPLOAD / 1048576)}MB`), { status: 413 });
  fs.appendFileSync(file(id), data);
  return have + data.length;
}

/** The zip of a request: a finished chunked upload (`uploadId`) or a plain `file` field. */
export async function zipFromForm(fd: FormData): Promise<Uint8Array> {
  const id = fd.get("uploadId");
  if (typeof id === "string" && id) {
    if (uploadSize(id) < 0) throw Object.assign(new Error("فایل آپلودشده پیدا نشد؛ دوباره آپلود کنید."), { status: 404 });
    return new Uint8Array(fs.readFileSync(file(id)));
  }
  const f = fd.get("file");
  if (!(f instanceof File)) throw Object.assign(new Error("فایل zip ارسال نشده"), { status: 400 });
  if (f.size > MAX_UPLOAD) throw Object.assign(new Error(`حداکثر حجم ${Math.round(MAX_UPLOAD / 1048576)}MB`), { status: 413 });
  return new Uint8Array(await f.arrayBuffer());
}
