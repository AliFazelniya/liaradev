import { randomBytes } from "node:crypto";
import { handle } from "@/lib/api";
import { getState, save } from "@/lib/store";

export const dynamic = "force-dynamic";

const url = (req: Request) => `${new URL(req.url).origin}/api/mcp`;

// the owner can reveal the token to paste it into an AI client
export const GET = (req: Request) => handle(async () => ({ token: getState().settings.mcp.token, url: url(req) }));

export const POST = (req: Request) =>
  handle(async () => {
    const m = getState().settings.mcp;
    m.token = "lpt_" + randomBytes(24).toString("hex");
    save();
    return { token: m.token, url: url(req) };
  });
