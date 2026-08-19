import {
  DESKTOP_OPEN_EXTERNAL_REQUEST,
  DESKTOP_OPEN_EXTERNAL_RESULT,
  openExternalViaDesktopShell,
} from "busabase-core/domains/settings/desktop-shell";
import { describe, expect, it } from "vitest";

/**
 * The desktop shell (`apps/busabase-desktop`) embeds this app in an iframe inside a
 * Tauri webview, where `window.open()` always returns `null`. Cloud Connect therefore
 * asks the shell to open the authorize URL in the OS browser. These tests pin the
 * message contract both sides implement.
 */

interface PostedMessage {
  message: { type?: string; requestId?: string; url?: string };
  targetOrigin: string;
}

/** Minimal stand-in for the pieces of `Window` the bridge touches. */
function createFakeWindow(options: { framed: boolean }) {
  const posted: PostedMessage[] = [];
  const listeners = new Set<(event: MessageEvent) => void>();

  const win = {
    posted,
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message") listeners.delete(listener);
    },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (handle: number) => clearTimeout(handle),
    listenerCount: () => listeners.size,
    /** Simulate the shell answering. */
    reply: (source: unknown, data: unknown) => {
      for (const listener of [...listeners]) {
        listener({ source, data } as MessageEvent);
      }
    },
  } as unknown as Window & {
    posted: PostedMessage[];
    listenerCount: () => number;
    reply: (source: unknown, data: unknown) => void;
  };

  const parent = options.framed
    ? ({
        postMessage: (message: PostedMessage["message"], targetOrigin: string) => {
          posted.push({ message, targetOrigin });
        },
      } as unknown as Window)
    : win;

  Object.defineProperty(win, "parent", { value: parent, writable: false });
  return { win, parent };
}

describe("openExternalViaDesktopShell", () => {
  it("reports `unavailable` without posting when the app is not framed", async () => {
    const { win } = createFakeWindow({ framed: false });

    await expect(openExternalViaDesktopShell("https://busabase.com/x", win)).resolves.toBe(
      "unavailable",
    );
    expect(win.posted).toHaveLength(0);
  });

  it("reports `opened` and cleans up when the shell confirms it opened the URL", async () => {
    const { win, parent } = createFakeWindow({ framed: true });

    const pending = openExternalViaDesktopShell("https://busabase.com/oauth/authorize?x=1", win);

    expect(win.posted.length).toBeGreaterThan(0);
    const request = win.posted[0]?.message;
    expect(request?.type).toBe(DESKTOP_OPEN_EXTERNAL_REQUEST);
    expect(request?.url).toBe("https://busabase.com/oauth/authorize?x=1");
    expect(win.posted).toHaveLength(1);

    win.reply(parent, {
      type: DESKTOP_OPEN_EXTERNAL_RESULT,
      requestId: request?.requestId,
      ok: true,
    });

    await expect(pending).resolves.toBe("opened");
    expect(win.listenerCount()).toBe(0);
  });

  it("stays pending on a reply from another frame or another request", async () => {
    const { win, parent } = createFakeWindow({ framed: true });

    const pending = openExternalViaDesktopShell("https://busabase.com/x", win);
    const requestId = win.posted[0]?.message.requestId;

    // Wrong source (some other frame spoofing a success).
    win.reply({}, { type: DESKTOP_OPEN_EXTERNAL_RESULT, requestId, ok: true });
    // Right source, stale request id.
    win.reply(parent, { type: DESKTOP_OPEN_EXTERNAL_RESULT, requestId: "stale", ok: true });

    expect(win.listenerCount()).toBe(1);

    // The shell answering "I tried and could not" is distinct from "no shell here",
    // so the tab can avoid telling a desktop user to allow popups.
    win.reply(parent, { type: DESKTOP_OPEN_EXTERNAL_RESULT, requestId, ok: false });
    await expect(pending).resolves.toBe("failed");
  });
});
