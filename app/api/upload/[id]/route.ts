import { handle } from "@/lib/api";
import { appendChunk, uploadSize } from "@/lib/uploads";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => ({ received: Math.max(0, uploadSize((await params).id)) }));

export const PUT = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await params;
    const offset = Number(new URL(req.url).searchParams.get("offset"));
    if (!Number.isInteger(offset) || offset < 0) throw Object.assign(new Error("offset نامعتبر"), { status: 400 });
    try { return { received: appendChunk(id, offset, new Uint8Array(await req.arrayBuffer())) }; }
    catch (e: any) { if (e.status === 409) return { received: e.received, resync: true }; throw e; }
  });
