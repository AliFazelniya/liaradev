import { liara } from "../liara";
import type { Files } from "../analyzer/codebase";
import { loadSource } from "../monitor/source";
import { redactText } from "../redact";
import { projectHistory } from "../monitor/history";
import type { Diagnosis } from "../monitor/diagnose";
import { aiConfigured, callLLM } from "./llm";
import { strFromU8 } from "fflate";

/**
 * The AI "SRE": given the collected evidence, what Liara lets it do, and the app's source code (read-only, on demand),
 * it decides what is wrong and what single next step to propose. It never executes anything: proposals go through the
 * normal approval flow. Every claim is checked against the evidence before it reaches the user.
 */

export interface Proposal {
  kind: "action" | "code_fix" | "env" | "manual" | "wait";
  tool?: "change_plan" | "restart_project" | "turn_project" | "update_port" | "rollback_release" | "fix_dependencies";
  args?: Record<string, unknown>;
  key?: string; // env: variable name the user must supply
  why: string;
}
export interface Decision {
  verdict: "ok" | "issue" | "unsure";
  summary: string;
  cause: string;
  confidence: number;
  evidence: string[]; // verbatim snippets (verified)
  proposal?: Proposal;
  unverified?: boolean;
}

const SYSTEM = `You are the SRE of a web app hosted on Liara (Iranian PaaS). You are given evidence collected from the platform, the options you may propose, and read-only access to the app's source.

Rules:
- Use ONLY the evidence and what you read with tools. Never guess. If you are not sure, say verdict "unsure" and propose nothing.
- Prefer the root cause over a symptom. Look at "history": if an action was already done and the problem persists, do not propose it again; find the real cause (read the code if needed).
- "site" is what the real website returned when requested (page text, and the assets/endpoints its own code uses). HTTP 200 does not mean it works: judge from "site", and from whether the page text looks like a working app or an error page. If the site is broken, the verdict is "issue" even when the logs are clean.
- Platform fit: if the files cannot run on the app's platform (PHP on static, Python on Node...), that is the cause; the platform of an existing app cannot be changed, so propose "manual" (recreate on the right platform).
- Call read_file / list_files only if the code is needed to decide (code errors, slow or heavy code, leaks, or a broken site whose cause is not obvious). Do not read files otherwise.
- Capacity vs leak: if memory use is stable but larger than the plan's RAM (for example a dataset loaded at startup), the fix is change_plan to the smallest plan in "options" with enough RAM. If memory keeps growing without bound it is a leak: manual (a bigger plan only delays the crash).
- When the verdict is "issue" a proposal is mandatory.
- Choose exactly ONE proposal:
  action   - a Liara operation from "options" (change_plan / restart_project / turn_project / update_port / rollback_release / fix_dependencies). Use only plan ids, release ids and ports that appear in "options".
  env      - a required environment variable is missing; set "key" (the user will enter the value).
  code_fix - the cause is in the code OR in a dependency file (requirements.txt / package.json / composer.json: a wrong version pin, or a package that needs a binary replacement such as psycopg2 -> psycopg2-binary) AND the fix is small and local (a few lines, you read the file and are sure). The system will generate and show the patch.
  manual   - the cause is in the code or design but the fix is complicated (leak design, algorithm, architecture, missing infrastructure). Say what is wrong and where (file/function). Do not propose a fix.
  wait     - nothing to change now (e.g. a Liara outage, or the app was just changed and metrics are not stable yet).
- "evidence" = 1 to 3 snippets copied VERBATIM from the logs/metrics/code you were given (max 120 chars each). No paraphrase.
- Be brief. Persian, plain words, no preface, no markdown. summary <= 20 words. cause <= 20 words. proposal.why <= 20 words.
- Answer only by calling submit_decision.`;

const TOOLS = [
  { type: "function", function: { name: "list_files", description: "List source files of the latest release.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "read_file", description: "Read one source file (numbered lines).", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  {
    type: "function",
    function: {
      name: "submit_decision",
      description: "Final answer.",
      parameters: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["ok", "issue", "unsure"] },
          summary: { type: "string" },
          cause: { type: "string" },
          confidence: { type: "number" },
          evidence: { type: "array", items: { type: "string" } },
          proposal: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["action", "code_fix", "env", "manual", "wait"] },
              tool: { type: "string", enum: ["change_plan", "restart_project", "turn_project", "update_port", "rollback_release", "fix_dependencies"] },
              args: { type: "object" },
              key: { type: "string" },
              why: { type: "string" },
            },
            required: ["kind", "why"],
          },
        },
        required: ["verdict", "summary", "confidence", "proposal"],
      },
    },
  },
];

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const cut = (t: unknown, n: number) => String(t ?? "").slice(0, n);

