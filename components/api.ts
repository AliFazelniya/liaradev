"use client";
import { useCallback, useEffect, useState } from "react";

export interface ApiError { error: string; status?: number; hint?: string; source?: string }

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({ error: "پاسخ نامعتبر از سرور" }));
  if (!res.ok) throw data as ApiError;
  return data as T;
}

export function useApi<T = any>(url: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!url) return;
    try { setData(await api<T>(url)); setError(null); } catch (e: any) { setError(e); } finally { setLoading(false); }
  }, [url]);
  useEffect(() => {
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, error, loading, reload: load };
}
