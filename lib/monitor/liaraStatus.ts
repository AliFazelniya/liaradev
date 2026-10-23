/** Liara's public status page (https://liara.online) is a PocketBase app; its API is open for reading. */
const API = "https://api.liara.online/api/collections";

export interface LiaraService { id: string; name: string; operational: boolean; status: string }
export interface LiaraIncident { id: string; title: string; status: string; impact: string; startedAt: string; services: string[]; ageHours: number }
export interface LiaraStatus {
  checkedAt: string;
  services: LiaraService[];
  incidents: LiaraIncident[]; // unresolved only
  /** services an app depends on (PaaS always) that are down or have a recent unresolved incident */
  affecting: { service: string; reason: string }[];
  error?: string;
}

const RECENT_HOURS = 48; // an incident left "investigating" for weeks is stale, not a live outage
let cache: { at: number; v: LiaraStatus } | null = null;
let lastGood: LiaraStatus | null = null; // the status page is slow/unreachable at times: keep showing the last real answer

const list = async (name: string, qs: string) => {
  const res = await fetch(`${API}/${name}/records?perPage=100&${qs}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`status page ${res.status}`);
  return (await res.json()).items as any[];
};

export async function getLiaraStatus(relevant = ["PaaS"]): Promise<LiaraStatus> {
  if (cache && Date.now() - cache.at < 60_000) return pick(cache.v, relevant);
  let v: LiaraStatus;
  try {
    const [svc, inc] = await Promise.all([list("services", "sort=position"), list("incidents", "sort=-started_at")]);
    const services = svc.map((s) => ({ id: s.id, name: s.name, operational: !!s.operational, status: s.status ?? "" }));
    const incidents = inc.filter((i) => i.status !== "resolved" && !i.resolved_at).map((i) => ({
      id: i.id, title: i.title, status: i.status, impact: i.impact, startedAt: i.started_at.replace(" ", "T"), services: i.services ?? [],
      ageHours: Math.round((Date.now() - Date.parse(i.started_at.replace(" ", "T"))) / 3_600_000),
    }));
    v = { checkedAt: new Date().toISOString(), services, incidents, affecting: [] };
    lastGood = v;
  } catch (e: any) {
    v = lastGood ?? { checkedAt: new Date().toISOString(), services: [], incidents: [], affecting: [], error: e?.message ?? "unreachable" };
  }
  cache = { at: v.error ? Date.now() - 45_000 : Date.now(), v }; // failures are retried after 15s
  return pick(v, relevant);
}

function pick(v: LiaraStatus, relevant: string[]): LiaraStatus {
  const ids = new Map(v.services.map((s) => [s.id, s.name]));
  const affecting: LiaraStatus["affecting"] = [];
  for (const s of v.services) if (relevant.includes(s.name) && !s.operational) affecting.push({ service: s.name, reason: `سرویس «${s.name}» در صفحه‌ی وضعیت لیارا ناپایدار اعلام شده است.` });
  for (const i of v.incidents) {
    const names = i.services.map((id) => ids.get(id)).filter(Boolean) as string[];
    const hit = names.find((n) => relevant.includes(n));
    if (hit && i.ageHours <= RECENT_HOURS) affecting.push({ service: hit, reason: `اختلال اعلام‌شده‌ی لیارا: ${i.title} (${i.status === "investigating" ? "در حال بررسی" : i.status === "identified" ? "شناسایی‌شده" : "در حال پایش"})` });
  }
  // stale "investigating" incidents are not shown anywhere (neither UI nor the AI tools): they are not live outages
  return { ...v, incidents: v.incidents.filter((i) => i.ageHours <= RECENT_HOURS), affecting };
}
