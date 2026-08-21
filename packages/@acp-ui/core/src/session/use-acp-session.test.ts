import { act, render, waitFor } from "@testing-library/react";
import { createElement, StrictMode, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AcpAttachment, AcpMessageBlock, AcpPermissionBlock, AcpUiEvent } from "../reduce";
import type { AcpSessionPort, AcpSessionState } from "./types";
import { useAcpSession } from "./use-acp-session";

/**
 * A stand-in for a host's transport. Deliberately configurable along the axes
 * where acprouter and busabase genuinely differ — who echoes the user's prompt,
 * whether persisted history is offered — so the same tests cover both shapes.
 */
function makePort(over: Partial<AcpSessionPort> = {}) {
  const emit: { current: ((event: AcpUiEvent) => void) | null } = { current: null };
  const calls = {
    start: 0,
    prompt: [] as string[],
    promptAttachments: [] as (readonly AcpAttachment[] | undefined)[],
    cancel: [] as string[],
    end: 0,
    unsubscribe: 0,
  };
  const port: AcpSessionPort = {
    start: async () => {
      calls.start += 1;
      return "s1";
    },
    subscribe: (_id, onEvent) => {
      emit.current = onEvent;
      return () => {
        calls.unsubscribe += 1;
        emit.current = null;
      };
    },
    prompt: async (_id, text, attachments) => {
      calls.prompt.push(text);
      calls.promptAttachments.push(attachments);
    },
    answerPermission: async () => true,
    cancel: async (id: string) => {
      calls.cancel.push(id);
    },
    end: () => {
      calls.end += 1;
    },
    ...over,
  };
  return { port, emit, calls };
}

/**
 * Renders the hook and exposes its latest state to the test.
 *
 * `createElement` rather than JSX so this file stays a `.ts`: `@acp-ui/core`
 * asserts it contains no `.tsx` anywhere in `src/`, and that invariant is worth
 * more than the readability of two call sites.
 */
function mount(port: AcpSessionPort, key: string | null = "agent-1", strict = false) {
  const seen: { current: AcpSessionState | null } = { current: null };
  function Probe({ sessionKey }: { sessionKey: string | null }) {
    const state = useAcpSession(port, sessionKey);
    useEffect(() => {
      seen.current = state;
    });
    seen.current = state;
    return null;
  }
  const element = createElement(Probe, { sessionKey: key });
  const utils = render(strict ? createElement(StrictMode, null, element) : element);
  return { seen, ...utils };
}

const agentChunk = (text: string): AcpUiEvent => ({
  type: "session_update",
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } as never,
});

describe("session lifecycle", () => {
  it("starts a session and exposes its id", async () => {
    const { port } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
  });

  // The bug real end-to-end verification caught in acprouter: `start()` spawns a
  // real agent process, and StrictMode's deliberate double-mount fired two of
  // them for one opened sheet.
  it("starts exactly one session under React StrictMode", async () => {
    const { port, calls } = makePort();
    const { seen } = mount(port, "agent-1", true);
    // StrictMode mounts the effect, cleans it up, and mounts it again in the
    // same tick. Both halves of the guard are under test: only one `start()`,
    // AND the surviving mount still ends up with the session that was created
    // (the synthetic first cleanup must not discard it).
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    expect(calls.start).toBe(1);
  });

  // The race real-agent verification caught, which the plain StrictMode test
  // above cannot: `start()` was still in flight when StrictMode's synthetic
  // cleanup aborted the first invocation's controller. The resolved start then
  // ran `follow` under that DEAD controller — against a port that honours the
  // abort signal (busabase's does; it hands it to its oRPC subscribe call),
  // the subscription died instantly and the transcript stayed blank forever.
  // Two properties matter: the surviving invocation subscribes, and it does so
  // with a signal that is NOT already aborted.
  it("subscribes with a live signal when StrictMode remounts during a slow start", async () => {
    let releaseStart: (() => void) | null = null;
    const subscribeSignals: boolean[] = [];
    const emit: { current: ((event: AcpUiEvent) => void) | null } = { current: null };
    const { port } = makePort({
      start: () =>
        new Promise<string>((resolve) => {
          releaseStart = () => resolve("s1");
        }),
      subscribe: (_id, onEvent, signal) => {
        subscribeSignals.push(signal.aborted);
        // A signal-honouring port delivers nothing on a dead subscription.
        if (!signal.aborted) emit.current = onEvent;
        return () => {
          emit.current = null;
        };
      },
    });
    const { seen } = mount(port, "agent-1", true);
    // Both StrictMode invocations have mounted; only now does start resolve.
    await act(async () => {
      releaseStart?.();
    });
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await waitFor(() => expect(subscribeSignals.length).toBeGreaterThan(0));
    // Every subscription that was actually established saw a live signal.
    expect(subscribeSignals).not.toContain(true);
    // And it is genuinely wired: a live event reaches the transcript.
    act(() => emit.current?.(agentChunk("alive")));
    await waitFor(() => expect(seen.current?.blocks).toHaveLength(1));
  });

  it("surfaces a start failure instead of hanging", async () => {
    const { port } = makePort({
      start: async () => {
        throw new Error("agent unreachable");
      },
    });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.error).toBe("agent unreachable"));
  });

  it("unsubscribes and ends the session on unmount", async () => {
    const { port, calls } = makePort();
    const { seen, unmount } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    unmount();
    expect(calls.unsubscribe).toBe(1);
    expect(calls.end).toBe(1);
  });
});

