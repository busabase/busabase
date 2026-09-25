// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_AGENT_RESULT, requestDesktopAgent } from "./desktop-codex";

describe("Desktop agent request bridge", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns null when there is no Desktop parent", async () => {
    await expect(requestDesktopAgent("claude-acp", "status", window)).resolves.toBeNull();
  });

  it("accepts only the matching response from the parent frame", async () => {
    const postMessage = vi.fn();
    const parent = { postMessage } as unknown as Window;
    const child = {
      parent,
      crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    } as unknown as Window;
    const request = requestDesktopAgent("claude-acp", "status", child);
    const id = postMessage.mock.calls[0]?.[0].requestId;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          type: DESKTOP_AGENT_RESULT,
          requestId: id,
          slug: "claude-acp",
          status: { installed: true },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parent,
        data: {
          type: DESKTOP_AGENT_RESULT,
          requestId: "wrong",
          slug: "claude-acp",
          status: { installed: true },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parent,
        data: {
          type: DESKTOP_AGENT_RESULT,
          requestId: id,
          slug: "codex-acp",
          status: { installed: true },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parent,
        data: {
          type: DESKTOP_AGENT_RESULT,
          requestId: id,
          slug: "claude-acp",
          status: { source: "managed", installed: false, codex: "missing" },
        },
      }),
    );
    await expect(request).resolves.toMatchObject({ installed: false, codex: "missing" });
  });
});
