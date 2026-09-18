"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const terminalStatuses = new Set([
  "completed", "failed", "cancelled", "canceled", "no-answer", "busy",
  "stopped", "error", "balance-low",
]);

export function VoiceCallRefresh({ executionId, status, providerStatus, providerExecutionId }: {
  executionId: string;
  status: string;
  providerStatus: string | null;
  providerExecutionId: string | null;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const currentStatus = (providerStatus || status).toLowerCase();
  const terminal = terminalStatuses.has(status.toLowerCase()) || terminalStatuses.has(currentStatus);

  const refresh = useCallback(async () => {
    if (!providerExecutionId || running.current) return false;
    running.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/voice/executions/${executionId}/refresh`, {
        method: "POST",
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | { terminal?: boolean; error?: string; reason?: string }
        | null;
      if (!response.ok) throw new Error(body?.error || body?.reason || `Refresh failed (${response.status})`);
      router.refresh();
      return Boolean(body?.terminal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh call details.");
      return false;
    } finally {
      running.current = false;
      setRefreshing(false);
    }
  }, [executionId, providerExecutionId, router]);

  useEffect(() => {
    if (!providerExecutionId || terminal) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const finished = await refresh();
      if (!cancelled && !finished) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [providerExecutionId, refresh, terminal]);

  if (!providerExecutionId) return null;
  return (
    <div className="mt-3 space-y-1">
      <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
        {refreshing ? "Fetching call details…" : terminal ? "Refresh call details" : "Check call status now"}
      </Button>
      {!terminal && <p className="text-xs text-muted-foreground">Status and transcript refresh automatically while this page is open.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
