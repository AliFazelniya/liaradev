import { NextResponse } from "next/server";
import { LiaraError } from "./liara/types";
import { ensureScheduler } from "./monitor/scheduler";
import { getState } from "./store";

export function boot() {
  getState();
  ensureScheduler();
}

/** Wrap a handler: normalize errors so the UI can always show a readable message + the Liara status. */
export async function handle(fn: () => Promise<unknown>) {
  try {
    boot();
    return NextResponse.json(await fn());
  } catch (e: any) {
    const status = e instanceof LiaraError ? e.status : (e?.status ?? 500);
    const hint =
      status === 401 ? "توکن لیارا نامعتبر یا منقضی است." :
      status === 402 || /credit|balance|اعتبار/i.test(e?.message ?? "") ? "اعتبار حساب لیارا کافی نیست." :
      status === 404 ? "منبع در لیارا پیدا نشد." : undefined;
    return NextResponse.json({ error: e?.message ?? "خطای ناشناخته", status, hint, source: e instanceof LiaraError ? "liara" : "app" }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
