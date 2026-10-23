import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { redactEnvs, redactText } from "@/lib/redact";

export const dynamic = "force-dynamic";
export const GET = (_: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => {
    const { name } = await params;
    const L = liara();
    const [project, metrics, logs, plans] = await Promise.all([
      L.getProject(name),
      L.getMetrics(name).catch(() => ({ cpu: [], memory: [] })),
      L.getLogs(name, 3600).catch(() => []),
      L.getPlans().catch(() => []),
    ]);
    return {
      project: { ...project, envs: redactEnvs(project.envs ?? []) },
      plan: plans.find((p) => p.id === project.planID) ?? null,
      plans,
      metrics,
      logs: logs.slice(-80).map((l) => ({ ...l, message: redactText(l.message) })),
    };
  });
