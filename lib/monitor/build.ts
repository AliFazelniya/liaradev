import type { BuildInfo } from "../liara";

export const TERMINAL = ["READY", "FAILED", "UNHEALTHY", "CANCELED", "TIMEDOUT"];

export type Phase = "queued" | "building" | "pushing" | "deploying" | "ready" | "failed";

export interface BuildAnalysis {
  phase: Phase;
  done: boolean;
  ok: boolean;
  label: string; // Persian status
  hint?: string; // what likely went wrong + what to do
  lastStep?: string;
}

/** Turn Liara's release state + build output into something a non-technical user can act on. */
export function analyzeBuild(b: BuildInfo): BuildAnalysis {
  const last = [...b.lines].reverse().find((l) => /^>|^Step|npm|pip|composer|error/i.test(l.line))?.line;
  const errLines = b.lines.filter((l) => l.stream !== "STDOUT").map((l) => l.line);
  const lastStep = last?.replace(/^>\s*/, "");
  const sawPush = b.lines.some((l) => /^Pushing/i.test(l.line) || /^Successfully tagged/i.test(l.line));

  switch (b.state) {
    case "READY":
      return { phase: "ready", done: true, ok: true, label: "دیپلوی با موفقیت انجام شد" };
    case "UNHEALTHY":
      return { phase: "failed", done: true, ok: false, label: "دیپلوی شد اما برنامه سالم بالا نیامد", hint: "معمولاً برنامه روی پورتی که هنگام دیپلوی دادید گوش نمی‌دهد یا بلافاصله کرش می‌کند. پورت را با process.env.PORT بخوانید و لاگ برنامه را ببینید." };
    case "CANCELED":
      return { phase: "failed", done: true, ok: false, label: "ساخت لغو شد" };
    case "TIMEDOUT":
      return { phase: "failed", done: true, ok: false, label: "ساخت از زمان مجاز (۵ دقیقه) بیشتر شد", hint: "نصب وابستگی‌ها یا مرحله build خیلی طول کشیده. پکیج‌های غیرضروری را حذف کنید یا build را سبک‌تر کنید." };
    case "FAILED": {
      let hint = b.failReason ?? undefined;
      if (!hint) {
        if (errLines.length) hint = `خطای ساخت: ${errLines[errLines.length - 1].slice(0, 200)}`;
        else if (/npm install|pip install|composer/i.test(last ?? "")) hint = "ساخت هنگام نصب وابستگی‌ها شکست خورد؛ معمولاً یک پکیج در package.json/requirements.txt وجود ندارد، نسخه‌اش اشتباه است یا نصب آن خطا می‌دهد. فایل وابستگی‌ها را بررسی کنید.";
        else if (/build/i.test(last ?? "")) hint = "دستور build در پروژه خطا داد. آن را روی سیستم خودتان اجرا کنید تا خطا را ببینید.";
        else if (sawPush) hint = "ساخت تمام شد اما راه‌اندازی برنامه شکست خورد؛ لاگ برنامه را بررسی کنید.";
        else hint = "ساخت ناموفق بود و لیارا دلیل دقیقی اعلام نکرد (API فقط وضعیت FAILED را برمی‌گرداند).";
      }
      return { phase: "failed", done: true, ok: false, label: "ساخت یا دیپلوی ناموفق بود", hint, lastStep };
    }
    case "DEPLOYING":
      return { phase: "deploying", done: false, ok: false, label: "در حال راه‌اندازی برنامه…", lastStep };
    default: {
      if (b.queue) return { phase: "queued", done: false, ok: false, label: `در صف ساخت (${b.queue} نفر جلوتر)` };
      if (/^Pushing/i.test(b.lines[b.lines.length - 1]?.line ?? "") || /^Successfully tagged/i.test(b.lines[b.lines.length - 1]?.line ?? ""))
        return { phase: "pushing", done: false, ok: false, label: "ارسال ایمیج ساخته‌شده…", lastStep };
      return { phase: "building", done: false, ok: false, label: lastStep ? `در حال ساخت: ${lastStep}` : "در حال ساخت…", lastStep };
    }
  }
}
