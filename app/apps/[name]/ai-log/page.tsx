"use client";
import { use } from "react";
import { HealthPanel, HistoryPanel } from "@/components/panels";

export default function AiLog({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  return (
    <div className="space-y-4">
      <h2 className="font-bold text-lg">مانیتورینگ هوشمند</h2>
      <HealthPanel project={name} />
      <HistoryPanel project={name} />
    </div>
  );
}
