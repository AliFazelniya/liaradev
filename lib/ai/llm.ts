import { aiConfig, recordUsage, type UsageEntry } from "../store";

export interface LlmResult {
  message: any;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
}

export const aiConfigured = () => !!aiConfig().key;

/**
 * One chat-completions call to the configured provider (any OpenAI-compatible endpoint:
 * base URL, model and key all come from Settings). Every call is logged with tokens + estimated cost.
 */
export async function callLLM(
  body: Record<string, unknown>,
  ctx: { source: UsageEntry["source"]; note?: string },
): Promise<LlmResult> {
  const { key: aiKey, model: aiModel, baseUrl: aiBaseUrl, label: aiLabel } = aiConfig();
  if (!aiKey) throw new Error("NO_KEY");
  const started = Date.now();
  const res = await fetch(`${aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
    body: JSON.stringify({ model: aiModel, temperature: 0.2, ...body }),
    signal: AbortSignal.timeout(90_000),
  }).catch((e: any) => {
    // "fetch failed" tells nobody anything: name the endpoint that could not be reached
    const host = (() => { try { return new URL(aiBaseUrl).host; } catch { return aiBaseUrl; } })();
    throw new Error(e?.name === "TimeoutError" ? `پاسخی از ${host} نیامد (timeout)` : `اتصال به ${host} برقرار نشد؛ آدرس (Base URL) و شبکه را بررسی کنید`);
  });
  if (!res.ok) throw new Error(`${aiLabel || "AI"} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const u = json.usage ?? {};
  recordUsage({
    source: ctx.source, provider: aiLabel || new URL(aiBaseUrl).host, model: json.model ?? aiModel, note: ctx.note, ms: Date.now() - started,
    promptTokens: u.prompt_tokens ?? 0,
    cacheHitTokens: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
  });
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error("پاسخ خالی از ارائه‌دهنده‌ی هوش مصنوعی");
  return { message, usage: u };
}
