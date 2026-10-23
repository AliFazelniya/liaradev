"use client";
import { use, useState } from "react";
import { api, useApi } from "@/components/api";
import { ErrorBox } from "@/components/ui";
import Confirm from "@/components/Confirm";
import { BUNDLE_NAME, platformLogo } from "@/lib/platforms";
import { jalali } from "@/components/time";
import AiCheck from "@/components/AiCheck";

// the assistant card takes the colour of the latest verdict
const AI_TONE: Record<string, string> = {
  ok: "border-[#87fcc433] from-[#87fcc40d]", warning: "border-[#e99a2766] from-[#e99a2718]",
  critical: "border-[#ff706f77] from-[#ff706f1f]", settling: "border-[#28c1f544] from-[#28c1f512]",
};
const AI_ICON: Record<string, string> = { ok: "text-brand", warning: "text-[#e99a27]", critical: "text-[#ff706f]", settling: "text-[#28c1f5]" };
const faDec = (n: number) => n.toLocaleString("fa-IR", { maximumFractionDigits: 2 }).replace("٫", ".");

function Tile({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[#333] bg-[#23252d] p-3 min-h-[132px] flex flex-col items-center justify-center gap-4 text-center">
      <p className="text-[13px] text-[#808080]">{value}</p>
      <div className="flex items-center gap-2 text-[15px]"><img src={`/assets/icons/${icon}.svg`} alt="" width={22} height={22} />{label}</div>
    </div>
  );
}

export default function Overview({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const { data, error, reload } = useApi<any>(`/api/projects/${name}/overview`, 20000);
  const [confirm, setConfirm] = useState<null | { tool: string; args: any; label: string; body: string }>(null);
  const [busy, setBusy] = useState(false);
  const [sev, setSev] = useState<string | undefined>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(c: NonNullable<typeof confirm>) {
    setBusy(true); setMsg(null);
    try { await api(`/api/projects/${name}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: c.tool, args: c.args }) }); setMsg({ ok: true, text: `${c.label} انجام شد.` }); setTimeout(reload, 1200); }
    catch (e: any) { setMsg({ ok: false, text: `${c.label} ناموفق بود: ${e.error ?? "خطا"}${e.hint ? " — " + e.hint : ""}` }); }
    finally { setBusy(false); setConfirm(null); }
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="text-muted text-center py-20">…</div>;
  const { project: p, plan } = data;
  const running = p.status === "RUNNING";
  const bundleName = BUNDLE_NAME[p.bundlePlanID] ?? p.bundlePlanID;

  return (
    <div className="grid md:grid-cols-[250px_minmax(0,1fr)] gap-6 items-start">
      {/* center column: logo + actions + status */}
      <div className="space-y-4">
        <div className="grid place-items-center py-4"><img src={platformLogo(p.type)} alt={p.type} width={104} height={104} className="object-contain" /></div>
        <div className="rounded-xl border border-[#333] bg-[#23252d] overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-x-reverse divide-[#333]">
            <button className="py-3 flex items-center justify-center gap-2 hover:bg-[#ffffff0d] text-[15px]" onClick={() => setConfirm({ tool: "restart_project", args: {}, label: "ری‌استارت", body: "برنامه چند ثانیه در دسترس نخواهد بود." })}>↻ ری‌استارت</button>
            <button className="py-3 flex items-center justify-center gap-2 hover:bg-[#ffffff0d] text-[15px]" onClick={() => setConfirm({ tool: "turn_project", args: { on: !running }, label: running ? "خاموش‌کردن" : "روشن‌کردن", body: running ? "سایت کاملاً از دسترس خارج می‌شود." : "برنامه دوباره راه‌اندازی می‌شود." })}>⏻ {running ? "خاموش‌کردن" : "روشن‌کردن"}</button>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#333]">
            <span className="text-[#ccc] text-[15px]">وضعیت</span>
            <span className={`rounded-md border px-3 py-0.5 text-sm ${running ? "border-[#57b36a66] text-[#57b36a] bg-[#57b36a12]" : "border-[#ff706f66] text-[#ff706f] bg-[#ff706f12]"}`}>{running ? (p.isDeployed ? "روشن" : "آماده به کار") : "خاموش"}</span>
          </div>
        </div>
        {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{msg.text}</div>}
      </div>

      {/* left column: url, resources, plan list */}
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="rounded-full border border-line px-3 py-1 text-xs text-[#ccc]">پیش‌فرض</span>
          <a href={`https://${p.project_id}.liara.run`} target="_blank" rel="noreferrer" className="text-[15px] ltr hover:underline">🌐 https://{p.project_id}.liara.run ↗</a>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Tile icon="cpu" value={`${plan ? faDec(plan.cpu) : "—"} هسته`} label="CPU" />
          <Tile icon="disks" value={`${plan ? faDec(plan.volume) : "—"} گیگابایت`} label="DISK" />
          <Tile icon="ram" value={`${plan ? faDec(plan.ramGB) : "—"} گیگابایت`} label="RAM" />
        </div>
        <div className={`rounded-xl border bg-gradient-to-l to-transparent p-5 transition-colors ${AI_TONE[sev ?? "ok"] ?? AI_TONE.ok}`}>
          <div className="flex items-center gap-2 font-bold mb-3"><span className={AI_ICON[sev ?? "ok"] ?? "text-brand"}>✦</span> دستیار هوشمند</div>
          <AiCheck name={name} compact onDone={() => setTimeout(reload, 4000)} onSeverity={setSev} />
        </div>
        <div className="rounded-xl border border-[#333] bg-[#23252d] divide-y divide-[#333]">
          {[
            ["پلن منابع", plan?.name ?? p.planID, null],
            ["هزینه منابع", p.hourlyPrice !== undefined ? `${faDec(p.hourlyPrice)} تومان` : "—", "ساعتی"],
            ["پلن بسته امکانات", bundleName ?? "—", null],
            ["هزینه بسته امکانات", p.bundleHourlyPrice !== undefined ? `${faDec(p.bundleHourlyPrice)} تومان` : "—", "ساعتی"],
          ].map(([k, v, tag]) => (
            <div key={k as string} className="flex items-center justify-between px-5 py-4 text-[15px]">
              <span className="text-[#ccc]">{k}</span>
              <span className="flex items-center gap-2">{tag && <span className="rounded border border-[#fff] px-1.5 text-xs">{tag}</span>}{v}</span>
            </div>
          ))}
          <div className="px-5 py-4 text-[15px]">
            <div className="text-[#ccc]">شبکه خصوصی</div>
            <div className="mt-1 flex items-center justify-between"><span className="ltr">{p.network?.name ?? "—"}</span><span className="text-xs text-muted">ایجاد شده در {jalali(p.created_at)}</span></div>
          </div>
        </div>
      </div>

      {confirm && <Confirm title={`تأیید «${confirm.label}»؟`} body={confirm.body} busy={busy} onYes={() => run(confirm)} onNo={() => setConfirm(null)} />}
    </div>
  );
}
