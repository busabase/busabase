"use client";

import { type RefObject, useCallback, useLayoutEffect, useState } from "react";
import {
  AIRAPP_BROWSER_CONSOLE_CHANNEL,
  AIRAPP_BROWSER_CONSOLE_ENTRY_LIMIT,
  AIRAPP_BROWSER_CONSOLE_LEVELS,
  AIRAPP_BROWSER_CONSOLE_MESSAGE_LIMIT,
} from "../utils/browser-console";

/** Accept console output only from this surface's current same-origin private preview. */
export function useAirAppBrowserLogs({
  frameRef,
  url,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  url: string | null;
}) {
  const [lines, setLines] = useState<string[]>([]);
  useLayoutEffect(() => {
    setLines([]);
    if (!url) return;
    let origin: string;
    try {
      const parsed = new URL(url, window.location.href);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.origin !== window.location.origin ||
        parsed.username ||
        parsed.password
      )
        return;
      origin = parsed.origin;
    } catch {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (
        !frameRef.current?.contentWindow ||
        event.source !== frameRef.current.contentWindow ||
        event.origin !== origin
      )
        return;
      const payload = event.data;
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        payload.channel !== AIRAPP_BROWSER_CONSOLE_CHANNEL ||
        !AIRAPP_BROWSER_CONSOLE_LEVELS.includes(payload.level) ||
        typeof payload.message !== "string" ||
        payload.message.length > AIRAPP_BROWSER_CONSOLE_MESSAGE_LIMIT
      )
        return;
      const line = `[${payload.level}] ${payload.message}\n`;
      setLines((previous) => [...previous.slice(-(AIRAPP_BROWSER_CONSOLE_ENTRY_LIMIT - 1)), line]);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, url]);
  const clear = useCallback(() => setLines([]), []);
  return { lines, clear };
}
