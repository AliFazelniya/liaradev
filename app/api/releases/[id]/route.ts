import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { analyzeBuild } from "@/lib/monitor/build";
import { redactText } from "@/lib/redact";

export const dynamic = "force-dynamic";
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await params;
    const b = await liara().getBuild(id);
    return { state: b.state, analysis: analyzeBuild(b), lines: b.lines.slice(-200).map((l) => ({ ...l, line: redactText(l.line) })) };
  });
