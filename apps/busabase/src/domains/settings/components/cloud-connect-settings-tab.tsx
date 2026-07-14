"use client";

import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { CloudOff, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";

export type CloudConnectSettingsLabels = TranslationFunctions["cloudConnect"];

interface Props {
  labels: CloudConnectSettingsLabels;
  /** Whether this tab is the active one — gates polling. */
  active: boolean;
}

type TunnelStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

interface CloudConnectStatusResponse {
  tunnelId: string;
  cloudUrl: string;
  connected: boolean;
  status: TunnelStatus;
  error: string | null;
}

const POLL_INTERVAL_MS = 2000;
const POPUP_FEATURES = "width=520,height=680,noopener,noreferrer";

async function fetchStatus(): Promise<CloudConnectStatusResponse> {
  const res = await fetch("/api/cloud-connect/status");
  if (!res.ok) throw new Error(`Status request failed (HTTP ${res.status})`);
  return (await res.json()) as CloudConnectStatusResponse;
}

export function CloudConnectSettingsTab({ labels, active }: Props) {
  const [snapshot, setSnapshot] = useState<CloudConnectStatusResponse | null>(null);
  const [cloudUrlInput, setCloudUrlInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const hasEditedCloudUrl = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await fetchStatus();
        if (cancelled) return;
        setSnapshot(next);
        if (!hasEditedCloudUrl.current) setCloudUrlInput(next.cloudUrl);
      } catch {
        // Transient — the next poll tick will retry.
      }
    };

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  const status = snapshot?.status ?? "disconnected";
  const isBusy = status === "connecting" || isConnecting || isDisconnecting;

  const handleConnect = async () => {
    setActionError(null);
    setIsConnecting(true);
    try {
      const res = await fetch("/api/cloud-connect/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cloudUrl: cloudUrlInput }),
      });
      const body = (await res.json()) as { authorizeUrl?: string; error?: string };
      if (!res.ok || !body.authorizeUrl) {
        throw new Error(body.error ?? labels.connectFailed());
      }
      const popup = window.open(body.authorizeUrl, "busabase-cloud-connect", POPUP_FEATURES);
      if (!popup) {
        throw new Error(labels.popupBlocked());
      }
      hasEditedCloudUrl.current = false;
      setSnapshot((current) => (current ? { ...current, status: "connecting" } : current));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : labels.connectFailed());
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setActionError(null);
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/cloud-connect/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(labels.disconnectFailed());
      const next = await fetchStatus();
      setSnapshot(next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : labels.disconnectFailed());
    } finally {
      setIsDisconnecting(false);
    }
  };

  const statusBadge = () => {
    switch (status) {
      case "connected":
        return (
          <Badge variant="outline" className="gap-1 border-green-500/50 text-green-600">
            <ShieldCheck className="h-3 w-3" />
            {labels.statusConnected()}
          </Badge>
        );
      case "connecting":
        return (
          <Badge variant="outline" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {labels.statusConnecting()}
          </Badge>
        );
      case "reconnecting":
        return (
          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600">
            <RefreshCw className="h-3 w-3 animate-spin" />
            {labels.statusReconnecting()}
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="gap-1">
            <CloudOff className="h-3 w-3" />
            {labels.statusError()}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <CloudOff className="h-3 w-3" />
            {labels.statusDisconnected()}
          </Badge>
        );
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{labels.title()}</AlertTitle>
        <AlertDescription>{labels.description()}</AlertDescription>
      </Alert>

      <div className="flex items-center justify-between gap-2">
        <Label className="text-muted-foreground text-xs">{labels.statusLabel()}</Label>
        {statusBadge()}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cloud-connect-url">{labels.cloudUrlLabel()}</Label>
        <Input
          id="cloud-connect-url"
          value={cloudUrlInput}
          disabled={status === "connected" || status === "reconnecting" || isBusy}
          onChange={(event) => {
            hasEditedCloudUrl.current = true;
            setCloudUrlInput(event.target.value);
          }}
          placeholder="https://busabase.com"
        />
      </div>

      {snapshot?.tunnelId ? (
        <div className="text-muted-foreground text-xs">
          {labels.tunnelIdLabel()}: <code>{snapshot.tunnelId}</code>
        </div>
      ) : null}

      {(actionError || snapshot?.error) && status !== "connected" ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError ?? snapshot?.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        {status === "connected" || status === "connecting" || status === "reconnecting" ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
          >
            {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {labels.disconnectButton()}
          </Button>
        ) : (
          <Button type="button" onClick={handleConnect} disabled={isBusy}>
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {labels.connectButton()}
          </Button>
        )}
      </div>

      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">{labels.aboutTitle()}</div>
        <div>{labels.aboutDescription()}</div>
      </div>
    </div>
  );
}
