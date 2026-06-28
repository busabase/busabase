"use client";

import { Minus, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

// A slim window titlebar for the Busabase desktop shell. The window content is an
// iframe of the local sidecar, so — unlike buda-desktop, which overlays drag strips
// on its own native routes — we render a real top bar that owns the drag region and
// keeps the macOS traffic lights from sitting on top of the embedded web app.
//
//  - macOS:        native traffic lights float into the left of the bar (positioned
//                  by `trafficLightPosition` in tauri.conf.json); the bar itself is
//                  the drag region. No custom buttons (the OS draws close/min/zoom).
//  - Windows/Linux: there are no native controls with a hidden titlebar, so we draw
//                  our own minimize / maximize / close buttons on the right.
interface DesktopTitlebarProps {
  actions?: ReactNode;
}

export function DesktopTitlebar({ actions }: DesktopTitlebarProps) {
  const [platform, setPlatform] = useState<"macos" | "custom" | null>(null);

  useEffect(() => {
    setPlatform(isMacLikePlatform() ? "macos" : "custom");
  }, []);

  const isMac = platform === "macos";
  const hasCustomControls = platform === "custom";

  return (
    <div className="desktop-titlebar-bar" data-tauri-drag-region>
      <span
        className={
          isMac ? "desktop-titlebar-brand desktop-titlebar-brand-macos" : "desktop-titlebar-brand"
        }
      >
        Busabase
      </span>
      {actions ? <div className="desktop-titlebar-actions">{actions}</div> : null}
      {hasCustomControls ? (
        <div className="desktop-window-controls" role="toolbar" aria-label="Window controls">
          <button
            type="button"
            className="desktop-window-control-button"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => void handleWindowAction("minimize")}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="desktop-window-control-button"
            aria-label="Maximize window"
            title="Maximize"
            onClick={() => void handleWindowAction("toggleMaximize")}
          >
            <Square aria-hidden="true" />
          </button>
          <button
            type="button"
            className="desktop-window-control-button desktop-window-control-button-close"
            aria-label="Close window"
            title="Close"
            onClick={() => void handleWindowAction("close")}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

async function handleWindowAction(action: "close" | "minimize" | "toggleMaximize") {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();

  if (action === "minimize") {
    await currentWindow.minimize();
    return;
  }

  if (action === "toggleMaximize") {
    await currentWindow.toggleMaximize();
    return;
  }

  await currentWindow.close();
}

function isMacLikePlatform() {
  const platform = window.navigator.platform.toLowerCase();
  const userAgent = window.navigator.userAgent;

  return platform.includes("mac") || /Macintosh|Mac OS X|Mac OS/.test(userAgent);
}
