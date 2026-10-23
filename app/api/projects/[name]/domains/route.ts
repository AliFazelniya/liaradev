import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";

export const dynamic = "force-dynamic";
export const GET = (_: Request, { params }: { params: Promise<{ name: string }> }) => handle(async () => ({ domains: await liara().listDomains((await params).name) }));
