import { z } from "zod";
import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";

export const dynamic = "force-dynamic";
export const GET = () => handle(async () => ({ networks: await liara().listNetworks() }));
export const POST = (req: Request) =>
  handle(async () => {
    const b = z.object({ name: z.string().regex(/^[A-Za-z0-9-]{3,32}$/, "نام شبکه: حروف انگلیسی، عدد و خط تیره (حداقل ۳ حرف)") }).parse(await req.json());
    return liara().createNetwork(b.name);
  });
