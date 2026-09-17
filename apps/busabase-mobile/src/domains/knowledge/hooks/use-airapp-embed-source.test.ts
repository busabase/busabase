// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSession } from "~/auth/session-store";
import { useAirAppEmbedSource } from "./use-airapp-embed-source";

type FocusCleanup = () => void;
type FocusCallback = () => FocusCleanup | undefined;

const mocks = vi.hoisted(() => ({
  getValidSession: vi.fn<() => Promise<CloudSession | null>>(),
  focusEffect: undefined as FocusCallback | undefined,
}));

vi.mock("expo-router", () => ({
  useFocusEffect: (callback: FocusCallback) => {
    mocks.focusEffect = callback;
  },
}));

vi.mock("~/auth/oauth", () => ({
  getValidBusabaseCloudSession: mocks.getValidSession,
}));

vi.mock("~/auth/session-store", () => ({
  getCloudSessionToken: (session: CloudSession | null) => session?.accessToken ?? null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Root[] = [];

const renderHook = <T>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);

  const HookHarness = () => {
    result.current = hook();
    return null;
  };

  act(() => root.render(createElement(HookHarness)));
  if (result.current === undefined) throw new Error("Hook did not render");
  return { result: result as { current: T } };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const cloudSession = (accessToken: string): CloudSession => ({
  accessToken,
  refreshToken: "bsr_test",
  expiresAt: "2099-01-01T00:00:00.000Z",
});

beforeEach(() => {
  mocks.getValidSession.mockReset();
  mocks.focusEffect = undefined;
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

describe("useAirAppEmbedSource", () => {
  it("clears the old source and reads a fresh session whenever the screen regains focus", async () => {
    const secondSession = deferred<CloudSession | null>();
    mocks.getValidSession
      .mockResolvedValueOnce(cloudSession("bso_first"))
      .mockReturnValueOnce(secondSession.promise);

    const { result } = renderHook(() =>
      useAirAppEmbedSource({
        connection: { mode: "cloud", serverUrl: "https://busabase.com" },
        spaceId: "spc_test",
        nodeId: "aap_test",
      }),
    );

    const cleanup: { current?: FocusCleanup } = {};
    await act(async () => {
      cleanup.current = mocks.focusEffect?.();
      await Promise.resolve();
    });
    expect(new URL(result.current.source?.uri as string).search).toBe("");
    expect(new URLSearchParams(result.current.source?.body).get("token")).toBe("bso_first");

    act(() => {
      cleanup.current?.();
      cleanup.current = mocks.focusEffect?.();
    });
    expect(result.current.source).toBeNull();
    expect(result.current.isPreparing).toBe(true);

    await act(async () => {
      secondSession.resolve(cloudSession("bso_second"));
      await secondSession.promise;
      await Promise.resolve();
    });
    expect(new URLSearchParams(result.current.source?.body).get("token")).toBe("bso_second");
    expect(mocks.getValidSession).toHaveBeenCalledTimes(2);

    cleanup.current?.();
  });
});
