"use client";

import { Download, RefreshCw, RotateCcw } from "lucide-react";
import type { BusabaseUpdateStatus } from "../hooks/use-desktop-updater";

interface DesktopUpdateControlProps {
  message: string | null;
  onInstall: () => void;
  status: BusabaseUpdateStatus;
  version?: string;
  visible: boolean;
}

export function DesktopUpdateControl({
  message,
  onInstall,
  status,
  version,
  visible,
}: DesktopUpdateControlProps) {
  if (!visible) return null;

  const title = getUpdateTitle(status);
  const meta =
    status === "available" ? (version ? `Version ${version}` : "Ready to install") : message;
  const canInstall = status === "available" || status === "error";

  return (
    <div className="desktop-update-control" data-update-status={status} role="status">
      <button
        type="button"
        className="desktop-update-button"
        onClick={() => void onInstall()}
        disabled={!canInstall}
        aria-label={title}
        title={title}
      >
        {status === "available" ? (
          <Download aria-hidden="true" />
        ) : status === "up-to-date" || status === "installed" || status === "error" ? (
          <RotateCcw aria-hidden="true" />
        ) : (
          <RefreshCw className="desktop-update-button-spin" aria-hidden="true" />
        )}
      </button>
      <div className="desktop-update-popover">
        <span className="desktop-update-popover-title">{title}</span>
        {meta ? <span className="desktop-update-popover-meta">{meta}</span> : null}
      </div>
    </div>
  );
}

const getUpdateTitle = (status: BusabaseUpdateStatus) => {
  if (status === "checking") return "Checking for updates";
  if (status === "up-to-date") return "Busabase Desktop is up to date";
  if (status === "available") return "New version available";
  if (status === "downloading") return "Installing update";
  if (status === "installed") return "Restarting Busabase Desktop";
  return "Update failed";
};
