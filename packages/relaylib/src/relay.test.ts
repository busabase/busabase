import { describe, expect, it } from "vitest";
import {
  attachRelayClient,
  createFetchHandler,
  createMemoryRelayHub,
  type RelayRequest,
  type WebSocket,
} from "./index";

type Listener = (...args: unknown[]) => void;

/** Minimal in-memory stand-in for a `ws` socket, wired to a peer. */
class FakeSocket {
  readyState = 1;
  peer!: FakeSocket;
  private listeners = new Map<string, Listener[]>();

  on(event: string, cb: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  once(event: string, cb: Listener): this {
    const wrap: Listener = (...args) => {
      this.off(event, wrap);
      cb(...args);
    };
    return this.on(event, wrap);
  }

  off(event: string, cb: Listener): void {
    const list = this.listeners.get(event);
    if (list)
      this.listeners.set(
        event,
        list.filter((x) => x !== cb),
      );
  }

  send(data: string, cb?: (err?: Error) => void): void {
    queueMicrotask(() => this.peer.emit("message", data));
    cb?.();
  }

  close(): void {
    this.readyState = 3;
    queueMicrotask(() => this.emit("close"));
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const cb of [...(this.listeners.get(event) ?? [])]) cb(...args);
  }
}

function makePair(): readonly [WebSocket, WebSocket] {
  const a = new FakeSocket();
  const b = new FakeSocket();
  a.peer = b;
  b.peer = a;
  return [a as unknown as WebSocket, b as unknown as WebSocket];
}

describe("relaylib hub <-> client round trip", () => {
  it("streams a JSON response from the client handler back through the hub", async () => {
    const [hubSocket, clientSocket] = makePair();
    const hub = createMemoryRelayHub();
    hub.register("t1", hubSocket);
    attachRelayClient(
      clientSocket,
      (req) =>
        new Response(JSON.stringify({ ok: true, path: req.path }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await hub.request("t1", { method: "GET", path: "/api/v1/records" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, path: "/api/v1/records" });
  });

  it("round-trips binary intact via base64 chunks", async () => {
    const [hubSocket, clientSocket] = makePair();
    const hub = createMemoryRelayHub();
    hub.register("t2", hubSocket);
    const payload = new Uint8Array([0, 1, 2, 250, 255, 13, 10, 200]);
    attachRelayClient(clientSocket, () => new Response(payload, { status: 200 }));

    const res = await hub.request("t2", { method: "GET", path: "/blob" });
    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(Array.from(bytes)).toEqual(Array.from(payload));
  });

  it("round-trips unicode text in legacy utf8 chunk mode", async () => {
    const [hubSocket, clientSocket] = makePair();
    const hub = createMemoryRelayHub();
    hub.register("u1", hubSocket);
    attachRelayClient(clientSocket, () => new Response("héllo 世界 🌍"), {
      chunkEncoding: "utf8",
    });

    const res = await hub.request("u1", { method: "GET", path: "/" });

    expect(await res.text()).toBe("héllo 世界 🌍");
  });

  it("rejects when the tunnel is offline", async () => {
    const hub = createMemoryRelayHub();
    await expect(hub.request("missing", { method: "GET", path: "/" })).rejects.toThrow(
      /not connected/,
    );
  });

  it("propagates a handler error before the response starts", async () => {
    const [hubSocket, clientSocket] = makePair();
    const hub = createMemoryRelayHub();
    hub.register("t3", hubSocket);
    attachRelayClient(clientSocket, () => {
      throw new Error("boom");
    });

    await expect(hub.request("t3", { method: "GET", path: "/" })).rejects.toThrow(/boom/);
  });
});

describe("createFetchHandler", () => {
  it("forwards to the base URL with the request method", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const stubFetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response("hi", { status: 201 });
    }) as unknown as typeof fetch;

    const handler = createFetchHandler("http://localhost:9999", stubFetch);
    const res = await handler(
      {
        method: "POST",
        path: "/api/v1/x",
        body: { a: 1 },
      } satisfies RelayRequest,
      new AbortController().signal,
    );

    expect(res.status).toBe(201);
    expect(calls[0]?.url).toBe("http://localhost:9999/api/v1/x");
    expect(calls[0]?.method).toBe("POST");
  });
});

describe("cancellation", () => {
  it("rejects the pending request and never starts the handler when aborted before send resolves", async () => {
    const [hubSocket, clientSocket] = makePair();
    const hub = createMemoryRelayHub();
    hub.register("c1", hubSocket);
    let handlerCalled = false;
    attachRelayClient(clientSocket, async (_req, signal) => {
      handlerCalled = true;
      // Never resolves on its own — only settles via the signal, so the test
      // proves cancellation (not a coincidental fast handler) unblocks it.
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return new Response("unreachable");
    });

    const controller = new AbortController();
    const pending = hub.request("c1", { method: "GET", path: "/slow" }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/);
    // Let the "request" message's queued delivery flush before asserting.
    await new Promise((r) => setTimeout(r, 10));
    expect(handlerCalled).toBe(true);
  });

  it("aborts the daemon-side handler signal and cancels the body stream when the caller aborts mid-stream", async () => {
    const [hubSocket, clientSocket] = makePair();
    const hub = createMemoryRelayHub();
    hub.register("c2", hubSocket);

    let handlerSignal: AbortSignal | undefined;
    let streamCancelled = false;
    attachRelayClient(clientSocket, (_req, signal) => {
      handlerSignal = signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("first-chunk"));
        },
        cancel() {
          streamCancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    });

    const controller = new AbortController();
    const res = await hub.request("c2", { method: "GET", path: "/stream" }, controller.signal);
    expect(res.status).toBe(200);

    controller.abort();
    // Give the "cancel" message + the reader.cancel() teardown time to flush.
    await new Promise((r) => setTimeout(r, 10));

    expect(handlerSignal?.aborted).toBe(true);
    expect(streamCancelled).toBe(true);
  });
});
