import { getState } from "../store";

/** What was actually done to an app (from the persistent audit log), so later checks and the AI can build on it. */
export interface HistoryEntry {
  at: string;
  tool: string;
  by: string; // who ran it: user (incl. approved proposals), scheduler, ai, mcp
  summary: string;
  result?: string;
  verification?: string;
}

const MUTATING = ["change_plan", "restart_project", "turn_project", "update_port", "rollback_release", "fix_dependencies", "fix_code", "update_envs", "set_flag"];

const label = (tool: string, a: any, msg: string): string => {
  switch (tool) {
    case "change_plan": return /^plan \S+ → /.test(msg) ? `تغییر پلن (${msg.slice(5)})` : `تغییر پلن به ${a.planID}`;
    case "restart_project": return "ری‌استارت برنامه";
    case "turn_project": return a.on ? "روشن کردن برنامه" : "خاموش کردن برنامه";
    case "update_port": return `تغییر پورت به ${a.port}`;
    case "rollback_release": return "بازگشت به نسخه‌ی قبلی";
    case "fix_dependencies": return "اصلاح وابستگی‌ها و استقرار مجدد";
    case "fix_code": return "رفع خطای کد با هوش مصنوعی و استقرار مجدد";
    case "update_envs": return `ثبت متغیرهای محیطی (${(a.variables ?? []).map((v: any) => v.key).join("، ")})`;
    case "set_flag": return `تغییر تنظیم ${a.flag ?? ""}`;
    default: return tool;
  }
};

/** Newest first. Only executed, successful changes (proposals and rejections are not history). */
/** `createdAt`: ignore anything before the app was created (a deleted app with the same name must not leak its past). */
export function projectHistory(project: string, days = 14, createdAt?: string): HistoryEntry[] {
  const st = getState();
  const since = Math.max(Date.now() - days * 86_400_000, createdAt ? Date.parse(createdAt) || 0 : 0);
  return [...st.audit].reverse()
    .filter((e) => e.ok && MUTATING.includes(e.tool) && (e.args as any)?.name === project && Date.parse(e.at) >= since && !/^proposed|^rejected/.test(e.message))
    .map((e) => {
      const ap = st.approvals.find((a) => a.status === "approved" && a.tool === e.tool && (a.args as any)?.name === project && a.resolvedAt && Math.abs(Date.parse(a.resolvedAt) - Date.parse(e.at)) < 120_000);
      return { at: e.at, tool: e.tool, by: e.actor, summary: label(e.tool, e.args, e.message), result: e.message, verification: ap?.verification };
    });
}
