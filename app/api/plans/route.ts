import { z } from "zod";
import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { recommendPlan } from "@/lib/analyzer/plan";

export const dynamic = "force-dynamic";
export const GET = () => handle(async () => ({ plans: await liara().getPlans() }));
const Q = z.object({ platform: z.string(), dailyUsers: z.number().min(0), needsDb: z.boolean().optional(), heavyDeps: z.boolean().optional(), maxBudgetToman: z.number().optional() });
export const POST = (req: Request) => handle(async () => recommendPlan(Q.parse(await req.json()), await liara().getPlans()));