describe("events", () => {
  it("reduces live events into blocks", async () => {
    const { port, emit } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => {
      emit.current?.(agentChunk("Hello "));
      emit.current?.(agentChunk("world"));
    });
    await waitFor(() => expect(seen.current?.blocks).toHaveLength(1));
    expect((seen.current?.blocks[0] as { text: string }).text).toBe("Hello world");
  });

  // acprouter already persists every event and already exposes the endpoint —
  // its UI just never called it, so closing the sheet lost the conversation.
  it("folds persisted history before live events", async () => {
    const { port, emit } = makePort({
      history: async () => [agentChunk("from history")],
    });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.blocks).toHaveLength(1));
    act(() => emit.current?.(agentChunk(" then live")));
    await waitFor(() =>
      expect((seen.current?.blocks[0] as { text: string }).text).toBe("from history then live"),
    );
  });

  it("still works live when history fails to load", async () => {
    const { port, emit } = makePort({
      history: async () => {
        throw new Error("history endpoint down");
      },
    });
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(agentChunk("live")));
    await waitFor(() => expect(seen.current?.blocks).toHaveLength(1));
    expect(seen.current?.error).toBeNull();
  });

  it("marks the session ended on a terminal note", async () => {
    const { port, emit } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.({ type: "note", text: "timed out", ended: true }));
    await waitFor(() => expect(seen.current?.ended).toBe(true));
  });
});

describe("prompting", () => {
  // A real difference between the hosts, not a style choice.
  it("echoes the user's prompt locally when the server does not (acprouter)", async () => {
    const { port } = makePort({ serverEchoesPrompt: false });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await act(async () => {
      await seen.current?.sendPrompt("hi there");
    });
    expect(seen.current?.blocks).toMatchObject([
      { kind: "message", role: "user", text: "hi there" },
    ]);
  });

  it("does not echo when the server already does (busabase)", async () => {
    const { port } = makePort({ serverEchoesPrompt: true });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await act(async () => {
      await seen.current?.sendPrompt("hi there");
    });
    expect(seen.current?.blocks).toEqual([]);
  });

  it("reports a failed prompt and stops sending", async () => {
    const { port } = makePort({
      prompt: async () => {
        throw new Error("relay dropped");
      },
    });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await act(async () => {
      await seen.current?.sendPrompt("hi");
    });
    expect(seen.current?.error).toBe("relay dropped");
    expect(seen.current?.sending).toBe(false);
  });

  it("ignores a prompt once the session has ended", async () => {
    const { port, emit, calls } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.({ type: "note", text: "over", ended: true }));
    await waitFor(() => expect(seen.current?.ended).toBe(true));
    await act(async () => {
      await seen.current?.sendPrompt("still there?");
    });
    expect(calls.prompt).toEqual([]);
  });
});

describe("attachments", () => {
  const image: AcpAttachment = { kind: "image", data: "abc123", mimeType: "image/png" };

  it("passes attachments through to the port's prompt call", async () => {
    const { port, calls } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await act(async () => {
      await seen.current?.sendPrompt("here's a screenshot", [image]);
    });
    expect(calls.promptAttachments[0]).toEqual([image]);
  });

  it("echoes an attachment locally, on the same block as the text, when the server does not", async () => {
    const { port } = makePort({ serverEchoesPrompt: false });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await act(async () => {
      await seen.current?.sendPrompt("here's a screenshot", [image]);
    });
    expect(seen.current?.blocks).toHaveLength(1);
    const block = seen.current?.blocks[0] as AcpMessageBlock;
    expect(block.text).toBe("here's a screenshot");
    expect(block.attachments).toEqual([image]);
  });

  it("does not echo an attachment when the server already echoes the prompt", async () => {
    const { port } = makePort({ serverEchoesPrompt: true });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await act(async () => {
      await seen.current?.sendPrompt("here's a screenshot", [image]);
    });
    expect(seen.current?.blocks).toEqual([]);
  });

  it("sends text with no attachments the same way as before — the param is optional", async () => {
    const { port, calls } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    await act(async () => {
      await seen.current?.sendPrompt("just text");
    });
    expect(calls.promptAttachments[0]).toBeUndefined();
  });
});

