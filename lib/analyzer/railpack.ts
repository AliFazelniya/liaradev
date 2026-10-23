import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Files } from "./codebase";

const run = promisify(execFile);

/**
 * Local project detection with Railpack (MIT, https://github.com/railwayapp/railpack): `railpack info` reads a folder and reports
 * the provider, start command and runtime versions. It runs on this machine only (no network calls, no build).
 * Optional: found via RAILPACK_BIN, ./.data/bin/railpack or PATH; without it the other detection layers still work.
 */
export interface RailpackInfo { providers: string[]; startCommand?: string; runtime: Record<string, string> }

function bin(): string | null {
  const c = [process.env.RAILPACK_BIN, path.join(process.cwd(), ".data", "bin", "railpack"), ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "railpack"))];
  return c.find((p) => p && fs.existsSync(p)) ?? null;
}

/** Railpack provider → Liara platform id (providers Liara has no platform for map to undefined). */
export function providerToPlatform(provider: string, files: Files): string | undefined {
  const has = (re: RegExp) => Object.keys(files).some((f) => re.test(f));
  switch (provider) {
    case "node": return has(/(^|\/)next\.config\.(js|mjs|ts)$/) ? "next" : "node";
    case "python": return has(/(^|\/)manage\.py$/) ? "django" : "python";
    case "php": return files["composer.json"] && new TextDecoder().decode(files["composer.json"]).includes("laravel/framework") ? "laravel" : "php";
    case "golang": case "go": return "go";
    case "dotnet": return "netcore";
    case "staticfile": case "shell": return provider === "staticfile" ? "static" : undefined;
    default: return undefined; // java, ruby, rust, deno, elixir…: no matching Liara platform
  }
}

export async function railpackInfo(files: Files): Promise<RailpackInfo | null> {
  const exe = bin();
  if (!exe) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lp-rp-"));
  try {
    for (const [name, data] of Object.entries(files)) {
      const p = path.join(dir, name);
      if (!p.startsWith(dir + path.sep)) continue; // never write outside the temp dir
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    }
    const { stdout } = await run(exe, ["info", "--format", "json", dir], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } });
    const j = JSON.parse(stdout);
    if (!j.success && !j.detectedProviders?.length) return { providers: [], runtime: {} };
    return {
      providers: j.detectedProviders ?? [],
      startCommand: j.plan?.deploy?.startCommand,
      runtime: Object.fromEntries(Object.entries<any>(j.resolvedPackages ?? {}).map(([k, v]) => [k, v.resolvedVersion])),
    };
  } catch { return null; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
