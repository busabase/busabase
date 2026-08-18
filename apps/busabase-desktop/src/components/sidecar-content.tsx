"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { RefObject } from "react";

interface SidecarContentProps {
  appUrl: string | null;
  failed: boolean;
  frameRef: RefObject<HTMLIFrameElement | null>;
  message: string;
  onRetry: () => void;
}

export function SidecarContent({
  appUrl,
  failed,
  frameRef,
  message,
  onRetry,
}: SidecarContentProps) {
  if (appUrl) {
    return (
      <iframe
        ref={frameRef}
        title="Busabase"
        src={appUrl}
        className="busabase-frame"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
      />
    );
  }

  return (
    <section className="desktop-content">
      <div className="boot-panel">
        {failed ? <AlertTriangle size={30} /> : <Loader2 size={30} className="spin" />}
        <h2>{failed ? "Busabase is not ready" : "Starting Busabase"}</h2>
        <p>{message}</p>
        {failed ? (
          <div className="boot-actions">
            <button type="button" onClick={() => void onRetry()}>
              <RefreshCw size={16} />
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
