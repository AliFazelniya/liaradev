"use client";
export default function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition shrink-0 disabled:opacity-50 ${on ? "" : "bg-[#ffffff22]"}`} style={on ? { background: "var(--grad)" } : undefined}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "right-[1.375rem]" : "right-0.5"}`} />
    </button>
  );
}
