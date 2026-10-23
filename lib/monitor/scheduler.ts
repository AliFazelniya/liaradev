import { liara } from "../liara";
import { execute } from "../ai/tools";
import { getState, save } from "../store";
import { decide } from "../ai/sre";
import { gatherAndDiagnose, probeSite, announcedPort, toReport, type Probe, type Diagnosis } from "./diagnose";
import type { Decision } from "../ai/sre";
import { effectiveSeverity } from "../severity";
import type { HealthReport } from "../store";

const g = globalThis as unknown as { __sched?: { timer: NodeJS.Timeout; every: number }; __uptime?: { timer: NodeJS.Timeout; last: Map<string, { up: boolean; at: string; probe: Probe }> } };

const isUp = (p: Probe) => !p.error && p.status !== undefined && p.status < 500;
export const uptimeSnapshot = () => Object.fromEntries(g.__uptime?.last ?? []);

/** Liveness of a non-HTTP app: container running and not crash-looping (die/oom events in the last 10 minutes). */
async function processAlive(name: string): Promise<boolean> {
  const ev = await liara().getEvents(name).catch(() => []);
  const since = Date.now() / 1000 - 600;
  return ev.filter((e) => e.time >= since && (e.status === "die" || e.status === "oom")).length < 2;
}

/** Cheap liveness ping (no AI, no Liara metrics): every 5 minutes. A state change (up->down or down->up) triggers a full diagnosis sweep for that app, which is what writes the AI log entry. */
export async function uptimeTick() {
  const last = g.__uptime!.last;
  const all = await liara().listProjects();
  const projects = all.filter((p) => p.isDeployed && p.status === "RUNNING");
  for (const name of [...last.keys()]) if (!projects.some((p) => p.project_id === name)) last.delete(name);
  for (const name of Object.keys(getState().uptime)) if (!all.some((p) => p.project_id === name)) delete getState().uptime[name];
  for (const p of projects) {
    let probe = await probeSite(p.project_id);
    if (!isUp(probe)) {
      // a deploy/restart in the last few minutes makes the first requests fail: not an outage
      const rel = (await liara().getReleases(p.project_id).catch(() => []))[0];
      if (rel && (rel.state !== "READY" || Date.now() - Date.parse(rel.createdAt) < 3 * 60_000)) continue;
      await new Promise((r) => setTimeout(r, 15_000)); // one failed request is not an outage: confirm once
      probe = await probeSite(p.project_id);
    }
    const hist = (getState().uptime[p.project_id] ??= []);
    let up = isUp(probe), mode: "http" | "process" = "http";
    if (!up) {
      // Not every app answers HTTP (Telegram bot, worker, queue consumer). Without proof it is a web app, judge by the process.
      const web = hist.some((x) => x.up && x.mode !== "process") || !!announcedPort(await liara().getLogs(p.project_id, 900).catch(() => []));
      if (!web) { mode = "process"; up = await processAlive(p.project_id); }
    }
    const prev = last.get(p.project_id);
    last.set(p.project_id, { up, at: new Date().toISOString(), probe });
    hist.push({ t: Math.floor(Date.now() / 1000), up, ms: probe.ms, status: probe.status, error: probe.error, mode });
    if (hist.length > 600) hist.splice(0, hist.length - 600);
    save();
    if (prev ? prev.up !== up : !up) await runSweep("scheduler", p.project_id).catch(() => {});
  }
}

/** The concrete actions a check proposes: the AI's single proposal, or (without AI) the rule-based ones. */
export function actsFromDecision(project: string, d: Diagnosis, dec: Decision | null | undefined, forAuto = false) {
  const acts: { tool: string; args: Record<string, unknown>; why: string }[] = [];
  if (dec?.proposal?.kind === "action" && dec.proposal.tool) acts.push({ tool: dec.proposal.tool, args: dec.proposal.args ?? {}, why: dec.proposal.why });
  else if (dec?.proposal?.kind === "code_fix") acts.push({ tool: "fix_code", args: { name: project, error: dec.evidence.join("\n") || dec.cause }, why: dec.proposal.why });
  else if (!dec && forAuto) for (const a of d.actions) if (!["advice", "set_env", "fix_code"].includes(a.tool)) acts.push(a);
  return acts;
}

/** Store the result of a check the user ran by hand, so reopening the page shows it (no actions are executed). */
export function recordManualCheck(project: string, d: Diagnosis, dec: Decision | null) {
  const r = toReport(project, d);
  if (dec) {
    r.decision = dec; r.actions = actsFromDecision(project, d, dec).map((a) => ({ ...a, kind: "fix" as const }));
    const eff = effectiveSeverity(d, dec); // the AI may have found what the rules did not
    if (eff.severity !== r.severity) { r.severity = eff.severity; r.settling = undefined; r.summary = dec.summary || r.summary; r.fingerprint = "ai|" + dec.cause.slice(0, 40); }
  }
  const reports = getState().reports;
  const prev = [...reports].reverse().find((x) => x.project === project);
  if (prev && prev.fingerprint === r.fingerprint && !prev.recovered) {
    prev.seen = (prev.seen ?? 1) + 1; prev.lastSeenAt = r.at;
    if (dec) { prev.decision = dec; prev.actions = r.actions; }
  } else {
    if (d.severity === "ok" && !d.settling && prev && prev.severity !== "ok") { r.recovered = true; r.summary = "✅ مشکل قبلی برطرف شد و برنامه سالم است."; }
    reports.push(r);
  }
  save();
}

