// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbedUiCopy } from "../utils/embed-ui-copy";
import { useEmbedLifecycle } from "./use-embed-lifecycle";

const START = new Date("2026-11-18T00:00:00.000Z").getTime();
let queryClient: QueryClient;

function Page({ expiresAt = new Date(START + 60_000).toISOString() }) {
  const lifecycle = useEmbedLifecycle({
    publicId: "emb_Abcdefghijklmno1",
    secret: "s".repeat(43),
    expiresAt,
    queryClient,
  });
  const copy = getEmbedUiCopy("zh-CN");
  return lifecycle.terminal ? (
    <main>{lifecycle.state === "expired" ? copy.expired : copy.unavailable}</main>
  ) : (
    <>
      <main>Reading position 51–100</main>
      {lifecycle.state === "disconnected" && (
        <button onClick={lifecycle.retry} type="button">
          {copy.retry}
        </button>
      )}
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ state: "active" })));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = async () =>
  act(async () => {
    await Promise.resolve();
  });

describe("an already-open Embed's lifetime", () => {
  it("uses its own credential for a same-origin status call without member cookies", async () => {
    render(<Page />);
    await flush();
    expect(fetch).toHaveBeenCalledWith(
      "/embed/emb_Abcdefghijklmno1/status",
      expect.objectContaining({
        credentials: "omit",
        headers: { "x-busabase-embed-capability": `emb_Abcdefghijklmno1.${"s".repeat(43)}` },
      }),
    );
  });

  it("removes content and its cache when a heartbeat confirms revocation", async () => {
    queryClient.setQueryData(["records"], ["private row"]);
    render(<Page />);
    await flush();
    vi.mocked(fetch).mockResolvedValue(Response.json({ state: "unavailable" }, { status: 404 }));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.queryByText("Reading position 51–100")).toBeNull();
    expect(screen.getByText("内容不可用")).toBeDefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    const calls = vi.mocked(fetch).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it("expires on the verified deadline even with an unreachable status endpoint", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
    render(<Page expiresAt={new Date(START + 1_000).toISOString()} />);
    await flush();
    expect(screen.getByText("Reading position 51–100")).toBeDefined();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText("链接已过期")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["offline", "server unavailable"])(
    "preserves reading position after %s, then recovers on retry",
    async (failure) => {
      if (failure === "offline") vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
      else vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 503 }));
      queryClient.setQueryData(["records"], ["keep me"]);
      render(<Page />);
      await flush();
      expect(screen.getByText("Reading position 51–100")).toBeDefined();
      expect(queryClient.getQueryData(["records"])).toEqual(["keep me"]);
      await act(async () => screen.getByRole("button", { name: "重试" }).click());
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByText("Reading position 51–100")).toBeDefined();
    },
  );

  it("ignores a delayed successful heartbeat after expiry and cancels pending data", async () => {
    let finishStatus: ((response: Response) => void) | undefined;
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options?.signal ?? undefined;
      return new Promise((resolve) => {
        finishStatus = resolve;
      });
    });
    let finishData: ((data: string) => void) | undefined;
    void queryClient
      .fetchQuery({
        queryKey: ["late"],
        queryFn: () =>
          new Promise<string>((resolve) => {
            finishData = resolve;
          }),
      })
      .catch(() => {});
    render(<Page expiresAt={new Date(START + 1_000).toISOString()} />);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finishStatus?.(Response.json({ state: "active" }));
      finishData?.("secret late response");
    });
    expect(screen.getByText("链接已过期")).toBeDefined();
    expect(queryClient.getQueryData(["late"])).toBeUndefined();
  });

  it("aborts probes and removes timers when the reader closes the page", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
      );
    });
    const view = render(<Page />);
    await act(async () => view.unmount());
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
