import { afterEach, describe, expect, it, vi } from "vitest";
import { TEXT_ATTACHMENT_MAX_BYTES } from "./text-preview";
import { readTextAttachment } from "./use-text-preview";

const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("bounded original text reads", () => {
  it("uses UTF-8 even when HTTP declares a different charset", async () => {
    const bytes = new TextEncoder().encode("# 审计结果\r\n中文 / 日本語 / 🧪\r\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(bytes, {
          headers: { "content-type": "text/plain; charset=windows-1252" },
        }),
      ),
    );
    await expect(readTextAttachment("/legacy.md", signal())).resolves.toBe(
      "# 审计结果\r\n中文 / 日本語 / 🧪\r\n",
    );
  });

  it("reports an HTTP failure instead of rendering its error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("permission denied", { status: 403 })),
    );
    await expect(readTextAttachment("/legacy.md", signal())).rejects.toMatchObject({
      kind: "failed",
    });
  });

  it("rejects a declared oversized response without reading its body", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          headers: { "content-length": String(TEXT_ATTACHMENT_MAX_BYTES + 1) },
        }),
      ),
    );
    await expect(readTextAttachment("/legacy.md", signal())).rejects.toMatchObject({
      kind: "tooLarge",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, "1"])(
    "cancels a growing stream past the byte limit with content-length %s",
    async (length) => {
      const cancel = vi.fn();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(TEXT_ATTACHMENT_MAX_BYTES).fill(65));
          controller.enqueue(new Uint8Array([66]));
        },
        cancel,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(stream, {
            headers: length ? { "content-length": length } : {},
          }),
        ),
      );
      await expect(readTextAttachment("/legacy.md", signal())).rejects.toMatchObject({
        kind: "tooLarge",
      });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("accepts the exact byte limit and an empty file", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(TEXT_ATTACHMENT_MAX_BYTES).fill(65)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await readTextAttachment("/limit.md", signal())).length).toBe(
      TEXT_ATTACHMENT_MAX_BYTES,
    );
    await expect(readTextAttachment("/empty.md", signal())).resolves.toBe("");
  });

  it("detects an encoding failure split across chunks and cancels the unread stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xe4, 0xb8]));
        controller.enqueue(new Uint8Array([0xff]));
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(readTextAttachment("/invalid.md", signal())).rejects.toMatchObject({
      kind: "encoding",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reports a response stream that fails after receiving some bytes", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.error(new Error("Disconnected"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(readTextAttachment("/failed.md", signal())).rejects.toThrow("Disconnected");
  });
});
