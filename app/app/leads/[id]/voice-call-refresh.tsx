"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isTerminalVoiceExecutionStatus } from "@/lib/voice/outcome-state";

export function VoiceCallRefresh({ executionId, status, providerExecutionId }: {
  executionId: string;
  status: string;
  providerExecutionId: string | null;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const terminal = isTerminalVoiceExecutionStatus(status);

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
      // The server may already have persisted transcript artifacts before a
      // downstream qualification step failed. Show that progress and keep
      // polling until the app-owned execution reaches a terminal state.
      router.refresh();
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
