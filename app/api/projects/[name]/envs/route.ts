import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";

export const dynamic = "force-dynamic";
// Raw values for the owner's settings editor only; the AI never receives these (tools redact them).
export const GET = (_: Request, { params }: { params: Promise<{ name: string }> }) =>
  handle(async () => ({ envs: ((await liara().getProject((await params).name)).envs ?? []).map((e) => ({ key: e.key, value: e.value })) }));
