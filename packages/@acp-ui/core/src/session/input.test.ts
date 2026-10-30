import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AcpInputBlock, AcpUiEvent } from "../reduce";
import type { AcpSessionPort } from "./types";
import { useAcpSession } from "./use-acp-session";

const request: AcpUiEvent = {
  type: "input_request",
  requestId: "input",
  message: "Choose",
  requestedSchema: { type: "object", properties: { answer: { type: "string" } } },
};
function fixture(answerInput: NonNullable<AcpSessionPort["answerInput"]>) {
  let onEvent = (_event: AcpUiEvent) => {};
  const port: AcpSessionPort = {
    start: async () => "session",
    subscribe: (_session, next) => {
      onEvent = next;
      return () => {};
    },
    prompt: async () => {},
    answerPermission: async () => true,
    answerInput,
  };
  return { port, emit: (event: AcpUiEvent) => onEvent(event) };
}

describe("structured input submission", () => {
  it("disables duplicate stale clicks and resolves only after the host acknowledges", async () => {
    let accept: (value: boolean) => void = () => {};
    const answer = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const { port, emit } = fixture(answer);
    const { result } = renderHook(() => useAcpSession(port, "session"));
    await waitFor(() => expect(result.current.sessionId).toBe("session"));
    act(() => emit(request));
    const block = result.current.blocks[0] as AcpInputBlock;
    act(() => {
      void result.current.answerInput(block, { action: "accept", content: { answer: "yes" } });
      void result.current.answerInput(block, { action: "decline" });
    });
    expect(answer).toHaveBeenCalledTimes(1);
    expect(result.current.blocks[0]).toMatchObject({ resolution: "answering" });
    await act(async () => accept(true));
    expect(result.current.blocks[0]).toMatchObject({
      resolution: { action: "accept", content: { answer: "yes" } },
    });
  });
  it("keeps a failed request pending with an error so the user can retry", async () => {
    const answer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce(true);
    const { port, emit } = fixture(answer);
    const { result } = renderHook(() => useAcpSession(port, "session"));
    await waitFor(() => expect(result.current.sessionId).toBe("session"));
    act(() => emit(request));
    await act(async () =>
      result.current.answerInput(result.current.blocks[0] as AcpInputBlock, {
        action: "accept",
        content: { answer: "yes" },
      }),
    );
    expect(result.current.blocks[0]).toMatchObject({
      resolution: "pending",
      error: "Disconnected",
    });
    await act(async () =>
      result.current.answerInput(result.current.blocks[0] as AcpInputBlock, {
        action: "accept",
        content: { answer: "yes" },
      }),
    );
    expect(result.current.blocks[0]).toMatchObject({ resolution: { action: "accept" } });
  });
  it("does not modify another conversation when an old response arrives", async () => {
    let accept: (value: boolean) => void = () => {};
    const { port, emit } = fixture(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    let number = 0;
    port.start = async () => `session-${++number}`;
    const { result, rerender } = renderHook(({ key }) => useAcpSession(port, key), {
      initialProps: { key: "first" },
    });
    await waitFor(() => expect(result.current.sessionId).toBe("session-1"));
    act(() => emit(request));
    act(() => {
      void result.current.answerInput(result.current.blocks[0] as AcpInputBlock, {
        action: "accept",
      });
    });
    rerender({ key: "second" });
    await waitFor(() => expect(result.current.sessionId).toBe("session-2"));
    await act(async () => accept(true));
    expect(result.current.blocks).toEqual([]);
  });
});

describe("cancellation during permission acknowledgement", () => {
  it("does not restore a cancelled card when an in-flight response returns too late", async () => {
    let settle: (value: boolean) => void = () => {};
    const { port, emit } = fixture(async () => true);
    port.answerPermission = () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      });
    const { result } = renderHook(() => useAcpSession(port, "session"));
    await waitFor(() => expect(result.current.sessionId).toBe("session"));
    act(() =>
      emit({
        type: "permission_request",
        requestId: "permission",
        title: "Run?",
        options: [{ optionId: "yes", name: "Allow" }],
      }),
    );
    const permission = result.current.blocks[0];
    if (permission.kind !== "permission") throw new Error("Expected permission");
    act(() => {
      void result.current.answerPermission(permission, "yes");
    });
    act(() => emit({ type: "permission_cancelled", requestId: "permission" }));
    await act(async () => settle(false));
    expect(result.current.blocks[0]).toMatchObject({ resolution: "cancelled" });
  });
});

describe("ambiguous delivery retries", () => {
  it("retries the recorded answer even if a caller supplies a different value after a lost ACK", async () => {
    const answer = vi.fn().mockRejectedValueOnce(new Error("ACK lost")).mockResolvedValueOnce(true);
    const { port, emit } = fixture(answer);
    const { result } = renderHook(() => useAcpSession(port, "session"));
    await waitFor(() => expect(result.current.sessionId).toBe("session"));
    act(() => emit(request));
    await act(async () =>
      result.current.answerInput(result.current.blocks[0] as AcpInputBlock, {
        action: "accept",
        content: { answer: "original" },
      }),
    );
    expect(result.current.blocks[0]).toMatchObject({
      confirmationUnknown: true,
      submittedResponse: { content: { answer: "original" } },
    });
    await act(async () =>
      result.current.answerInput(result.current.blocks[0] as AcpInputBlock, {
        action: "accept",
        content: { answer: "changed" },
      }),
    );
    expect(answer.mock.calls[1][2]).toEqual({ action: "accept", content: { answer: "original" } });
    expect(result.current.blocks[0]).toMatchObject({
      resolution: { action: "accept", content: { answer: "original" } },
      confirmationUnknown: false,
    });
  });
});

describe("permission delivery scope", () => {
  it("blocks duplicate stale clicks and ignores an old conversation's late failure", async () => {
    let reject: (error: Error) => void = () => {};
    const answer = vi.fn(
      () =>
        new Promise<boolean>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { port, emit } = fixture(async () => true);
    let number = 0;
    port.start = async () => `session-${++number}`;
    port.answerPermission = answer;
    const { result, rerender } = renderHook(({ key }) => useAcpSession(port, key), {
      initialProps: { key: "first" },
    });
    await waitFor(() => expect(result.current.sessionId).toBe("session-1"));
    act(() =>
      emit({
        type: "permission_request",
        requestId: "p",
        title: "Allow?",
        options: [
          { optionId: "yes", name: "Allow" },
          { optionId: "no", name: "Reject" },
        ],
      }),
    );
    const block = result.current.blocks[0];
    if (block.kind !== "permission") throw new Error("Expected permission");
    act(() => {
      void result.current.answerPermission(block, "yes");
      void result.current.answerPermission(block, "no");
    });
    expect(answer).toHaveBeenCalledTimes(1);
    rerender({ key: "second" });
    await waitFor(() => expect(result.current.sessionId).toBe("session-2"));
    await act(async () => reject(new Error("Old delivery failed")));
    expect(result.current.blocks).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