/** What the AI is allowed to propose, with the real values it may use. */
async function buildOptions(project: string, d: Diagnosis) {
  const L = liara();
  const [detail, plans, releases] = await Promise.all([L.getProject(project), L.getPlans().catch(() => []), L.getReleases(project).catch(() => [])]);
  const cur = plans.find((p) => p.id === detail.planID);
  return {
    detail,
    plans,
    releases,
    options: {
      current: { plan: detail.planID, status: detail.status, port: releases.find((r) => r.current)?.port ?? null, envVariableNames: (detail.envs ?? []).map((e) => e.key) },
      change_plan: plans.filter((p) => p.available && p.id !== detail.planID).map((p) => ({ id: p.id, name: p.name, ramGB: p.ramGB, cpuCores: p.cpu, monthlyToman: p.monthly, currentPlan: p.id === cur?.id })),
      restart_project: "restarts the container (a few seconds of downtime)",
      turn_project: "{on:false} stops the app, {on:true} starts it",
      update_port: "{port:number} app port, no redeploy needed",
      rollback_release: releases.filter((r) => r.state === "READY" && !r.current).slice(0, 4).map((r) => ({ releaseID: r.id, created: r.createdAt })),
      fix_dependencies: "fixes misspelled or non-existent packages in package.json and redeploys",
    },
  };
}

function validate(p: any, ctx: Awaited<ReturnType<typeof buildOptions>>, project: string): Proposal | undefined {
  if (!p || typeof p !== "object") return undefined;
  const why = cut(p.why, 160);
  if (p.kind === "manual" || p.kind === "wait") return { kind: p.kind, why };
  if (p.kind === "code_fix") return { kind: "code_fix", why };
  if (p.kind === "env") return /^[A-Z][A-Z0-9_]{1,60}$/.test(String(p.key ?? "")) ? { kind: "env", key: p.key, why } : undefined;
  if (p.kind !== "action") return undefined;
  const a = p.args ?? {};
  switch (p.tool) {
    case "change_plan": {
      const want = a.planID ?? a.plan ?? a.id; // models sometimes name the key differently
      const t = ctx.plans.find((x) => x.id === want && x.available && x.id !== ctx.detail.planID);
      return t ? { kind: "action", tool: "change_plan", args: { name: project, planID: t.id }, why } : undefined;
    }
    case "restart_project": return { kind: "action", tool: "restart_project", args: { name: project }, why };
    case "turn_project": return typeof a.on === "boolean" ? { kind: "action", tool: "turn_project", args: { name: project, on: a.on }, why } : undefined;
    case "update_port": { const n = Number(a.port); return Number.isInteger(n) && n >= 1 && n <= 65535 ? { kind: "action", tool: "update_port", args: { name: project, port: n }, why } : undefined; }
    case "rollback_release": { const r = ctx.releases.find((x) => x.id === a.releaseID && x.state === "READY" && !x.current); return r ? { kind: "action", tool: "rollback_release", args: { name: project, releaseID: r.id }, why } : undefined; }
    case "fix_dependencies": return { kind: "action", tool: "fix_dependencies", args: { name: project }, why };
    default: return undefined;
  }
}

/** Anti-repeat guard: the same operation again right after it was done is never useful. */
function cooledDown(p: Proposal | undefined, project: string, createdAt?: string): Proposal | undefined {
  if (p?.kind !== "action") return p;
  const last = projectHistory(project, 1, createdAt).find((h) => h.tool === p.tool);
  const wait = p.tool === "change_plan" ? 6 : p.tool === "restart_project" ? 10 : 0;
  if (last && wait && Date.now() - Date.parse(last.at) < wait * 60_000) return { kind: "wait", why: "همین اقدام به‌تازگی انجام شده؛ کمی صبر کنید و دوباره بررسی کنید." };
  return p;
}

/** One retry: the provider occasionally times out or returns an unparsable answer, which must not look like "no opinion". */
export async function decide(project: string, d: Diagnosis): Promise<Decision | null> {
  return (await decideOnce(project, d)) ?? (aiConfigured() ? await decideOnce(project, d) : null);
}

