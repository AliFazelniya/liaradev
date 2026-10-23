import { strFromU8 } from "fflate";
import vm from "node:vm";
import type { Files } from "./codebase";

export interface SyntaxIssue { file: string; line: number; message: string }

/** Parse (never run) every CommonJS .js file. ESM files (import/export) are skipped: they cannot be checked this way. */
export function checkSyntax(files: Files): SyntaxIssue[] {
  const out: SyntaxIssue[] = [];
  for (const [f, d] of Object.entries(files)) {
    if (!/\.(js|cjs)$/.test(f) || f.includes("node_modules") || d.length > 300_000) continue;
    const code = strFromU8(d);
    if (/^\s*(import\s[^(]|export\s)/m.test(code)) continue;
    try {
      new vm.Script(`(function (exports, require, module, __filename, __dirname) {${code.replace(/^#!.*/, "")}\n})`, { filename: f });
    } catch (e: any) {
      const line = Number(String(e.stack ?? "").match(new RegExp(`${f.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}:(\\d+)`))?.[1] ?? 0);
      out.push({ file: f, line, message: String(e.message ?? e).slice(0, 160) });
    }
  }
  return out;
}
