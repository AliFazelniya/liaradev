import { handle } from "@/lib/api";
import { liara } from "@/lib/liara";
import { getState, save } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Reports of apps that no longer exist (deleted here or in the console) are dropped, like their pending approvals. */
async function pruneOrphans() {
  const st = getState();
  if (!st.reports.length) return;
  try {
    const live = new Set((await liara().listProjects()).map((p) => p.project_id));
    const before = st.reports.length;
    st.reports = st.reports.filter((r) => live.has(r.project));
    if (st.reports.length !== before) save();
  } catch { /* Liara unreachable: keep everything */ }
}

export const GET = () => handle(async () => { await pruneOrphans(); const s = getState().settings; return { reports: [...getState().reports].reverse().slice(0, 60), monitorEnabled: s.monitorEnabled, every: s.monitorEveryMinutes }; });