async function decideOnce(project: string, d: Diagnosis): Promise<Decision | null> {
  if (!aiConfigured()) return null;
  try {
    const ctx = await buildOptions(project, d);
    const lastChange = d.history?.[0];
    const facts = [
      "Liara's CPU metric is unreliable for about 5 minutes after any container restart or plan change.",
      d.settling ? "SETTLING: the app was deployed/restarted only minutes ago. 502/503 and empty logs right after a deploy are normal warm-up. Do not diagnose from the HTTP probe alone: with no error in the logs the verdict is \"ok\" or \"unsure\" and the proposal is \"wait\"." : "",
      lastChange ? `Last action on this app: "${lastChange.summary}" ${Math.round((Date.now() - Date.parse(lastChange.at)) / 60000)} minutes ago.` : "No action has been taken on this app yet.",
    ];
    const evidence = {
      project, severity: d.severity, settling: !!d.settling, ruleCauses: d.causes, probe: d.probe, metrics: d.metrics, recentLogs: d.logSample,
      site: d.web ? { title: d.web.title, pageText: d.web.textSample, requestsMade: d.web.checked, problems: d.web.issues.map((i) => `${i.url} — ${i.detail}`) } : undefined,
      liaraPlatformIssues: d.platform?.affecting ?? [], history: d.history, facts, options: ctx.options,
    };
    const blob = norm(JSON.stringify(evidence).replace(/\\"/g, '"').replace(/\\n/g, " "));
    let readText = "";
    let files: Files | null | undefined;
    const messages: any[] = [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(evidence) }];

    for (let step = 0; step < 6; step++) {
      const { message } = await callLLM({ messages, tools: TOOLS, tool_choice: step === 5 ? { type: "function", function: { name: "submit_decision" } } : "auto", max_tokens: 700, temperature: 0.1 }, { source: "diagnose", note: `sre ${project}` });
      messages.push(message);
      const calls: any[] = message.tool_calls ?? [];
      if (!calls.length) { messages.push({ role: "user", content: "Answer by calling submit_decision." }); continue; }
      for (const c of calls) {
        let args: any = {};
        try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* handled below */ }
        if (c.function.name === "submit_decision") return finalize(args, ctx, project, blob + norm(readText), d);
        let out = "";
        if (c.function.name === "list_files" || c.function.name === "read_file") {
          files ??= await loadSource(project);
          if (!files) out = "source not available";
          else if (c.function.name === "list_files") out = Object.entries(files).filter(([f]) => !f.includes("node_modules")).slice(0, 80).map(([f, b]) => `${f} (${b.length}B)`).join("\n");
          else {
            const b = files[String(args.path ?? "")];
            if (!b) out = "no such file";
            else { const t = redactText(strFromU8(b)).split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n").slice(0, 7000); readText += t.replace(/^\d+\| /gm, ""); out = t; }
          }
        } else out = "unknown tool";
        messages.push({ role: "tool", tool_call_id: c.id, content: out });
      }
    }
    return null;
  } catch { return null; }
}

function finalize(a: any, ctx: Awaited<ReturnType<typeof buildOptions>>, project: string, blob: string, d: Diagnosis): Decision {
  const verdict = ["ok", "issue", "unsure"].includes(a.verdict) ? a.verdict : "unsure";
  const snippets = (Array.isArray(a.evidence) ? a.evidence : []).map((s: unknown) => cut(s, 120)).filter(Boolean);
  const verified = snippets.filter((s: string) => blob.includes(norm(s)));
  let proposal = cooledDown(validate(a.proposal, ctx, project), project, ctx.detail.created_at);
  let confidence = Math.max(0, Math.min(1, Number(a.confidence) || 0));
  // a claim that quotes nothing real is not shown as fact, and cannot ask the user to change anything
  const unverified = verdict === "issue" && snippets.length > 0 && verified.length === 0;
  if (unverified || (verdict === "issue" && !snippets.length && proposal && proposal.kind !== "wait")) {
    confidence = Math.min(confidence, 0.3);
    if (proposal && proposal.kind !== "wait") proposal = undefined;
  }
  if (verdict === "unsure") proposal = undefined;
  // Guards against the AI acting on a warm-up or on a site that is working:
  const failing = !!d.probe && (!!d.probe.error || (d.probe.status ?? 0) >= 500);
  const ruleSaysPort = d.causes.some((c) => c.id === "port");
  if (proposal?.kind === "action" && ["update_port", "restart_project", "rollback_release"].includes(proposal.tool ?? "") && !ruleSaysPort && (!failing || d.settling))
    proposal = { kind: "wait", why: d.settling ? "برنامه تازه راه‌اندازی شده؛ چند دقیقه‌ی دیگر دوباره بررسی می‌شود." : "سایت پاسخ می‌دهد؛ تغییری لازم نیست." };
  if (d.settling && !d.causes.length && verdict === "issue") {
    // nothing in the logs yet: a guess during warm-up is not a finding
    return { verdict: "unsure", summary: "برنامه تازه راه‌اندازی شده و هنوز نشانه‌ی خطایی دیده نمی‌شود.", cause: "", confidence: 0, evidence: [], proposal: { kind: "wait", why: "چند دقیقه‌ی دیگر دوباره بررسی می‌شود." } };
  }
  return { verdict, summary: cut(a.summary, 200), cause: cut(a.cause, 200), confidence, evidence: verified.slice(0, 3), proposal, unverified: unverified || undefined };
}
