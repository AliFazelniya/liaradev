import { z } from "zod";
import { handle } from "@/lib/api";
import { startStack } from "@/lib/stack/run";

/** The user confirmed the reviewed plan: build everything. */
export const POST = (req: Request) =>
  handle(async () => {
    const b = z.object({ planId: z.string(), skipEdits: z.array(z.number().int()).optional() }).parse(await req.json());
    return { jobId: startStack(b.planId, { skipEdits: b.skipEdits }).id };
  });
