"use client";
export default function Confirm({ title, body, busy, onYes, onNo, yesLabel = "بله، اجرا کن", danger }: { title: string; body?: string; busy?: boolean; onYes: () => void; onNo: () => void; yesLabel?: string; danger?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-[60] p-4">
      <div className="card p-6 max-w-md w-full space-y-4">
        <h3 className="font-bold text-lg">{title}</h3>
        {body && <p className="leading-7 text-[#ddd] whitespace-pre-line">{body}</p>}
        <div className="flex gap-2 justify-end">
          <button className="btn" onClick={onNo} disabled={busy}>انصراف</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onYes} disabled={busy}>{busy ? "در حال اجرا…" : yesLabel}</button>
        </div>
      </div>
    </div>
  );
}
