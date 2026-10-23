import { handle } from "@/lib/api";
import { decide } from "@/lib/ai/sre";
import { aiConfigured } from "@/lib/ai/llm";
import { gatherAndDiagnose } from "@/lib/monitor/diagnose";
import { recordManualCheck } from "@/lib/monitor/scheduler";

export const maxDuration = 120;

/** Runs only when the user presses "بررسی عملکرد": collects evidence, then the AI decides the cause and one next step (no auto-run). */
export const POST = (_: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const { name } = await params;
    const diagnosis = await gatherAndDiagnose(name);
    const decision = aiConfigured() ? await decide(name, diagnosis) : null;
    recordManualCheck(name, diagnosis, decision);
    return { diagnosis, decision };
  });
