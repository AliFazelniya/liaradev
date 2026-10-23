# LiaraPilot — an AI DevOps co-worker for Liara

A Persian (RTL) web panel, styled like the Liara console, where an AI assistant helps a site owner with the **first deploy, plan choice, monitoring and troubleshooting**. It reads logs, metrics, events and the real website, finds the probable cause, and proposes **one** fix. Anything risky waits for the user's approval.

Everything shown comes from the Liara API of the connected account. There is no demo or mock data.

## Quick start

```bash
npm install
cp .env.example .env.local     # Liara token (+ team id) and any OpenAI-compatible AI key; or enter them later in Admin → Settings
npm run dev                    # http://localhost:3000
```

Optional, for better project detection: `sh scripts/install-railpack.sh` (needs Go). Without it the other detection layers still work.

## What it does

| Challenge area | In LiaraPilot |
| --- | --- |
| First deploy | Upload a zip. The stack is detected (rules + [Railpack](https://github.com/railwayapp/railpack) + AI), blockers are caught before deploy (bad packages, syntax errors, missing `requirements.txt`, wrong platform), the cheapest fitting plan is chosen, and the app is created and deployed. |
| Multi-part projects | Frontend + backend + database in one zip: the AI reads README/env files, proposes all parts on **one private network**, turns every address into an environment variable (editing hard-coded ones), creates the database and apps, and deploys. The user confirms the plan first. |
| Operations | Restart, start/stop, plan change, port, env variables, rollback, redeploy, all through the Liara API. |
| Monitoring | Health sweeps (default every 60 min), 5-minute uptime pings, a check right after each deploy, CPU/RAM/network charts, and a check of the actual page and the endpoints it calls. Apps that do not answer HTTP (bots, workers) are judged by container events and logs. |
| Troubleshooting | The AI SRE gets logs, events, metrics, deploy status, history of past actions and read-only access to the source. It returns one verdict, verified evidence (quotes must exist in the data) and one proposal: an action, a code patch, an env variable to set, "wait", or a manual fix with the exact reason. |
| Human in the loop | Sensitive actions (restart, plan change, delete, deploy of a patch) create an approval with what / why / impact. Results and errors are shown, and the result is re-checked. |

## Architecture

```
Browser (Next.js App Router, RTL)
  └─ Route handlers (server only: the Liara token and AI key never reach the browser)
      lib/liara/        typed Liara REST client (Bearer token, ?teamID, retries, error normalization)
      lib/ai/sre.ts     the decision engine: evidence + options + source tools → one validated Decision
      lib/ai/*.ts       llm (any OpenAI-compatible API), agent + tools (risk-tagged), classify, architect (multi-part plan)
      lib/analyzer/     project detection, preflight checks, platform-vs-code rules
      lib/monitor/      diagnose, web check, uptime + scheduler, deploy watcher, liara.online status
      lib/stack/        multi-part detection and executor (network → databases → apps → env → deploy)
      lib/fix/          dependency / code / upload fixes
      lib/store.ts      settings, approvals, audit log, reports, usage → .data/state.json
```

Principles: rules collect evidence, the model decides; every AI claim is checked against the evidence; every proposal is validated against real plan ids, release ids and ports; nothing runs without the approval rules in `lib/ai/tools.ts` (delete, stop and plan changes always need approval). An MCP server (`/api/mcp`, `scripts/mcp-stdio.mjs`) exposes the same tools to external assistants with the same gating.

## How it talks to Liara

Base `https://api.iran.liara.ir`, `Authorization: Bearer <token>`, `?teamID=` for teams. Set the token in `.env.local` or in Admin → Settings (the panel value wins; each field shows its source).

| Purpose | Endpoints |
| --- | --- |
| Apps | `/v1/projects` (list, create, delete), `.../actions/{scale,restart}`, `.../resize`, `.../update-envs`, port, flags |
| Deploy | `/v2/projects/{name}/sources` (upload `.tar.gz`) → `/v2/projects/{name}/releases`; release/build state and rollback |
| Observability | `.../logs`, `.../events`, `.../metrics/{cpu,memory,network-*}`, `.../reports/summary` |
| Databases | `/v1/databases` (create, get, delete), credentials and internal port |
| Account | `/v1/me` (plans, prices, database catalog), networks, balance |
| Platform status | `liara.online` (public status page) to tell "Liara has an incident" from "my app is broken" |

## How the user interacts

1. **Create app** → upload a zip → fix blockers with one click → review the plan and price → create and deploy (multi-part projects get the stack plan above).
2. **Overview** → short status from the last check; "بررسی عملکرد" runs a fresh AI check and shows cause, evidence and one proposed step.
3. **Approvals** (bell icon) → approve or reject sensitive actions; results appear on the card.
4. **Smart monitoring** per app → AI log, uptime bar, outages, platform status.
5. **Admin** → AI cost per call, AI provider and Liara connection settings with a connection test.

## Limitations

- The Liara API has no public plans endpoint (plans come from `/v1/me`), no per-request latency or HTTP metrics (the panel probes the site itself), no domain registrar/IRNIC API (domain steps are guidance only), and **hides the real build error** of failed builds. The AI then says so instead of guessing.
- The platform of an existing app cannot be changed; a wrong platform means creating the app again.
- Code patches and automatic dependency fixes are best on Node and Python projects; the syntax check is JavaScript only.
- No user accounts: it is a single-operator tool. Run it privately or behind your own access control. State is a local file (`.data/state.json`); on Liara, mount a disk there.
- Database schemas (MySQL/MariaDB) must be created by the app itself; only the server, credentials and network are created.
- Very old projects with rotten dependencies can still fail to build; the AI explains what it can see.

## Try it

`test-projects/` has ready zips with the edge cases the AI handles: wrong port, memory pressure (plan change), a CPU-bound app, and a full-stack app with a database; more cases (missing env variable, memory leak, dependency and syntax errors, PHP on the wrong platform, missing `requirements.txt`) are in `test-projects/archive/`.

## Deploy on Liara

Next.js platform, port 3000 (1 GB RAM or more recommended), one disk mounted on `.data`, env vars from `.env.example`. The monitor uses in-process timers, so run it as a normal always-on app.
