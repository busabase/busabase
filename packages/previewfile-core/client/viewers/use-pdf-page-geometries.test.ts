import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type PdfDocument, usePdfPageGeometries } from "./use-pdf-page-geometries";

type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
const page = () => ({ getViewport: () => ({ width: 600, height: 1000 }) }) as unknown as PdfPage;

describe("PDF page metadata loading", () => {
  it("limits background reads to two and prioritizes an explicit destination", async () => {
    const pending = new Map<number, (value: PdfPage) => void>();
    const getPage = vi.fn(
      (pageNumber: number) =>
        new Promise<PdfPage>((resolve) => {
          pending.set(pageNumber, resolve);
        }),
    );
    const document = { numPages: 100, getPage } as unknown as PdfDocument;
    const { result, unmount } = renderHook(() => usePdfPageGeometries(document));
    const finish = (number: number) => {
      const resolve = pending.get(number);
      if (!resolve) throw new Error(`Page ${number} was not requested`);
      resolve(page());
    };
    expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2]);
    act(() => result.current.prioritize(100));
    expect(getPage).toHaveBeenCalledTimes(2);
    await act(async () => finish(1));
    expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 100]);
    await act(async () => finish(100));
    await waitFor(() => expect(result.current.geometries.has(100)).toBe(true));
    expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 100, 3]);
    unmount();
    await act(async () => finish(2));
    expect(getPage).toHaveBeenCalledTimes(4);
  });

  it("deduplicates repeated scroll priorities while favoring the most recently viewed page", async () => {
    const pending = new Map<number, (value: PdfPage) => void>();
    const getPage = vi.fn(
      (pageNumber: number) =>
        new Promise<PdfPage>((resolve) => {
          pending.set(pageNumber, resolve);
        }),
    );
    const document = { numPages: 100, getPage } as unknown as PdfDocument;
    const { result } = renderHook(() => usePdfPageGeometries(document));
    act(() => {
      result.current.prioritize(100);
      result.current.prioritize(80);
      result.current.prioritize(100);
      result.current.prioritize(100);
      result.current.prioritize(1);
    });
    const finishFirst = pending.get(1);
    if (!finishFirst) throw new Error("First page was not requested");
    await act(async () => finishFirst(page()));
    expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 100]);
    act(() => {
      result.current.prioritize(100);
      result.current.prioritize(100);
    });
    const finishLast = pending.get(100);
    if (!finishLast) throw new Error("Last page was not prioritized");
    await act(async () => finishLast(page()));
    expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 100, 80]);
  });

  it("commits measured sizes at most once per animation frame", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const getPage = vi.fn(async () => page());
      const document = { numPages: 1000, getPage } as unknown as PdfDocument;
      let renders = 0;
      const { result } = renderHook(() => {
        renders++;
        return usePdfPageGeometries(document);
      });
      await act(async () => {
        while (getPage.mock.calls.length < 1000) await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.geometries.size).toBe(0);
      expect(frames).toHaveLength(1);
      const before = renders;
      act(() => frames.shift()?.(0));
      expect(result.current.geometries.size).toBe(1000);
      expect(renders - before).toBe(1);
      expect(frames).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancels a pending commit when unmounted", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 7);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    try {
      const document = { numPages: 1, getPage: async () => page() } as unknown as PdfDocument;
      const { unmount } = renderHook(() => usePdfPageGeometries(document));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      unmount();
      expect(cancel).toHaveBeenCalledWith(7);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries a failed page without discarding other measured pages", async () => {
    const getPage = vi
      .fn<(page: number) => Promise<PdfPage>>()
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error("Page unavailable"))
      .mockResolvedValue(page());
    const document = { numPages: 2, getPage } as unknown as PdfDocument;
    const { result } = renderHook(() => usePdfPageGeometries(document));
    await waitFor(() => expect(result.current.errors.has(2)).toBe(true));
    expect(result.current.geometries.has(1)).toBe(true);
    act(() => result.current.retry(2));
    await waitFor(() => expect(result.current.geometries.has(2)).toBe(true));
    expect(result.current.errors.has(2)).toBe(false);
    expect(result.current.geometries.has(1)).toBe(true);
    expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 2]);
  });

  it("ignores stale reads after replacing a document", async () => {
    let finish: (value: PdfPage) => void = () => {};
    const first = {
      numPages: 1,
      getPage: () =>
        new Promise<PdfPage>((resolve) => {
          finish = resolve;
        }),
    } as unknown as PdfDocument;
    const second = {
      numPages: 1,
      getPage: async () =>
        ({ getViewport: () => ({ width: 1200, height: 600 }) }) as unknown as PdfPage,
    } as unknown as PdfDocument;
    const { result, rerender } = renderHook(({ document }) => usePdfPageGeometries(document), {
      initialProps: { document: first },
    });
    rerender({ document: second });
    await waitFor(() => expect(result.current.geometries.get(1)?.width).toBe(1200));
    await act(async () => finish(page()));
    expect(result.current.geometries.get(1)?.width).toBe(1200);
  });
});
