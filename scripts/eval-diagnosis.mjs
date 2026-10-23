#!/usr/bin/env node
// Evaluates the diagnosis against REAL test apps whose true problem is known.
// Usage: node scripts/eval-diagnosis.mjs [baseUrl]   (apps lp-* must exist on the connected Liara account)
const BASE = process.argv[2] || "http://localhost:3000";

const CASES = [
  { app: "lp-fine-api", expect: { severity: "ok" } },
  { app: "lp-fine-static", expect: { severity: "ok" } },
  { app: "lp-oom", expect: { top: "leak", fixFirst: "advice", forbid: ["restart_project"], workaround: "change_plan" } },
  { app: "lp-crash", expect: { causeIds: ["code-error"], evidenceIncludes: "userId", forbid: ["restart_project"] } },
  { app: "lp-err500", expect: { top: "db", evidenceIncludes: "5432", actionIncludes: "DATABASE_URL" } },
  { app: "lp-badbuild", expect: { top: "release", forbidCauses: ["nodeploy"] } },
  { app: "lp-wrongport", expect: { top: "port", evidenceIncludes: "8080" } },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const res = await fetch(`${BASE}/api/projects/${c.app}/diagnose`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) { console.log(`✗ ${c.app}: API error ${body.error}`); fail++; continue; }
  const d = body.diagnosis, e = c.expect, errs = [];
  const ids = d.causes.map((x) => x.id);
  const text = JSON.stringify(d.causes.map((x) => x.evidence));
  if (e.severity && d.severity !== e.severity) errs.push(`severity ${d.severity} ≠ ${e.severity}`);
  if (e.top && ids[0] !== e.top) errs.push(`top cause ${ids[0]} ≠ ${e.top}`);
  for (const id of e.causeIds ?? []) if (!ids.includes(id)) errs.push(`missing cause ${id}`);
  for (const id of e.forbidCauses ?? []) if (ids.includes(id)) errs.push(`unexpected cause ${id}`);
  if (e.evidenceIncludes && !text.includes(e.evidenceIncludes)) errs.push(`evidence lacks "${e.evidenceIncludes}"`);
  const tools = d.actions.map((a) => a.tool);
  for (const t of e.forbid ?? []) if (tools.includes(t)) errs.push(`must not suggest ${t}`);
  if (e.fixFirst && !(d.actions[0]?.tool === e.fixFirst && d.actions[0]?.kind === "fix")) errs.push(`first action should be ${e.fixFirst}/fix, got ${d.actions[0]?.tool}/${d.actions[0]?.kind}`);
  if (e.workaround && !d.actions.some((a) => a.tool === e.workaround && a.kind === "workaround")) errs.push(`${e.workaround} should be labeled workaround`);
  if (e.actionIncludes && !d.actions.some((a) => a.why.includes(e.actionIncludes))) errs.push(`no action mentions ${e.actionIncludes}`);
  if (errs.length) { fail++; console.log(`✗ ${c.app}\n   ${errs.join("\n   ")}`); }
  else { pass++; console.log(`✓ ${c.app}  → ${ids[0] ?? "healthy"}`); }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
