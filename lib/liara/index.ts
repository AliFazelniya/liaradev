import { realLiara } from "./client";
import type { LiaraProvider } from "./types";

export * from "./types";

export function liara(): LiaraProvider {
  return realLiara;
}
