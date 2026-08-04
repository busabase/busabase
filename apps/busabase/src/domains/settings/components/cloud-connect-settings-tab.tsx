"use client";

import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { CloudOff, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";
import { isDesktopCloudConnectReturn, openExternalViaDesktopShell } from "../utils/desktop-shell";

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
// No `noopener`/`noreferrer` here — both make `window.open()` return `null`
// unconditionally per spec (https://html.spec.whatwg.org/multipage/nav-history-apis.html),
// which would make the popup-blocked check below fire on every click. We need
// the live reference anyway, to navigate it once the authorize URL is fetched
// and to close it on error.
const POPUP_FEATURES = "width=520,height=680";

async function fetchStatus(errorMessage: string): Promise<CloudConnectStatusResponse> {
  const res = await fetch("/api/cloud-connect/status");
  if (!res.ok) throw new Error(errorMessage);
  return (await res.json()) as CloudConnectStatusResponse;
}

export function CloudConnectSettingsTab({ labels, active }: Props) {
  const [snapshot, setSnapshot] = useState<CloudConnectStatusResponse | null>(null);
  const [cloudUrlInput, setCloudUrlInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  /** Desktop shell path: sign-in continues in the OS browser, not in an in-app popup. */
  const [handedOffToBrowser, setHandedOffToBrowser] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const hasEditedCloudUrl = useRef(false);
  const connectFailedMessage = labels.connectFailed();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await fetchStatus(connectFailedMessage);
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
  }, [active, connectFailedMessage]);

  // Desktop shell path: the OS browser finished sign-in and deep linked back
  // into `apps/busabase-desktop`, which raised its window and forwarded the
  // result here. Refresh right away rather than making the user watch a stale
  // "waiting in your browser" state until the next 2s poll tick.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isDesktopCloudConnectReturn(event)) return;
      setHandedOffToBrowser(false);
      void fetchStatus(connectFailedMessage)
        .then(setSnapshot)
        .catch(() => {
          // Transient — the regular poll will catch up.
        });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [connectFailedMessage]);

  const status = snapshot?.status ?? "disconnected";
  const isBusy = status === "connecting" || isConnecting || isDisconnecting;

  const handleConnect = async () => {
    setActionError(null);
    setHandedOffToBrowser(false);
    setIsConnecting(true);
    // Open the popup synchronously, still within the click gesture — opening it only after
    // the `await fetch` below resolves loses the "direct result of a user gesture" status
    // browsers require and gets silently blocked (esp. Safari). Navigate it once we know
    // the authorize URL instead of opening it with a URL up front.
    //
    // A `null` here is NOT necessarily a blocked popup: inside the Busabase Desktop shell
    // the Tauri webview implements no `window.open()` at all and always returns `null`, so
    // we first offer the URL to the shell (which opens the OS browser) and only report
    // "popup blocked" when nothing took it. See `../utils/desktop-shell`.
    const popup = window.open("", "busabase-cloud-connect", POPUP_FEATURES);
    try {
      const res = await fetch("/api/cloud-connect/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No popup means sign-in will happen outside this page — in the desktop
        // shell, in the OS browser. Tell the server now, while the pending flow
        // is created, so its callback page can deep link the user back to the
        // desktop window instead of asking them to close an uncloseable tab.
        body: JSON.stringify({ cloudUrl: cloudUrlInput, returnToDesktop: popup === null }),
      });
      const body = (await res.json()) as { authorizeUrl?: string; error?: string };
      if (!res.ok || !body.authorizeUrl) {
        throw new Error(body.error ?? labels.connectFailed());
      }
      if (popup) {
        popup.location.href = body.authorizeUrl;
      } else {
        const outcome = await openExternalViaDesktopShell(body.authorizeUrl);
        if (outcome === "failed") throw new Error(labels.connectFailed());
        if (outcome === "unavailable") {
          setActionError(labels.popupBlocked());
          return;
        }
        setHandedOffToBrowser(true);
      }
      hasEditedCloudUrl.current = false;
      setSnapshot((current) => (current ? { ...current, status: "connecting" } : current));
    } catch (error) {
      popup?.close();
      setActionError(error instanceof Error ? error.message : labels.connectFailed());
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setActionError(null);
    setHandedOffToBrowser(false);
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/cloud-connect/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(labels.disconnectFailed());
      const next = await fetchStatus(labels.statusRefreshFailed());
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
          <AlertDescription>
            {actionError ??
              (snapshot?.error
                ? labels.statusDiagnostic({ error: snapshot.error })
                : connectFailedMessage)}
          </AlertDescription>
        </Alert>
      ) : null}

      {handedOffToBrowser && status !== "connected" ? (
        <Alert>
          <AlertDescription>{labels.signInInBrowser()}</AlertDescription>
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
