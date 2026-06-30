"use client";

import { Power, PowerOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as object);

// A small titlebar control that toggles "Launch Busabase at login" via the Tauri
// autostart plugin. Opt-in and reversible — disabled until we've read the current
// state so the icon never flickers a wrong value on first paint.
export function AutostartToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    void (async () => {
      try {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        setEnabled(await isEnabled());
      } catch (error) {
        console.error("[busabase-desktop] Autostart state check failed", error);
      }
    })();
  }, []);

  const toggle = useCallback(async () => {
    if (enabled === null || busy) {
      return;
    }
    setBusy(true);
    try {
      const { enable, disable, isEnabled } = await import("@tauri-apps/plugin-autostart");
      if (enabled) {
        await disable();
      } else {
        await enable();
      }
      setEnabled(await isEnabled());
    } catch (error) {
      console.error("[busabase-desktop] Autostart toggle failed", error);
    } finally {
      setBusy(false);
    }
  }, [enabled, busy]);

  // Hide entirely outside Tauri (e.g. the Next dev preview) where the plugin
  // isn't available — there's nothing to toggle.
  if (enabled === null || !isTauri()) {
    return null;
  }

  const label = enabled ? "Launch at login: on" : "Launch at login: off";

  return (
    <div className="desktop-autostart-control" data-autostart-enabled={enabled} role="status">
      <button
        type="button"
        className="desktop-autostart-button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-label={label}
        aria-pressed={enabled}
        title={label}
      >
        {enabled ? <Power aria-hidden="true" /> : <PowerOff aria-hidden="true" />}
      </button>
      <div className="desktop-autostart-popover">
        <span className="desktop-autostart-popover-title">Launch at login</span>
        <span className="desktop-autostart-popover-meta">
          {enabled ? "Busabase starts when you sign in" : "Off — start Busabase yourself"}
        </span>
      </div>
    </div>
  );
}
