"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { VerifyButton } from "@/app/app/settings/voice-calling/verify-button";

interface ConnectionCardProps {
  connection: Record<string, unknown> | null;
  outboundNumbers: Array<{
    phoneNumber: string;
    telephonyProvider: string;
    source: "account" | "sip_trunk";
  }>;
  saveConnectionAction: (formData: FormData) => Promise<void>;
  disconnectAction: () => Promise<void>;
}

export function ConnectionCard({
  connection,
  outboundNumbers,
  saveConnectionAction,
  disconnectAction,
}: ConnectionCardProps) {
  const isConnected = Boolean(
    connection && connection.status !== "disconnected",
  );
  const isManaged = connection?.agent_management_mode === "managed";
  const [mode, setMode] = React.useState<"managed" | "external">(
    isManaged ? "managed" : connection?.agent_id ? "external" : "managed",
  );
  const [isPending, startTransition] = React.useTransition();

  const maskedAgentId = React.useMemo(() => {
    const id = String(connection?.agent_id ?? "");
    if (!id || id.startsWith("provisioning-")) return "";
    return id.length <= 8 ? `••••${id.slice(-2)}` : `••••••••-${id.slice(-6)}`;
  }, [connection?.agent_id]);

  function handleConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await saveConnectionAction(formData);
    });
  }

  function handleDisconnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      await disconnectAction();
    });
  }

  return (
    <Card className="border border-border/70 bg-card shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <span>🔗</span> Bolna Voice Connection
              {isConnected ? (
                <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ● Active
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  ○ Disconnected
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Connect your Bolna account with an API key. SalesEngAI will
              automatically provision and synchronize your voice qualification
              agent.
            </CardDescription>
          </div>
          {isConnected && (
            <form onSubmit={handleDisconnect}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={isPending}
                className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Disconnect
              </Button>
            </form>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isConnected && (
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground border border-border/50 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium text-foreground">
                {isManaged
                  ? "SalesEngAI Managed Agent"
                  : "External Custom Agent"}
              </span>
              {maskedAgentId && (
                <span className="ml-2 font-mono">({maskedAgentId})</span>
              )}
              <span className="ml-3">
                API Key ending in{" "}
                <span className="font-mono text-foreground">
                  ••••{String(connection?.api_key_last_four ?? "")}
                </span>
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Leave API key blank to keep saved credentials.
            </span>
          </div>
        )}

        <form onSubmit={handleConnect} className="space-y-4">
          {/* Agent Management Mode Selector */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
                mode === "managed"
                  ? "border-indigo-600 bg-indigo-50/10 ring-1 ring-indigo-600"
                  : "border-border bg-card/40 hover:bg-card/80"
              }`}
            >
              <input
                type="radio"
                name="management_mode"
                value="managed"
                checked={mode === "managed"}
                onChange={() => setMode("managed")}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="text-xs space-y-0.5">
                <span className="font-semibold text-foreground block">
                  Managed Agent (Recommended)
                </span>
                <span className="text-muted-foreground block text-[11px] leading-relaxed">
                  SalesEngAI creates, synchronizes, and configures the agent
                  automatically. No manual setup in Bolna needed.
                </span>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
                mode === "external"
                  ? "border-indigo-600 bg-indigo-50/10 ring-1 ring-indigo-600"
                  : "border-border bg-card/40 hover:bg-card/80"
              }`}
            >
              <input
                type="radio"
                name="management_mode"
                value="external"
                checked={mode === "external"}
                onChange={() => setMode("external")}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="text-xs space-y-0.5">
                <span className="font-semibold text-foreground block">
                  Connect Existing Bolna Agent ID
                </span>
                <span className="text-muted-foreground block text-[11px] leading-relaxed">
                  Use an existing agent you already configured manually in the
                  Bolna developer dashboard.
                </span>
              </div>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Bolna API Key
              </label>
              <Input
                name="api_key"
                type="password"
                autoComplete="new-password"
                placeholder={
                  isConnected
                    ? "Enter new API key (optional)"
                    : "Paste your Bolna API key"
                }
                className="h-9 text-xs"
              />
            </div>

            {mode === "external" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Existing Bolna Agent ID
                </label>
                <Input
                  name="agent_id"
                  autoComplete="off"
                  defaultValue={String(connection?.agent_id ?? "")}
                  placeholder="e.g. 3c90c3cc-0d44-4b50-8888-8dd25736052a"
                  className="h-9 text-xs font-mono"
                />
              </div>
            )}

            <div
              className={`space-y-1.5 ${mode === "external" ? "sm:col-span-2" : ""}`}
            >
              <label className="text-xs font-medium text-foreground flex items-center justify-between">
                <span>Outbound Caller ID (Optional)</span>
                <span className="text-[10px] text-muted-foreground">
                  Verified Bolna number
                </span>
              </label>
              {outboundNumbers.length > 0 ? (
                <select
                  name="from_phone"
                  defaultValue={String(connection?.from_phone_number ?? "")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs font-mono"
                >
                  <option value="">Use Bolna account default</option>
                  {outboundNumbers.map((number) => (
                    <option key={number.phoneNumber} value={number.phoneNumber}>
                      {number.phoneNumber} — {number.telephonyProvider} ({number.source === "sip_trunk" ? "SIP trunk" : "Bolna account"})
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  name="from_phone"
                  defaultValue={String(connection?.from_phone_number ?? "")}
                  placeholder="+911140001400 (optional)"
                  className="h-9 text-xs font-mono"
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                Customer-owned numbers must first be active in Bolna or attached
                to an active SIP trunk.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-muted-foreground">
              {mode === "managed"
                ? "API key will be securely encrypted. Agent settings are configured in the section below."
                : "Verify your agent ID to bind outbound qualification calls to it."}
            </span>
            <VerifyButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
