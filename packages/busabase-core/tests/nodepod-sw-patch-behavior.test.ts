import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { NODEPOD_RESERVED_HOST_PATHS } from "../src/domains/airapp/components/runners/nodepod-runner";
import { NODEPOD_HOST_CLAIM_MESSAGE } from "../src/domains/airapp/utils/nodepod-service-worker";

/**
 * BEHAVIOURAL tests for our patch on Nodepod's Service Worker
 * (`patches/@scelar__nodepod@*.patch`, applied to `dist/__sw__.js`).
 *
 * `tests/nodepod-service-worker.test.ts` covers the HOST-side lifecycle helpers
 * and the Busabase Cloud app's `nodepod-preview-host-route.test.ts` asserts that
 * certain text exists in the shipped SW, in the right order. Neither ever RUNS
 * the worker, so neither can say what actually happens to a request. This file
 * does: it executes the installed (patched) `__sw__.js` in a `vm` context, fires
 * fake `fetch` / `message` events at it, and observes WHO ANSWERED — the host
 * network, a pod, or a synthetic 403. No browser, no database, so it runs in CI
 * (the real-browser equivalents are skipped there for lack of PG_DATABASE_URL).
 *
 * The scenario is the real one: a running pod has claimed the broad path "/"
 * (every preview claims "/" on load), and the host must still get its own routes.
 *
 * It also reaches into upstream internals (`pathClaims`, `previewScripts`,
 * `previewClients`, `reservedHostPaths`, `proxyToVirtualServer`). That is
 * deliberate: our patch already depends on those exact names, so if a future
 * @scelar/nodepod renames one, this file failing at load is the upgrade canary
 * telling you which hunk to re-port — cheaper than finding out from a leaked
 * session.
 */

const require = createRequire(import.meta.url);

/**
 * `NODEPOD_SW_UNDER_TEST=/path/to/__sw__.js` runs this suite against another
 * build of the worker. Two uses: (1) before bumping @scelar/nodepod, point it at
 * the RAW upstream file (`npm pack @scelar/nodepod@x.y.z`) — every case that
 * fails is a hunk you still have to carry, every case that passes is one
 * upstream now covers; (2) red/green proof that these cases really exercise the
 * patch. Unset = the patched copy pnpm installed, which is what CI runs.
 */
const installedServiceWorker = readFileSync(
  process.env.NODEPOD_SW_UNDER_TEST ??
    join(dirname(require.resolve("@scelar/nodepod")), "__sw__.js"),
  "utf8",
);

const ORIGIN = "https://app.test";
const EMBED_POD = { instanceId: "pod-embed", serverPort: 3000 };
const DASHBOARD_POD = { instanceId: "pod-dashboard", serverPort: 5173 };

interface FakeClient {
  url: string;
  frameType?: string;
}

interface FetchInput {
  path: string;
  origin?: string;
  mode?: string;
  destination?: string;
  referrer?: string;
  clientId?: string;
}

type Answer = "host" | "pod" | "forbidden";

