"use client";
import { ApprovalsPanel, HealthPanel } from "@/components/panels";

export default function Approvals() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">تأییدیه‌ها</h1>
      <ApprovalsPanel />
      <h2 className="text-lg font-bold pt-2">مانیتورینگ هوشمند (همه‌ی برنامه‌ها)</h2>
      <HealthPanel />
    </div>
  );
}
