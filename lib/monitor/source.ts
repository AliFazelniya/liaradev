import { liara } from "../liara";
import { readTarGz, type Files } from "../analyzer/codebase";

const cache = new Map<string, { at: number; files: Files }>();

/** Source of the latest release that has one (cached 10 minutes: it is a download). */
export async function loadSource(project: string): Promise<Files | null> {
  try {
    const rel = (await liara().getReleases(project)).find((r) => r.sourceAvailable !== false);
    if (!rel) return null;
    const hit = cache.get(rel.id);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.files;
    const files = readTarGz(await liara().getReleaseSource(rel.id));
    cache.set(rel.id, { at: Date.now(), files });
    return files;
  } catch { return null; }
}
