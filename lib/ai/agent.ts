import { TOOLS, execute, tool, type ToolOutcome } from "./tools";
import { getState } from "../store";
import { aiConfigured, callLLM } from "./llm";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool: string;
  args: unknown;
  title: string;
  outcome: "done" | "pending_approval" | "error";
  approvalId?: string;
  impact?: string;
  error?: string;
}

const MODE_TEXT = {
  assistant: "حالت «دستیار»: هر تغییری (حتی کم‌ریسک) فقط به‌صورت پیشنهاد ثبت می‌شود و کاربر باید تأیید کند.",
  autopilot: "حالت «خلبان خودکار»: تغییرات کم‌ریسک (مثل env) خودکار انجام می‌شود؛ ری‌استارت، تغییر پلن، خاموش/حذف نیاز به تأیید دارد.",
  auto: "حالت «کاملاً خودکار برای مبتدی‌ها»: ساخت پروژه، ری‌استارت و تغییرات کم‌ریسک خودکار انجام می‌شود؛ اما تغییر پلن (هزینه)، خاموش کردن و حذف همیشه تأیید می‌خواهد.",
} as const;

function system(): string {
  const { mode } = getState().settings;
  return `تو «لیارا‌پایلوت» هستی؛ همکار فنی DevOps برای صاحبان وب‌سایت روی پلتفرم لیارا. همیشه فارسی، ساده و کوتاه جواب بده؛ فرض کن کاربر دانش فنی کمی دارد.
${MODE_TEXT[mode]}

قوانین:
- قبل از هر ادعایی درباره مشکل، با ابزارها شواهد جمع کن (diagnose_project اول از همه؛ سپس get_logs/get_metrics در صورت نیاز). حدس بدون شواهد نزن.
- برای مشکل، علت‌ها را به ترتیب احتمال و با شاهد بگو، بعد راه‌حل پیشنهاد بده.
- diagnose_project فیلد history دارد: اقدام‌هایی که قبلاً روی این برنامه انجام شده (ارتقای پلن، ری‌استارت، اصلاح کد…). همیشه آن را بخوان: اگر مشکل بعد از یک اقدام ادامه دارد صریحاً بگو و همان اقدام را دوباره پیشنهاد نکن؛ علت دیگری (مثلاً کد) را بررسی کن.
- خروجی diagnose_project هر اقدام را با kind مشخص کرده: «fix» راه‌حل اصلی است و «workaround» فقط موقت. همیشه اول fix را بگو و workaround را صریحاً «موقت» معرفی کن. اگر علت نشت حافظه یا خطای کد است، ری‌استارت یا ارتقای پلن را راه‌حل اصلی معرفی نکن و بگو چرا حل نمی‌کند.
- اگر خطای کد (code-error) هست، همان خط خطا را عیناً نقل کن تا کاربر بتواند در کد پیدا کند. اگر مشکل پیکربندی است (مثلاً نبود متغیر دیتابیس)، نام متغیر لازم را بگو، نه مقدارش را.
- هزینه‌ی ارتقا را فقط به‌صورت «چقدر در ماه بیشتر می‌شود» بگو (عددی که ابزار داده) و اگر کاربر نپرسیده سراغ پلن گران‌تر نرو.
- اگر شواهد کافی نیست (مثلاً لاگ خالی)، صریح بگو چه چیزی کم است؛ حدس را حقیقت جلوه نده.
- برای انتخاب پلن اول بپرس: چند بازدیدکننده در روز، آیا دیتابیس دارد، بودجه ماهانه. سپس recommend_plan را صدا بزن. هرگز گران‌ترین پلن را پیشنهاد نده؛ ارزان‌ترین پلنی که کافی باشد، و بگو بعداً می‌شود ارتقا داد.
- اگر ابزاری وضعیت pending_approval برگرداند یعنی اقدام هنوز اجرا نشده و منتظر تأیید کاربر است؛ این را روشن به کاربر بگو و ادعا نکن انجام شده. زیر پیام تو خودکار یک کارت با دکمه‌های «تأیید و اجرا» و «رد» نمایش داده می‌شود؛ به کاربر بگو روی همان دکمه بزند (تایپ «تأیید» در چت اثری ندارد).
- از مارک‌داون (مثل ** یا #) استفاده نکن؛ متن ساده و کوتاه بنویس.
- قیمت پلن‌ها در API «تومان در ساعت» است (ماهانه ≈ ۷۲۰ برابر). ابزارها فیلد monthlyPrice می‌دهند؛ همان را بگو. فقط پلن‌های available=true قابل خرید هستند.
- اگر ابزار خطا داد، خطا را عیناً و ساده به کاربر بگو. اگر داده‌ای از API لیارا در دسترس نیست (مثلاً زمان پاسخ هر درخواست)، محدودیت را صریح اعلام کن.
- مقادیر محرمانه (رمز، توکن) را هرگز نخواه و نشان نده.
- امکانات مربوط به ثبت دامنه (ایرنیک/DNS) از طریق API ممکن نیست؛ مراحل را به‌صورت راهنمای دستی بده.`;
}

const toolSpecs = () =>
  TOOLS.filter((t) => t.name !== "advice").map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: `${t.description} [ریسک: ${t.risk}]`, parameters: t.parameters },
  }));

export async function runAgent(history: ChatMessage[], app?: string): Promise<{ reply: string; steps: AgentStep[] }> {
  if (!aiConfigured()) {
    return { reply: "ارائه‌دهنده‌ی هوش مصنوعی هنوز در بخش «تنظیمات» تنظیم نشده است. بدون آن چت هوشمند کار نمی‌کند، اما عیب‌یابی خودکار از صفحه پروژه همچنان کار می‌کند.", steps: [] };
  }
  const messages: any[] = [{ role: "system", content: system() + (app ? `\n\nکاربر الان صفحه‌ی برنامه «${app}» را می‌بیند؛ اگر نام برنامه را نگفت، منظورش همین برنامه است.` : "") }, ...history.slice(-20)];
  const steps: AgentStep[] = [];

  for (let i = 0; i < 8; i++) {
    const { message: msg } = await callLLM({ messages, tools: toolSpecs() }, { source: "chat", note: `turn ${i + 1}` });
    messages.push(msg);
    if (!msg.tool_calls?.length) return { reply: msg.content ?? "", steps };

    for (const call of msg.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* keep {} */ }
      const t = tool(call.function.name);
      const out: ToolOutcome = await execute(call.function.name, args, { actor: "ai", source: "chat", reason: String(msg.content ?? "").slice(0, 300) });
      steps.push({
        tool: call.function.name, args, title: t?.title(args) ?? call.function.name,
        outcome: out.status,
        approvalId: out.status === "pending_approval" ? out.approvalId : undefined,
        impact: out.status === "pending_approval" ? out.impact : undefined,
        error: out.status === "error" ? out.error : undefined,
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out).slice(0, 12_000) });
    }
  }
  return { reply: "به سقف تعداد مراحل رسیدم؛ لطفاً سؤال را کوچک‌تر یا دقیق‌تر بپرسید.", steps };
}
