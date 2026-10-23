import { handle } from "@/lib/api";
import { getState } from "@/lib/store";
import { getLiaraStatus } from "@/lib/monitor/liaraStatus";
import { uptimeSnapshot, uptimeTick } from "@/lib/monitor/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const payload = async () => ({ apps: uptimeSnapshot(), history: getState().uptime, liara: await getLiaraStatus(["PaaS"]) });
/** Liveness history per app + Liara's own platform status (liara.online). */
export const GET = () => handle(payload);
/** "Check now": one ping round immediately. */
export const POST = () => handle(async () => { await uptimeTick(); return payload(); });
