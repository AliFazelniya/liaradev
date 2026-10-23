import { strFromU8 } from "fflate";
import type { CodebaseReport, Files } from "../analyzer/codebase";
import { PLATFORMS } from "../platforms";
import { redactText } from "../redact";
import { aiConfigured, callLLM } from "./llm";

const IDS = PLATFORMS.map((p) => p.id);
const KEY = /(^|\/)(package\.json|composer\.json|requirements\.txt|pyproject\.toml|Pipfile|go\.mod|Dockerfile|Procfile|index\.(html|php|js|ts)|main\.(py|go|js|ts|php)|app\.(py|js|ts|php)|server\.(js|ts)|backend\.[a-z]+|manage\.py|wsgi\.py|artisan)$/i;

const TOOL = [{
  type: "function",
  function: {
    name: "submit_project_type",
    description: "Final answer: which Liara platform runs this project.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", enum: IDS },
        framework: { type: "string" },
        port: { type: "number", description: "port the app listens on; static/php/dotnet use 80" },
        confidence: { type: "number" },
        reason: { type: "string", description: "one short Persian sentence naming the files that decided it" },
      },
      required: ["platform", "confidence", "reason"],
    },
  },
}];

/**
 * The file rules decide most projects. When the AI is configured it double-checks the choice from the real files
 * (a backend script next to an index.html is not a "static site"). It may override the rules only when it is confident.
 */
export async function aiClassify(files: Files, r: CodebaseReport): Promise<CodebaseReport> {
  if (!aiConfigured()) return r;
  try {
    const names = Object.entries(files).filter(([f]) => !/(^|\/)(node_modules|vendor|\.git)\//.test(f));
    const tree = names.slice(0, 150).map(([f, b]) => `${f} (${b.length}B)`).join("\n");
    const heads = names.filter(([f, b]) => KEY.test(f) && b.length < 400_000).slice(0, 8)
      .map(([f, b]) => `--- ${f}\n${redactText(strFromU8(b.slice(0, 1500)))}`).join("\n");
    const { message } = await callLLM({
      messages: [
        { role: "system", content: `Decide which Liara platform should run this uploaded project. Platforms: ${IDS.join(", ")}.\nRules: static = only browser files (HTML/CSS/JS), no server code. Any server-side script the page calls (.php, .py, a Node server) means a runtime platform is needed, not static. The rules and Railpack (a local detector) are hints and can both be wrong, e.g. Railpack calls a page with a PHP backend "staticfile". If a Dockerfile is present the author intends it to be used: prefer docker. Use only the files you are given; never guess. Answer only by calling submit_project_type.` },
        { role: "user", content: JSON.stringify({ rulesGuess: { platform: r.platform, framework: r.framework }, railpack: r.railpack ? { providers: r.railpack.providers, startCommand: r.railpack.startCommand } : undefined, files: tree, keyFiles: heads }) },
      ],
      tools: TOOL, tool_choice: { type: "function", function: { name: "submit_project_type" } }, max_tokens: 250, temperature: 0,
    }, { source: "wizard", note: "classify project" });
    const a = JSON.parse(message.tool_calls?.[0]?.function?.arguments ?? "{}");
    const platform = String(a.platform ?? "");
    if (!IDS.includes(platform) || !(Number(a.confidence) >= 0.7)) return { ...r, detectedBy: "rules" };
    const reason = String(a.reason ?? "").slice(0, 200);
    const same = platform === r.platform || (platform === "netcore" && r.platform === "dotnet");
    if (same) return { ...r, detectedBy: "ai", aiReason: reason };
    const port = Number(a.port);
    const def = PLATFORMS.find((p) => p.id === platform)!.port;
    return { ...r, platform, framework: String(a.framework || platform).slice(0, 40), port: Number.isInteger(port) && port > 0 && port < 65536 && !(port === 80 && def !== 80) ? port : def, detectedBy: "ai", aiReason: reason, rulesGuess: r.platform };
  } catch { return r; }
}
