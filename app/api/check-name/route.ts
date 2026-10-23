import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";

export const dynamic = "force-dynamic";
export const GET = (req: Request) =>
  handle(async () => {
    const name = new URL(req.url).searchParams.get("name") ?? "";
    if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(name)) throw Object.assign(new Error("نام نامعتبر است"), { status: 400 });
    return { name, available: await liara().checkName(name) };
  });