describe("usage and title", () => {
  const usageUpdate = (used: number): AcpUiEvent => ({
    type: "session_update",
    update: { sessionUpdate: "usage_update", used, size: 1_000_000 } as never,
  });
  const sessionInfoUpdate = (title: string | null): AcpUiEvent => ({
    type: "session_update",
    update: { sessionUpdate: "session_info_update", title } as never,
  });

  it("starts null before the agent has sent either", async () => {
    const { port } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    expect(seen.current?.usage).toBeNull();
    expect(seen.current?.title).toBeNull();
  });

  it("picks up usage and title from live events", async () => {
    const { port, emit } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => {
      emit.current?.(usageUpdate(500));
      emit.current?.(sessionInfoUpdate("A conversation about tea"));
    });
    await waitFor(() => expect(seen.current?.usage).toEqual({ used: 500, size: 1_000_000 }));
    expect(seen.current?.title).toBe("A conversation about tea");
  });

  it("keeps only the most recent usage as more arrive", async () => {
    const { port, emit } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => {
      emit.current?.(usageUpdate(100));
      emit.current?.(usageUpdate(200));
      emit.current?.(usageUpdate(300));
    });
    await waitFor(() => expect(seen.current?.usage?.used).toBe(300));
  });

  it("does not let unrelated events touch usage or title", async () => {
    const { port, emit } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(agentChunk("just a normal reply")));
    await waitFor(() => expect(seen.current?.blocks).toHaveLength(1));
    expect(seen.current?.usage).toBeNull();
    expect(seen.current?.title).toBeNull();
  });

  it("folds usage and title from persisted history on open", async () => {
    const { port } = makePort({
      history: async () => [usageUpdate(1000), sessionInfoUpdate("Reopened session")],
    });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.usage?.used).toBe(1000));
    expect(seen.current?.title).toBe("Reopened session");
  });

  // ACP's own schema: "Set to null to clear" — an explicit clear must
  // actually clear, not be mistaken for "this update didn't mention title."
  it("clears the title when the agent explicitly sends title: null", async () => {
    const { port, emit } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(sessionInfoUpdate("First title")));
    await waitFor(() => expect(seen.current?.title).toBe("First title"));
    act(() => emit.current?.(sessionInfoUpdate(null)));
    await waitFor(() => expect(seen.current?.title).toBeNull());
  });
});

describe("cancel", () => {
  it("calls the port's cancel with the session id while a turn is in flight", async () => {
    let releasePrompt: (() => void) | null = null;
    const { port, calls } = makePort({
      prompt: () =>
        new Promise<void>((resolve) => {
          releasePrompt = resolve;
        }),
    });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));

    let sendPromptDone: Promise<void> | undefined;
    act(() => {
      sendPromptDone = seen.current?.sendPrompt("hi");
    });
    await waitFor(() => expect(seen.current?.sending).toBe(true));

    await act(async () => {
      await seen.current?.cancel();
    });
    expect(calls.cancel).toEqual(["s1"]);

    // Clean up the still-pending sendPrompt so it doesn't leak into the next test.
    await act(async () => {
      releasePrompt?.();
      await sendPromptDone;
    });
  });

  it("does nothing when no turn is in flight", async () => {
    const { port, calls } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));
    expect(seen.current?.sending).toBe(false);

    await act(async () => {
      await seen.current?.cancel();
    });
    expect(calls.cancel).toEqual([]);
  });

  // The port's `cancel` is optional (see AcpSessionPort's doc comment) — a
  // host with nothing to notify must not have the composer's stop button
  // throw.
  it("does nothing, and does not throw, when the port supplied no cancel", async () => {
    let releasePrompt: (() => void) | null = null;
    const { port } = makePort({
      prompt: () =>
        new Promise<void>((resolve) => {
          releasePrompt = resolve;
        }),
      cancel: undefined,
    });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));

    let sendPromptDone: Promise<void> | undefined;
    act(() => {
      sendPromptDone = seen.current?.sendPrompt("hi");
    });
    await waitFor(() => expect(seen.current?.sending).toBe(true));

    // Reaching the next line at all is the assertion: if `cancel()` had let
    // the missing port method throw, this `act()` call would itself throw
    // and fail the test.
    await act(async () => {
      await seen.current?.cancel();
    });

    await act(async () => {
      releasePrompt?.();
      await sendPromptDone;
    });
  });

  // Best-effort by design: the in-flight prompt() still resolves on its own
  // once the agent responds, whether or not the cancel notify itself landed.
  it("swallows an error from the port's cancel rather than surfacing it", async () => {
    let releasePrompt: (() => void) | null = null;
    const { port } = makePort({
      prompt: () =>
        new Promise<void>((resolve) => {
          releasePrompt = resolve;
        }),
      cancel: async () => {
        throw new Error("relay dropped");
      },
    });
    const { seen } = mount(port);
    await waitFor(() => expect(seen.current?.sessionId).toBe("s1"));

    let sendPromptDone: Promise<void> | undefined;
    act(() => {
      sendPromptDone = seen.current?.sendPrompt("hi");
    });
    await waitFor(() => expect(seen.current?.sending).toBe(true));

    await act(async () => {
      await seen.current?.cancel();
    });
    expect(seen.current?.error).toBeNull();

    await act(async () => {
      releasePrompt?.();
      await sendPromptDone;
    });
  });
});

