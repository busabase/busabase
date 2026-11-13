import { eventIterator } from "@orpc/contract";
import { os } from "@orpc/server";
import { ErrorEvent, withEventMeta } from "@orpc/standard-server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBusabaseOpenApiHandler } from "../src/openapi/handler";
import { snapshotEventStream } from "../src/openapi/snapshot-event-stream";

const readAll = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder("utf8", { fatal: true });
  let text = "";
  let largest = 0;
  for await (const chunk of stream) {
    largest = Math.max(largest, chunk.byteLength);
    text += decoder.decode(chunk, { stream: true });
  }
  return { text: text + decoder.decode(), largest };
};

describe("bounded snapshot SSE encoding", () => {
  it("keeps UTF-8 and metadata exact while requesting no next event until the current frame is consumed", async () => {
    const payload = { type: "rows", rowsJson: `[{"value":"${'🙂中文\\"'.repeat(100_000)}"}]` };
    const iterator = (async function* () {
      yield withEventMeta(payload, { id: "event-1", retry: 100, comments: ["proof"] });
    })();
    const next = vi.spyOn(iterator, "next");
    const stream = snapshotEventStream(iterator);
    const reader = stream.getReader();
    const decoder = new TextDecoder("utf8", { fatal: true });
    expect(decoder.decode((await reader.read()).value)).toBe(": \n\n");
    expect(next).not.toHaveBeenCalled();
    let text = "";
    for (let index = 0; index < 2; index++) {
      const chunk = (await reader.read()).value;
      expect(chunk?.byteLength).toBeLessThanOrEqual(3 * 64 * 1024);
      text += decoder.decode(chunk, { stream: true });
      expect(next).toHaveBeenCalledTimes(1);
    }
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    expect(text).toBe(
      `: proof\nevent: message\nretry: 100\nid: event-1\ndata: ${JSON.stringify(payload)}\n\n`,
    );
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("sends keepalive comments without advancing an unresolved iterator twice", async () => {
    let release!: (value: IteratorResult<unknown>) => void;
    const next = vi.fn(
      () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          release = resolve;
        }),
    );
    const done = vi.fn(async () => ({ done: true as const, value: undefined }));
    const reader = snapshotEventStream(
      { next, return: done },
      { keepAliveInterval: 5 },
    ).getReader();
    await reader.read();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": \n\n");
    expect(next).toHaveBeenCalledTimes(1);
    release({ done: false, value: { type: "start" } });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      'data: {"type":"start"}',
    );
    await reader.cancel();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("returns the iterator immediately when cancelled during a pending next", async () => {
    let finish!: (value: IteratorResult<unknown>) => void;
    const next = vi.fn(
      () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          finish = resolve;
        }),
    );
    const done = vi.fn(async () => {
      finish({ done: true, value: undefined });
      return { done: true as const, value: undefined };
    });
    const reader = snapshotEventStream({ next, return: done }).getReader();
    await reader.read();
    const pending = reader.read();
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    await reader.cancel();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("preserves error frames, terminal return values and unexpected transport errors", async () => {
    const error = withEventMeta(
      new ErrorEvent({ data: { code: "PRECONDITION_FAILED", message: "正文�" } }),
      { id: "failed" },
    );
    const failed = await readAll(
      snapshotEventStream({
        next: async () => {
          throw error;
        },
      }),
    );
    expect(failed.text).toBe(
      ': \n\nevent: error\nid: failed\ndata: {"code":"PRECONDITION_FAILED","message":"正文�"}\n\n',
    );
    const completed = await readAll(
      snapshotEventStream({ next: async () => ({ done: true, value: { result: true } }) }),
    );
    expect(completed.text).toBe(': \n\nevent: done\ndata: {"result":true}\n\n');
    await expect(
      readAll(
        snapshotEventStream({
          next: async () => {
            throw new Error("transport failed");
          },
        }),
      ),
    ).rejects.toThrow("transport failed");
  });
  it("uses bounded encoding only for the snapshot endpoint and preserves ordinary SSE", async () => {
    const route = (url: string) =>
      os
        .route({ method: "POST", path: url })
        .input(z.object({}))
        .output(eventIterator(z.unknown()))
        .handler(async function* () {
          yield { kept: "中文🙂" };
        });
    const handler = createBusabaseOpenApiHandler({
      snapshot: route("/api/v1/dump/export/snapshot"),
      ordinary: route("/api/v1/ordinary-events"),
    });
    const original = globalThis.TextEncoderStream;
    let encoders = 0;
    vi.stubGlobal(
      "TextEncoderStream",
      class extends original {
        constructor() {
          super();
          encoders++;
        }
      },
    );
    try {
      for (const url of ["/api/v1/dump/export/snapshot", "/api/v1/ordinary-events"]) {
        const result = await handler.handle(
          new Request(`http://test${url}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
          { context: {} },
        );
        if (!result.matched) throw new Error("Test route was not matched");
        expect(result.response.status).toBe(200);
        expect(result.response.headers.get("content-type")).toBe("text/event-stream");
        expect(await result.response.text()).toBe(
          ': \n\nevent: message\ndata: {"kept":"中文🙂"}\n\n',
        );
        expect(encoders).toBe(url.includes("ordinary") ? 1 : 0);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
