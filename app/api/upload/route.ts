import { handle } from "@/lib/api";
import { createUpload } from "@/lib/uploads";

export const POST = () => handle(async () => ({ id: createUpload() }));