describe("permissions", () => {
  const request: AcpUiEvent = {
    type: "permission_request",
    requestId: "p1",
    title: "Delete build/?",
    options: [
      { optionId: "yes", name: "Allow", kind: "allow_once" },
      { optionId: "no", name: "Reject", kind: "reject_once" },
    ],
  };
  const pending = (state: AcpSessionState | null) =>
    state?.blocks.find((b) => b.kind === "permission") as AcpPermissionBlock | undefined;

  it("disables the card optimistically, before the round trip finishes", async () => {
    let release: (() => void) | null = null;
    const { port, emit } = makePort({
      answerPermission: () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    });
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(request));
    await waitFor(() => expect(pending(seen.current)).toBeTruthy());

    const block = pending(seen.current) as AcpPermissionBlock;
    act(() => {
      void seen.current?.answerPermission(block, "yes");
    });
    await waitFor(() => expect(pending(seen.current)?.resolution).toBe("answering"));
    await act(async () => {
      release?.();
    });
  });

  // acprouter's 5-minute server-side timeout can fire first. Showing a choice
  // that was never applied is worse than putting the card back.
  it("restores the card when the answer arrived too late", async () => {
    const { port, emit } = makePort({ answerPermission: async () => false });
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(request));
    await waitFor(() => expect(pending(seen.current)).toBeTruthy());

    const block = pending(seen.current) as AcpPermissionBlock;
    await act(async () => {
      await seen.current?.answerPermission(block, "yes");
    });
    expect(pending(seen.current)?.resolution).toBe("pending");
  });

  it("restores the card and reports the error when the call throws", async () => {
    const { port, emit } = makePort({
      answerPermission: async () => {
        throw new Error("network down");
      },
    });
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(request));
    await waitFor(() => expect(pending(seen.current)).toBeTruthy());

    const block = pending(seen.current) as AcpPermissionBlock;
    await act(async () => {
      await seen.current?.answerPermission(block, "yes");
    });
    expect(pending(seen.current)?.resolution).toBe("pending");
    expect(seen.current?.error).toBe("network down");
  });

  // busabase deliberately never auto-approves. Nothing in this hook may answer
  // unprompted, and a second click on an in-flight card must not send twice.
  it("never answers on its own, and refuses a second click", async () => {
    const answer = vi.fn(async () => true);
    const { port, emit } = makePort({ answerPermission: answer });
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(request));
    await waitFor(() => expect(pending(seen.current)).toBeTruthy());
    expect(answer).not.toHaveBeenCalled();

    const block = pending(seen.current) as AcpPermissionBlock;
    await act(async () => {
      await seen.current?.answerPermission(block, "yes");
    });
    // The same (now stale, still "pending"-typed) block clicked again must not
    // produce a second call once the live block has moved on.
    const current = pending(seen.current) as AcpPermissionBlock;
    await act(async () => {
      await seen.current?.answerPermission(current, "no");
    });
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it("lets the real resolved event win over the optimistic state", async () => {
    const { port, emit } = makePort();
    const { seen } = mount(port);
    await waitFor(() => expect(emit.current).toBeTruthy());
    act(() => emit.current?.(request));
    await waitFor(() => expect(pending(seen.current)).toBeTruthy());

    const block = pending(seen.current) as AcpPermissionBlock;
    await act(async () => {
      await seen.current?.answerPermission(block, "yes");
    });
    act(() => emit.current?.({ type: "permission_resolved", requestId: "p1", optionId: "yes" }));
    await waitFor(() => expect(pending(seen.current)?.resolution).toEqual({ optionId: "yes" }));
  });
});

describe("no conversation yet", () => {
  // busabase renders the agent panel before any session exists, and starting
  // one is an explicit user action there — the hook must not start one itself.
  it("starts nothing when the key is null", async () => {
    const { port, calls } = makePort();
    const { seen } = mount(port, null);
    await waitFor(() => expect(seen.current).toBeTruthy());
    expect(calls.start).toBe(0);
    expect(seen.current?.sessionId).toBeNull();
    expect(seen.current?.blocks).toEqual([]);
  });
});