const loadServiceWorker = (source: string = installedServiceWorker) => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const clients = new Map<string, FakeClient>();
  const clientsClaim = vi.fn(async () => undefined);

  const self = {
    location: new URL(`${ORIGIN}/`),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
    skipWaiting: () => undefined,
    clients: {
      claim: clientsClaim,
      matchAll: async () => [],
      get: async (id: string) => clients.get(id) ?? null,
    },
  };

  const hostFetch = vi.fn(async () => new Response("host"));
  const routedToPod = vi.fn(async () => new Response("pod"));

  const context = vm.createContext({
    self,
    URL,
    URLSearchParams,
    Response,
    Headers,
    Request,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    Date,
    fetch: hostFetch,
  }) as Record<string, unknown>;

  vm.runInContext(source, context, { filename: "__sw__.js" });

  // Without this a worker that failed to register its listeners would answer
  // "host" (= no respondWith) to everything and every "stays out of the way"
  // case would pass vacuously.
  if (typeof listeners.fetch !== "function" || typeof listeners.message !== "function") {
    throw new Error("the service worker did not register its fetch/message listeners");
  }

  // Replace the function that would forward a request into a pod's virtual
  // server (needs a live MessagePort in reality). Calling it IS "the pod
  // captured this request" — the failure the reserved paths exist to prevent.
  context.proxyToVirtualServer = routedToPod;

  const run = <T = unknown>(code: string): T => vm.runInContext(code, context) as T;

  return {
    clientsClaim,
    hostFetch,
    routedToPod,
    /** A pod that has claimed "/" — as every running preview does. */
    givenPodClaimingRoot(pod = EMBED_POD, options: { embed: boolean }) {
      run(`pathClaims.set("/", ${JSON.stringify(pod)})`);
      if (options.embed) run(`previewScripts.set(${JSON.stringify(pod.instanceId)}, "embed")`);
    },
    givenPreviewClient(clientId: string, pod: typeof EMBED_POD) {
      run(`previewClients.set(${JSON.stringify(clientId)}, ${JSON.stringify(pod)})`);
    },
    givenClientDocument(clientId: string, client: FakeClient) {
      clients.set(clientId, client);
    },
    givenReservedHostPaths(paths: readonly string[]) {
      run(`for (const p of ${JSON.stringify(paths)}) reservedHostPaths.add(p)`);
    },
    instancePortCount: () => run<number>("instancePorts.size"),
    /** Fire a fetch event and report who answered it. */
    async fetch(input: FetchInput): Promise<Answer> {
      let response: Promise<Response> | null = null;
      const request = {
        url: `${input.origin ?? ORIGIN}${input.path}`,
        mode: input.mode ?? "cors",
        destination: input.destination ?? "",
        referrer: input.referrer ?? "",
        method: "GET",
        headers: new Headers(),
        credentials: "same-origin",
        clone() {
          return request;
        },
      };
      listeners.fetch({
        request,
        clientId: input.clientId ?? "",
        resultingClientId: "",
        respondWith: (answer: Promise<Response> | Response) => {
          response = Promise.resolve(answer);
        },
        waitUntil: () => undefined,
      });
      // No respondWith = the SW stood aside and the browser hits the real host.
      if (!response) return "host";
      const answered = await (response as Promise<Response>);
      if (answered.status === 403) return "forbidden";
      const body = await answered.clone().text();
      return body === "pod" ? "pod" : "host";
    },
    async message(data: unknown) {
      const waits: Promise<unknown>[] = [];
      listeners.message({
        data,
        source: { id: "client-1" },
        waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)),
      });
      await Promise.all(waits);
    },
  };
};

/** A running AirApp Embed pod owns "/", and our host declared its reserved routes. */
const embedWorld = () => {
  const sw = loadServiceWorker();
  sw.givenPodClaimingRoot(EMBED_POD, { embed: true });
  sw.givenReservedHostPaths(NODEPOD_RESERVED_HOST_PATHS);
  return sw;
};

describe("busabase patch: /api/v1 embed fail-closed guard", () => {
  it("answers 403 to a raw request from an untrusted embed pod that bypassed the fetch relay", async () => {
    const sw = embedWorld();
    sw.givenPreviewClient("c-embed", EMBED_POD);

    expect(await sw.fetch({ path: "/api/v1/nodes", clientId: "c-embed" })).toBe("forbidden");
    expect(sw.hostFetch).not.toHaveBeenCalled();
    expect(sw.routedToPod).not.toHaveBeenCalled();
  });

  it("also refuses the bare /api/v1 root, not only sub-paths", async () => {
    const sw = embedWorld();
    sw.givenPreviewClient("c-embed", EMBED_POD);

    expect(await sw.fetch({ path: "/api/v1", clientId: "c-embed" })).toBe("forbidden");
  });

  it("attributes an anonymous request to the embed pod through its referrer", async () => {
    const sw = embedWorld();
    // the pod's document lives under an explicit preview prefix
    expect(
      await sw.fetch({
        path: "/api/v1/nodes",
        referrer: `${ORIGIN}/__preview__/${EMBED_POD.instanceId}/${EMBED_POD.serverPort}/`,
      }),
    ).toBe("forbidden");
  });

  it("fails closed when an embed pod is alive and the caller cannot be attributed", async () => {
    const sw = embedWorld();

    expect(await sw.fetch({ path: "/api/v1/nodes" })).toBe("forbidden");
  });

  it("stays 403 even if /api/v1 were ALSO declared a reserved host path (ordering, not just presence)", async () => {
    // The reserved-path early exit would otherwise return first and silently
    // hand the viewer's session to the pod. This is the behavioural form of the
    // "guard sits ahead of isReservedHostPath" assertion.
    const sw = embedWorld();
    sw.givenReservedHostPaths(["/api/v1", "/api/v1/"]);
    sw.givenPreviewClient("c-embed", EMBED_POD);

    expect(await sw.fetch({ path: "/api/v1/nodes", clientId: "c-embed" })).toBe("forbidden");
  });

  it("lets the owner's own Dashboard pod reach the real backend (the side nobody had tested)", async () => {
    // A Dashboard "run my AirApp" pod has no preview script — it is trusted and
    // its /api/v1 calls must reach Busabase as the signed-in viewer.
    const sw = embedWorld();
    sw.givenPreviewClient("c-dashboard", DASHBOARD_POD);

    expect(await sw.fetch({ path: "/api/v1/nodes", clientId: "c-dashboard" })).toBe("host");
    expect(sw.routedToPod).not.toHaveBeenCalled();
  });

  it("passes /api/v1 straight through when no embed pod exists at all", async () => {
    const sw = loadServiceWorker();
    sw.givenPodClaimingRoot(DASHBOARD_POD, { embed: false });

    expect(await sw.fetch({ path: "/api/v1/nodes" })).toBe("host");
  });
});

