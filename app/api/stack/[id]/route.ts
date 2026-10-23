import { handle } from "@/lib/api";
import { jobs } from "@/lib/stack/run";

export const dynamic = "force-dynamic";
export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const j = jobs.get((await params).id);
    if (!j) throw Object.assign(new Error("عملیات پیدا نشد."), { status: 404 });
    return j;
  });
