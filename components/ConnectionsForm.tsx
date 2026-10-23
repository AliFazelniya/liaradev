"use client";
import { useState } from "react";
import { api } from "./api";

const PRESETS = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] },
  { id: "anthropic", name: "Claude", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", models: ["claude-haiku-4-5", "claude-sonnet-4-5"] },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"] },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile"] },
  { id: "ollama", name: "Ollama (محلی)", baseUrl: "http://localhost:11434/v1", model: "llama3.1", models: ["llama3.1", "qwen2.5"] },
];
const FROM: Record<string, string> = { settings: "تنظیمات", env: "فایل env", default: "پیش‌فرض", none: "—" };

function Source({ from }: { from: string }) {
  return <span className={`pill ${from === "settings" ? "pill-ok" : from === "env" ? "pill-muted" : "pill-muted"} text-[11px]`}>{FROM[from] ?? from}</span>;
}

const Msg = ({ m }: { m?: { ok: boolean; text: string } | null }) => (m ? <div className={`rounded-lg px-3 py-2 text-sm ${m.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{m.text}</div> : null);
const Field = ({ label, from, shown, children }: { label: string; from: string; shown: string; children: React.ReactNode }) => (
  <label className="block text-xs text-muted">
    <span className="flex items-center justify-between mb-1"><span>{label}</span><span className="flex items-center gap-2"><span className="ltr text-[#aaa]">{shown || "تنظیم نشده"}</span><Source from={from} /></span></span>
    {children}
  </label>
);

/** Liara + AI-provider connections. A value saved here overrides the environment; clearing it falls back to .env. */
export default function ConnectionsForm({ data, onSaved }: { data: any; onSaved: () => void }) {
  const [li, setLi] = useState({ base: "", token: "", teamID: "" });
  const [ai, setAi] = useState({ label: "", baseUrl: "", model: "", key: "" });
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string } | null>>({});
  const [busy, setBusy] = useState("");
  const [custom, setCustom] = useState(false);
  const put = (patch: any) => api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });

  async function saveLiara() {
    setBusy("li");
    try {
      const patch: any = {};
      if (li.base) patch.liaraBase = li.base; if (li.token) patch.liaraToken = li.token; if (li.teamID) patch.teamID = li.teamID;
      if (!Object.keys(patch).length) { setMsg({ ...msg, li: { ok: false, text: "چیزی برای ذخیره وارد نشده است." } }); return; }
      await put(patch); setLi({ base: "", token: "", teamID: "" }); setMsg({ ...msg, li: { ok: true, text: "ذخیره شد." } }); onSaved();
    } catch (e: any) { setMsg({ ...msg, li: { ok: false, text: e.error ?? "ذخیره ناموفق بود" } }); } finally { setBusy(""); }
  }
  async function saveAi() {
    setBusy("ai");
    try {
      const patch: any = {};
      if (ai.label) patch.aiLabel = ai.label; if (ai.baseUrl) patch.aiBaseUrl = ai.baseUrl; if (ai.model) patch.aiModel = ai.model; if (ai.key) patch.aiKey = ai.key;
      if (!Object.keys(patch).length) { setMsg({ ...msg, ai: { ok: false, text: "چیزی برای ذخیره وارد نشده است." } }); return; }
      await put(patch); setAi({ label: "", baseUrl: "", model: "", key: "" }); setMsg({ ...msg, ai: { ok: true, text: "ذخیره شد." } }); onSaved();
    } catch (e: any) { setMsg({ ...msg, ai: { ok: false, text: e.error ?? "ذخیره ناموفق بود" } }); } finally { setBusy(""); }
  }
  async function reset(kind: "li" | "ai") {
    setBusy(kind);
    try {
      await put(kind === "li" ? { liaraBase: "", liaraToken: "", teamID: "" } : { aiLabel: "", aiBaseUrl: "", aiModel: "", aiKey: "" });
      setMsg({ ...msg, [kind]: { ok: true, text: "مقادیر ذخیره‌شده پاک شد؛ از فایل env استفاده می‌شود." } }); onSaved();
    } catch (e: any) { setMsg({ ...msg, [kind]: { ok: false, text: e.error ?? "ناموفق" } }); } finally { setBusy(""); }
  }
  async function test(target: "li" | "ai") {
    setBusy("t" + target); setMsg({ ...msg, [target]: null });
    try { const r = await api<{ detail: string }>("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: target === "li" ? "liara" : "ai" }) }); setMsg({ ...msg, [target]: { ok: true, text: "✓ " + r.detail } }); }
    catch (e: any) { setMsg({ ...msg, [target]: { ok: false, text: `✗ ${e.error ?? "اتصال ناموفق بود"}${e.hint ? " — " + e.hint : ""}` } }); } finally { setBusy(""); }
  }

  const L = data.liara, A = data.ai;
  const activeProvider = PRESETS.find((p) => p.baseUrl === A.baseUrl);
  // highlighted tile: what the user picked, else what is in use now
  const selected = custom ? "custom" : PRESETS.find((p) => p.baseUrl === (ai.baseUrl || A.baseUrl))?.id ?? "custom";
  return (
    <>
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-bold">اتصال به لیارا</h2><span className={`pill ${L.hasToken ? "pill-ok" : "pill-bad"}`}>{L.hasToken ? "توکن تنظیم شده" : "توکن ندارد"}</span></div>
        <Field label="توکن API" from={L.from.token} shown={L.tokenMasked}><input className="input ltr mt-0" type="password" autoComplete="off" placeholder="توکن جدید" value={li.token} onChange={(e) => setLi({ ...li, token: e.target.value })} /></Field>
        <Field label="Team ID (اختیاری)" from={L.from.teamID} shown={L.teamID}><input className="input ltr" placeholder="Team ID" value={li.teamID} onChange={(e) => setLi({ ...li, teamID: e.target.value })} /></Field>
        <Field label="آدرس API" from={L.from.base} shown={L.base}><input className="input ltr" placeholder="https://api.iran.liara.ir" value={li.base} onChange={(e) => setLi({ ...li, base: e.target.value })} /></Field>
        <Msg m={msg.li} />
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary" disabled={!!busy} onClick={saveLiara}>{busy === "li" ? "…" : "ذخیره"}</button>
          <button className="btn" disabled={!!busy} onClick={() => test("li")}>{busy === "tli" ? "در حال تست…" : "تست اتصال"}</button>
          <button className="btn" disabled={!!busy} onClick={() => reset("li")}>بازگشت به مقدار env</button>
        </div>
      </section>

      <section className="card p-5 space-y-5">
        <h2 className="font-bold">ارائه‌دهنده‌ی هوش مصنوعی</h2>

        {/* what is in use right now (settings value, else env) */}
        <div className={`rounded-xl border p-4 flex items-center justify-between gap-4 flex-wrap ${A.hasKey ? "border-[#87fcc433] bg-[#87fcc40d]" : "border-[#ff706f55] bg-[#ff706f12]"}`}>
          <div className="space-y-1">
            <div className="text-xs text-muted">مدل فعال</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold ltr">{A.model || "—"}</span>
              <span className="pill pill-muted text-[11px]">{A.label || activeProvider?.name || "سفارشی"}</span>
              <Source from={A.from.model} />
            </div>
            <div className="text-xs text-muted ltr">{A.baseUrl}</div>
          </div>
          <div className="text-left space-y-1">
            <span className={`pill ${A.hasKey ? "pill-ok" : "pill-bad"}`}>{A.hasKey ? "کلید تنظیم شده" : "کلید ندارد"}</span>
            {A.hasKey && <div className="text-xs text-muted ltr flex items-center gap-2 justify-end">{A.keyMasked}<Source from={A.from.key} /></div>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">ارائه‌دهنده</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => setAi({ ...ai, label: p.name, baseUrl: p.baseUrl, model: p.model })}
                className={`rounded-xl border px-3 py-3 text-sm text-right transition ${selected === p.id ? "border-brand bg-brand-soft font-semibold" : "border-line hover:border-[#ffffff44]"}`}>
                <div>{p.name}</div>
                <div className="text-[11px] text-muted ltr truncate">{new URL(p.baseUrl).host}</div>
              </button>
            ))}
            <button type="button" onClick={() => { setCustom(true); setAi({ ...ai, label: "", baseUrl: "", model: "" }); }}
              className={`rounded-xl border border-dashed px-3 py-3 text-sm text-right transition ${selected === "custom" ? "border-brand bg-brand-soft font-semibold" : "border-line hover:border-[#ffffff44]"}`}>
              <div>سفارشی</div><div className="text-[11px] text-muted">هر API سازگار با OpenAI</div>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="مدل" from={A.from.model} shown={A.model}>
            <input className="input ltr" list="ai-models" placeholder={A.model || "model id"} value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} />
            <datalist id="ai-models">{(PRESETS.find((p) => p.id === selected)?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label="API key" from={A.from.key} shown={A.keyMasked}><input className="input ltr" type="password" autoComplete="off" placeholder="کلید جدید" value={ai.key} onChange={(e) => setAi({ ...ai, key: e.target.value })} /></Field>
        </div>
        {(selected === "custom" || custom) && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Base URL" from={A.from.baseUrl} shown={A.baseUrl}><input className="input ltr" placeholder="https://…/v1" value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} /></Field>
            <Field label="نام نمایشی" from={A.from.label} shown={A.label}><input className="input ltr" placeholder="My provider" value={ai.label} onChange={(e) => setAi({ ...ai, label: e.target.value })} /></Field>
          </div>
        )}
        <Msg m={msg.ai} />
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary" disabled={!!busy} onClick={saveAi}>{busy === "ai" ? "…" : "ذخیره"}</button>
          <button className="btn" disabled={!!busy} onClick={() => test("ai")}>{busy === "tai" ? "در حال تست…" : "تست اتصال"}</button>
          <button className="btn" disabled={!!busy} onClick={() => reset("ai")}>بازگشت به مقدار env</button>
        </div>
      </section>
    </>
  );
}
