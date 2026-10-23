/**
 * The browser runtime probe, held to the comments in the templates'
 * `app/js/runtime.js` — each pins one rule a copy of that file once broke.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AIRAPP_RUNTIME_PATH,
  AIRAPP_RUNTIME_UNKNOWN,
  detectAirAppRuntime,
  normalizeAirAppRuntime,
  shouldUseLocalAirAppGateway,
} from "./airapp-browser-runtime";
import { describeBusabaseAirAppRuntime } from "./airapp-node";

const jsonResponse = (body: unknown, init: { status?: number; type?: string } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "application/json; charset=utf-8" },
  });

const fetchReturning = (response: Response | Promise<Response>) =>
  vi.fn<typeof fetch>(async () => response);

describe("detectAirAppRuntime", () => {
  it("probes the relative path, asking for JSON", async () => {
    const doFetch = fetchReturning(jsonResponse({ runtime: "local", hosted: true }));
    await detectAirAppRuntime({ fetch: doFetch });
    const [url, init] = doFetch.mock.calls[0];
    // No leading slash: under the Local Node engine the app lives on a sub-path.
    expect(url).toBe("__airapp/runtime");
    expect(AIRAPP_RUNTIME_PATH.startsWith("/")).toBe(false);
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("takes `hosted` from the server, for an engine it has never heard of too", async () => {
    const runtime = await detectAirAppRuntime({
      fetch: fetchReturning(jsonResponse({ runtime: "engine-from-the-future", hosted: true })),
    });
    expect(runtime).toEqual({
      runtime: "engine-from-the-future",
      hosted: true,
      devProxy: false,
      determined: true,
    });
  });

  it("never derives `hosted` from the engine name", async () => {
    // A server that says `local` but `hosted: false` is believed. The browser has
    // no list of engine names to second-guess it with.
    const runtime = await detectAirAppRuntime({
      fetch: fetchReturning(jsonResponse({ runtime: "local", hosted: false })),
    });
    expect(runtime.hosted).toBe(false);
    expect(runtime.determined).toBe(true);
    // And a missing boolean is not hosted, whatever the name.
    expect(normalizeAirAppRuntime({ runtime: "browser" }).hosted).toBe(false);
  });

  it("reads a standalone run, and its dev proxy as a separate axis", async () => {
    const runtime = await detectAirAppRuntime({
      fetch: fetchReturning(jsonResponse({ runtime: "standalone", hosted: false, devProxy: true })),
    });
    expect(runtime).toEqual({
      runtime: "standalone",
      hosted: false,
      devProxy: true,
      determined: true,
    });
  });

  it("is unknown for an HTML shell answered with 200", async () => {
    const html = new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    expect(await detectAirAppRuntime({ fetch: fetchReturning(html) })).toEqual(
      AIRAPP_RUNTIME_UNKNOWN,
    );
    // The content-type is what decides, not whether the body happens to parse: a
    // 200 that is not declared JSON is never read as an answer.
    const notDeclaredJson = new Response(JSON.stringify({ runtime: "local", hosted: true }), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    expect(await detectAirAppRuntime({ fetch: fetchReturning(notDeclaredJson) })).toEqual(
      AIRAPP_RUNTIME_UNKNOWN,
    );
  });

  it("is unknown for a non-2xx, a network failure, and a malformed body", async () => {
    expect(
      await detectAirAppRuntime({ fetch: fetchReturning(jsonResponse({}, { status: 404 })) }),
    ).toEqual(AIRAPP_RUNTIME_UNKNOWN);
    expect(
      await detectAirAppRuntime({
        fetch: vi.fn<typeof fetch>(async () => {
          throw new TypeError("Failed to fetch");
        }),
      }),
    ).toEqual(AIRAPP_RUNTIME_UNKNOWN);
    expect(
      await detectAirAppRuntime({ fetch: fetchReturning(jsonResponse({ hosted: true })) }),
    ).toEqual(AIRAPP_RUNTIME_UNKNOWN);
  });

  it("gives up after the timeout instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      const hung = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const pending = detectAirAppRuntime({ fetch: hung });
      await vi.advanceTimersByTimeAsync(2999);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual(AIRAPP_RUNTIME_UNKNOWN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("round-trips what the server half serves", async () => {
    // The browser half must read exactly the body `describeBusabaseAirAppRuntime`
    // builds — hosted and standalone.
    const hosted = describeBusabaseAirAppRuntime({ BUSABASE_AIRAPP_RUNTIME: "local" });
    const standalone = describeBusabaseAirAppRuntime({});
    expect(await detectAirAppRuntime({ fetch: fetchReturning(jsonResponse(hosted)) })).toEqual({
      runtime: "local",
      hosted: true,
      devProxy: false,
      determined: true,
    });
    expect(await detectAirAppRuntime({ fetch: fetchReturning(jsonResponse(standalone)) })).toEqual({
      runtime: "standalone",
      hosted: false,
      devProxy: false,
      determined: true,
    });
  });
});

describe("the page-wide probe", () => {
  const SLOT = Symbol.for("busabase-sdk.airapp.runtime");
  afterEach(() => {
    delete (globalThis as unknown as Record<symbol, unknown>)[SLOT];
    vi.unstubAllGlobals();
  });

  it("probes once and shares the answer, across module copies too", async () => {
    const doFetch = fetchReturning(jsonResponse({ runtime: "browser", hosted: true }));
    vi.stubGlobal("fetch", doFetch);
    const [first, second] = await Promise.all([detectAirAppRuntime(), detectAirAppRuntime()]);
    expect(first).toEqual(second);
    expect(first.hosted).toBe(true);
    // A second import of the module (a `?v=` URL) is a second module record; the
    // answer lives on a global slot so it sees the same probe.
    vi.resetModules();
    const again = await import("./airapp-browser-runtime");
    expect((await again.detectAirAppRuntime()).hosted).toBe(true);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("is unknown, without throwing, where there is no fetch at all", async () => {
    vi.stubGlobal("fetch", undefined);
    expect(await detectAirAppRuntime()).toEqual(AIRAPP_RUNTIME_UNKNOWN);
  });
});

describe("shouldUseLocalAirAppGateway", () => {
  it("shows the connect gate unless the server said hosted — unknown included", () => {
    expect(shouldUseLocalAirAppGateway({ ...AIRAPP_RUNTIME_UNKNOWN })).toBe(true);
    expect(
      shouldUseLocalAirAppGateway(normalizeAirAppRuntime({ runtime: "standalone", hosted: false })),
    ).toBe(true);
    expect(
      shouldUseLocalAirAppGateway(normalizeAirAppRuntime({ runtime: "local", hosted: true })),
    ).toBe(false);
  });
});
