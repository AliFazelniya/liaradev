/** The verdict shown to the user: the rule-based severity, raised when the AI found a verified problem the rules did not. */
export function effectiveSeverity(d: { severity: "ok" | "warning" | "critical"; settling?: boolean }, dec?: { verdict?: string; confidence?: number; unverified?: boolean } | null) {
  if (dec?.verdict === "issue" && !dec.unverified && (dec.confidence ?? 0) >= 0.6 && d.severity === "ok") return { severity: "warning" as const, settling: false };
  return { severity: d.severity, settling: !!d.settling && d.severity === "ok" };
}
