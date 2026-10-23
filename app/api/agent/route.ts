import { z } from "zod";
import { handle } from "@/lib/api";
import { runAgent } from "@/lib/ai/agent";

export const maxDuration = 120;
const Body = z.object({ app: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1) });
export const POST = (req: Request) => handle(async () => { const b = Body.parse(await req.json()); return runAgent(b.messages, b.app); });