/** Follow-up checks after a deploy / restart / plan change (and the first one right away if `now`). */
export function scheduleRechecks(project: string, delaysMin: number[]) {
  for (const m of delaysMin) setTimeout(() => runSweep("scheduler", project).catch(() => {}), m * 60_000).unref?.();
}

/** After a deploy: wait for the build to finish, check immediately, then again while the app settles. */
export async function watchRelease(project: string, releaseID?: string) {
  const TERMINAL = ["READY", "FAILED", "UNHEALTHY", "CANCELED", "TIMEDOUT"];
  for (let i = 0; i < 100; i++) { // up to ~17 minutes of building
    const rel = releaseID ? (await liara().getReleases(project).catch(() => [])).find((r) => r.id === releaseID) : (await liara().getReleases(project).catch(() => []))[0];
    if (rel && TERMINAL.includes(rel.state)) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  await new Promise((r) => setTimeout(r, 8_000)); // container needs a few seconds to come up
  await runSweep("scheduler", project).catch(() => {});
  scheduleRechecks(project, [2, 6]);
}

/** One health sweep over all projects. Safe to call manually ("Run now") or from the timer. */
export async function runSweep(source: "scheduler" | "user" = "scheduler", only?: string): Promise<HealthReport[]> {
  const out: HealthReport[] = [];
  const projects = (await liara().listProjects()).filter((p) => !only || p.project_id === only);
  for (const p of projects) {
    try {
      const d = await gatherAndDiagnose(p.project_id);
      const r = toReport(p.project_id, d);
      const prev = [...getState().reports].reverse().find((x) => x.project === p.project_id);
      // same state as last sweep: just bump the counter, no new log entry, no new AI call
      if (prev && prev.fingerprint === r.fingerprint && !prev.recovered) {
        prev.seen = (prev.seen ?? 1) + 1; prev.lastSeenAt = r.at;
        out.push(prev);
        continue;
      }
      if (d.severity === "ok") {
        if (prev && prev.severity !== "ok") { r.recovered = true; r.summary = "✅ مشکل قبلی برطرف شد و برنامه سالم است."; }
        else if (prev && prev.fingerprint !== "settling") { prev.seen = (prev.seen ?? 1) + 1; prev.lastSeenAt = r.at; out.push(prev); continue; }
      } else {
        // the AI decides the one next step (verified against the evidence); without AI the rule-based actions are used
        const dec = await decide(p.project_id, d);
        if (dec) r.decision = dec;
        const acts = actsFromDecision(p.project_id, d, dec, true);
        r.actions = acts.map((a) => ({ ...a, kind: "fix" as const }));
        for (const a of acts) {
          const o = await execute(a.tool, a.args, { actor: "scheduler", source: "monitor", reason: a.why });
          if (o.status === "pending_approval") r.approvalIds.push(o.approvalId);
          else if (o.status === "done") r.autoApplied.push(`${a.tool}: ${a.why}`);
        }
      }
      getState().reports.push(r);
      out.push(r);
    } catch (e: any) {
      const r: HealthReport = {
        id: Math.random().toString(36).slice(2, 8), project: p.project_id, at: new Date().toISOString(),
        severity: "warning", summary: "بررسی سلامت انجام نشد: " + e.message, causes: [], actions: [], approvalIds: [], autoApplied: [],
      };
      getState().reports.push(r);
      out.push(r);
    }
  }
  save();
  return out;
}

export function ensureScheduler() {
  const s = getState().settings;
  if (!g.__uptime) {
    const timer = setInterval(() => { if (getState().settings.monitorEnabled) uptimeTick().catch(() => {}); }, 5 * 60_000);
    timer.unref?.();
    g.__uptime = { timer, last: new Map() };
    if (s.monitorEnabled) setTimeout(() => uptimeTick().catch(() => {}), 5_000).unref?.();
  }
  const every = Math.max(1, s.monitorEveryMinutes) * 60_000;
  if (g.__sched && (g.__sched.every !== every || !s.monitorEnabled)) {
    clearInterval(g.__sched.timer);
    g.__sched = undefined;
  }
  if (s.monitorEnabled && !g.__sched) {
    const timer = setInterval(() => runSweep("scheduler").catch(() => {}), every);
    timer.unref?.();
    g.__sched = { timer, every };
  }
}