describe("busabase patch + reservedHostPaths: host routes survive a pod that claimed '/'", () => {
  it.each([
    ["the embed relay", "/api/airapp-embed-bridge/api/v1/nodes", "cors", ""],
    ["the preview proxy root", "/api/airapp-preview", "navigate", "iframe"],
    ["a preview proxy sub-path", "/api/airapp-preview/abc/index.html", "navigate", "iframe"],
    ["the embed host document", "/embed/emb_123", "navigate", "iframe"],
    ["an embed host asset", "/embed/emb_123/airapp", "navigate", "iframe"],
  ])("never lets the pod capture %s", async (_label, path, mode, destination) => {
    const sw = embedWorld();

    expect(await sw.fetch({ path, mode, destination })).toBe("host");
    expect(sw.routedToPod).not.toHaveBeenCalled();
  });

  it("does not swallow a request made BY a reserved host document either", async () => {
    // The embed page's own _next chunks: referrer is a reserved path.
    const sw = embedWorld();

    expect(
      await sw.fetch({
        path: "/_next/static/chunks/app.js",
        referrer: `${ORIGIN}/embed/emb_123`,
      }),
    ).toBe("host");
    expect(sw.routedToPod).not.toHaveBeenCalled();
  });

  it("still routes ordinary pod traffic to the pod (reserved paths must not over-match)", async () => {
    const sw = embedWorld();

    expect(await sw.fetch({ path: "/main.js", referrer: `${ORIGIN}/` })).toBe("pod");
    expect(sw.routedToPod).toHaveBeenCalledTimes(1);
  });

  it("treats '/embed/' as a prefix, so a pod asset like /embedded.js is not reserved", async () => {
    // Upstream: entries ending in "/" are prefixes, everything else is exact.
    const sw = embedWorld();

    expect(await sw.fetch({ path: "/embedded.js", referrer: `${ORIGIN}/` })).toBe("pod");
  });
});

describe("busabase patch: cross-origin frame navigation guard", () => {
  it("leaves a frame navigation initiated by another origin to the real host", async () => {
    const sw = embedWorld();

    expect(
      await sw.fetch({
        path: "/dashboard/space/airapp/thing",
        mode: "navigate",
        destination: "iframe",
        referrer: "https://third-party.test/page",
      }),
    ).toBe("host");
    expect(sw.routedToPod).not.toHaveBeenCalled();
  });

  it("is the guard that matters: the same navigation WITHOUT a foreign referrer is captured by the pod", async () => {
    // Contrast case — proves the assertion above is not passing for some other
    // reason (e.g. nothing ever routes to the pod in this harness).
    const sw = embedWorld();

    expect(
      await sw.fetch({
        path: "/dashboard/space/airapp/thing",
        mode: "navigate",
        destination: "iframe",
        referrer: `${ORIGIN}/`,
      }),
    ).toBe("pod");
  });
});

