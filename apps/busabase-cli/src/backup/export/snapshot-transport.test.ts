import { describe, expect, it } from "vitest";
import { withStrictSnapshotTransport } from "./snapshot-transport.js";

function streamed(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const path = "http://127.0.0.1/api/v1/dump/export/snapshot";
describe("snapshot wire framing", () => {
  it("keeps valid replacement characters and split emoji/CJK bytes exactly", async () => {
    const bytes = Buffer.from('event: message\ndata: {"text":"�🙂中文"}\n\n');
    const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
    const response = await withStrictSnapshotTransport(async () => streamed(chunks))(path);
    if (!response.body) throw new Error("Missing fixture response body");
    const reader = response.body.getReader();
    const first = await reader.read();
    if (first.done) throw new Error("Missing fixture frame");
    expect(Buffer.from(first.value)).toEqual(bytes);
    expect((await reader.read()).done).toBe(true);
  });
  it.each([[Uint8Array.of(0xff)], [Uint8Array.of(0xe4, 0xb8)]])(
    "rejects invalid or truncated UTF-8",
    async (chunk) => {
      const response = await withStrictSnapshotTransport(async () => streamed([chunk]))(path);
      await expect(response.arrayBuffer()).rejects.toThrow(/UTF-8/);
    },
  );
  it("fails instead of truncating a frame above its explicit bound", async () => {
    const response = await withStrictSnapshotTransport(
      async () => streamed([Buffer.from('data: "0123456789"\n\n')]),
      12,
    )(path);
    await expect(response.arrayBuffer()).rejects.toThrow(/exceeds 12/);
  });
  it("passes unrelated endpoints and error statuses through unchanged", async () => {
    const response = new Response(Uint8Array.of(0xff), { status: 403 });
    expect(await withStrictSnapshotTransport(async () => response)(path)).toBe(response);
    const plain = new Response(Uint8Array.of(0xff));
    expect(
      await withStrictSnapshotTransport(async () => plain)("http://127.0.0.1/api/v1/nodes"),
    ).toBe(plain);
  });
});

it("normalizes CRLF frames split at every byte without changing JSON content", async () => {
  const bytes = Buffer.from('event: message\r\ndata: {"text":"literal\\r\\n �🙂"}\r\n\r\n');
  const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
  const response = await withStrictSnapshotTransport(async () => streamed(chunks))(path);
  expect(await response.text()).toBe('event: message\ndata: {"text":"literal\\r\\n �🙂"}\n\n');
});
it.each([
  "event: message\ndata: {}",
  "event: done\ndata: null\n\ntruncated-tail",
  "event: done\ndata: null\n\nevent: message\ndata: {}\n\n",
])("rejects an incomplete frame or data following terminal SSE", async (text) => {
  const response = await withStrictSnapshotTransport(async () => streamed([Buffer.from(text)]))(
    path,
  );
  await expect(response.arrayBuffer()).rejects.toThrow(/inside an SSE frame|after the terminal/);
});

it("checks the same final event field as the SDK before accepting terminal EOF", async () => {
  const response = await withStrictSnapshotTransport(async () =>
    streamed([Buffer.from("event:\tdone\ndata: null\n\nnon-empty-tail")]),
  )(path);
  await expect(response.arrayBuffer()).rejects.toThrow(/inside an SSE frame|after the terminal/);
  const actual = await withStrictSnapshotTransport(async () =>
    streamed([
      Buffer.from("event: done\nevent: message\ndata: {}\n\n"),
      new Uint8Array(),
      Buffer.from("event: done\ndata: null\n\n"),
    ]),
  )(path);
  expect(await actual.text()).toContain("event: done\nevent: message");
});

it("does not hide unsupported data frames from the protocol validator", async () => {
  const unknown = await withStrictSnapshotTransport(async () =>
    streamed([Buffer.from('event: unknown\ndata: {"ignored":true}\n\n')]),
  )(path);
  await expect(unknown.arrayBuffer()).rejects.toThrow(/unsupported SSE data event/);
  const defaults = await withStrictSnapshotTransport(async () =>
    streamed([Buffer.from('data: {"type":"start"}\n\n')]),
  )(path);
  expect(await defaults.text()).toBe('event: message\ndata: {"type":"start"}\n\n');
});
