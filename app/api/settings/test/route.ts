import { z } from "zod";
import { handle } from "@/lib/api";
import { callLLM } from "@/lib/ai/llm";
import { liara } from "@/lib/liara";

export const maxDuration = 60;
const Body = z.object({ target: z.enum(["ai", "liara"]) });

/** "Test connection" buttons: one real, tiny request with the credentials currently in effect. */
export const POST = (req: Request) =>
  handle(async () => {
    const { target } = Body.parse(await req.json());
    if (target === "liara") {
      const me = await liara().getMe();
      return { ok: true, detail: `متصل شد${(me as any)?.fullname || (me as any)?.email ? ` — ${(me as any).fullname ?? (me as any).email}` : ""}` };
    }
    const t = Date.now();
    const { message } = await callLLM({ messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 5 }, { source: "chat", note: "connection test" });
    return { ok: true, detail: `پاسخ دریافت شد (${Date.now() - t}ms): ${String(message.content ?? "").slice(0, 40)}` };
  });