describe("busabase patch: client-URL recovery for no-referrer documents", () => {
  it("sends a reserved host document's own subresources to the network", async () => {
    // /embed bootstrap pages ship `referrer-policy: no-referrer`, so the request
    // has no referrer and falls into the client-URL recovery branch.
    const sw = embedWorld();
    sw.givenClientDocument("c-embed-host", {
      url: `${ORIGIN}/embed/emb_123/airapp`,
      frameType: "nested",
    });

    expect(await sw.fetch({ path: "/_next/static/chunks/app.js", clientId: "c-embed-host" })).toBe(
      "host",
    );
    expect(sw.routedToPod).not.toHaveBeenCalled();
  });

  it("still attributes an ordinary pod document through the same branch", async () => {
    const sw = embedWorld();
    sw.givenClientDocument("c-pod-doc", { url: `${ORIGIN}/some-pod-page`, frameType: "nested" });

    expect(await sw.fetch({ path: "/main.js", clientId: "c-pod-doc" })).toBe("pod");
  });
});

describe("busabase patch: host claim message", () => {
  it("uses the message name the host actually sends", () => {
    expect(NODEPOD_HOST_CLAIM_MESSAGE).toBe("busabase-host-claim");
  });

  it("claims the page without creating any pod state (unlike upstream's init)", async () => {
    const sw = loadServiceWorker();

    await sw.message({ type: NODEPOD_HOST_CLAIM_MESSAGE });

    expect(sw.clientsClaim).toHaveBeenCalledTimes(1);
    expect(sw.instancePortCount()).toBe(0);
  });
});

/**
 * Meta-tests: the harness above is only worth anything if it FAILS when the
 * patch regresses. Each case takes the real SW source, breaks one guard, and
 * asserts the corresponding behaviour flips — so a future refactor of this file
 * (or an upstream change that makes a guard dead) cannot leave green-but-empty
 * tests behind.
 */
describe("harness sensitivity (mutation checks)", () => {
  const broken = (from: string, to: string) => {
    expect(installedServiceWorker).toContain(from);
    return installedServiceWorker.replace(from, to);
  };

  it("notices if the /api/v1 403 is removed", async () => {
    const sw = loadServiceWorker(
      broken("event.respondWith(new Response(null, { status: 403 }));", "void 0;"),
    );
    sw.givenPodClaimingRoot(EMBED_POD, { embed: true });
    sw.givenPreviewClient("c-embed", EMBED_POD);

    expect(await sw.fetch({ path: "/api/v1/nodes", clientId: "c-embed" })).not.toBe("forbidden");
  });

  it("notices if the client-URL reserved check is removed", async () => {
    const sw = loadServiceWorker(broken("if (isReservedHostPath(clientPath)) {", "if (false) {"));
    sw.givenPodClaimingRoot(EMBED_POD, { embed: true });
    sw.givenReservedHostPaths(NODEPOD_RESERVED_HOST_PATHS);
    sw.givenClientDocument("c-embed-host", {
      url: `${ORIGIN}/embed/emb_123/airapp`,
      frameType: "nested",
    });

    expect(await sw.fetch({ path: "/_next/static/chunks/app.js", clientId: "c-embed-host" })).toBe(
      "pod",
    );
  });

  it("notices if the cross-origin frame navigation guard is removed", async () => {
    const sw = loadServiceWorker(
      broken("if (isFrameNavigation && hasCrossOriginReferrer) return;", ""),
    );
    sw.givenPodClaimingRoot(EMBED_POD, { embed: true });

    expect(
      await sw.fetch({
        path: "/dashboard/space/airapp/thing",
        mode: "navigate",
        destination: "iframe",
        referrer: "https://third-party.test/page",
      }),
    ).toBe("pod");
  });

  it("notices if the host-claim handler is removed", async () => {
    const sw = loadServiceWorker(
      broken('if (data.type === "busabase-host-claim") {', 'if (data.type === "never") {'),
    );

    await sw.message({ type: NODEPOD_HOST_CLAIM_MESSAGE });

    expect(sw.clientsClaim).not.toHaveBeenCalled();
  });
});
