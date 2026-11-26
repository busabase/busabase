import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runInNewContext } from "node:vm";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyLocalPreview } from "./local-preview-proxy";
import { registerLocalPreview, unregisterLocalPreview } from "./local-preview-registry";

const NODE_ID = "preview-node";
const OWNER = "preview-owner";

const listen = async (
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; close: () => Promise<void> }> => {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};

afterEach(async () => {
  await unregisterLocalPreview(NODE_ID, OWNER);
});

describe("AirApp preview response compression over real HTTP", () => {
  const html =
    '<!doctype html><html><head></head><body><h1>Compressed preview ready</h1><img src="/badge.png"></body></html>';
  const binary = Buffer.from([0, 255, 128, 65, 0, 17, 66, 254, 0, 127, 17, 90]);
  const compressors = {
    gzip: gzipSync,
    deflate: deflateSync,
    br: brotliCompressSync,
  };

  it.each(["gzip", "deflate", "br"] as const)(
    "decodes %s HTML before rewriting when a browser also advertises Zstandard",
    async (encoding) => {
      let negotiated = "";
      let advertised = "";
      const upstream = await listen((request, response) => {
        advertised = request.headers["accept-encoding"] ?? "";
        negotiated = advertised.includes("zstd") ? "zstd" : encoding;
        const body =
          negotiated === "zstd"
            ? Buffer.from(
                "KLUv/SBt5QIAooUTGIC3bYBI5NKhrGmSYsEApLYNHk7DLyGrEpmw2jtMwgwacKPFOCJwoGSGEcxiD5eWIyscIRy16VM6aj6CLBZz6TEOU8sxE1Zr76WOowMGAwAehAFVRpGsLAE=",
                "base64",
              )
            : compressors[encoding](Buffer.from(html));
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": negotiated,
          "content-length": String(body.length),
        });
        response.end(body);
      });
      await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

      try {
        const response = await proxyLocalPreview(
          new Request("https://busabase.example/api/airapp-preview/preview-node/", {
            headers: { "accept-encoding": "gzip, deflate, br, zstd" },
          }),
          NODE_ID,
          "",
          OWNER,
        );

        const document = await response.text();
        expect(document).toContain("<h1>Compressed preview ready</h1>");
        expect(document).toContain('src="/api/airapp-preview/preview-node/badge.png"');
        expect(document).toContain('<base href="/api/airapp-preview/preview-node/">');
        expect(response.headers.get("content-encoding")).toBeNull();
        expect(response.headers.get("content-length")).toBeNull();
        expect(advertised).not.toContain("zstd");
        expect(negotiated).toBe(encoding);
      } finally {
        await upstream.close();
      }
    },
  );

  it.each(["gzip", "deflate", "br"] as const)(
    "preserves %s binary bytes when a browser also advertises Zstandard",
    async (encoding) => {
      let negotiated = "";
      const upstream = await listen((request, response) => {
        negotiated = request.headers["accept-encoding"]?.includes("zstd") ? "zstd" : encoding;
        const body =
          negotiated === "zstd"
            ? Buffer.from("KLUv/SAMYQAAAP+AQQARQv4AfxFa", "base64")
            : compressors[encoding](binary);
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-encoding": negotiated,
          "content-length": String(body.length),
        });
        response.end(body);
      });
      await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

      try {
        const response = await proxyLocalPreview(
          new Request("https://busabase.example/api/airapp-preview/preview-node/proof.bin", {
            headers: { "accept-encoding": "gzip, deflate, br, zstd" },
          }),
          NODE_ID,
          "proof.bin",
          OWNER,
        );

        expect(Buffer.from(await response.arrayBuffer())).toEqual(binary);
        expect(response.headers.get("content-encoding")).toBeNull();
        expect(response.headers.get("content-length")).toBeNull();
        expect(negotiated).toBe(encoding);
      } finally {
        await upstream.close();
      }
    },
  );
});

describe("share-capable preview protocol readiness", () => {
  it("waits for a rotated credential deployment when content and protocol are unchanged", async () => {
    let requests = 0;
    const upstream = await listen((_request, response) => {
      requests += 1;
      response.setHeader("content-type", "text/html");
      response.setHeader("x-busabase-preview-version", "same-content");
      response.setHeader("x-busabase-preview-protocol", "2");
      response.setHeader(
        "x-busabase-preview-deployment",
        requests > 1 ? "fresh-credential" : "old-credential",
      );
      response.end(
        requests > 1 ? "<h1>Fresh credential ready</h1>" : "<h1>Old revoked credential</h1>",
      );
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin, {
      "x-busabase-preview-version": "same-content",
      "x-busabase-preview-protocol": "2",
      "x-busabase-preview-deployment": "fresh-credential",
    });
    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.test/api/airapp-preview/preview-node/"),
        NODE_ID,
        "",
        OWNER,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Fresh credential ready");
      expect(requests).toBe(2);
    } finally {
      await upstream.close();
    }
  });

  it("waits for the sharing protocol even when an older gate has the same content hash", async () => {
    let requests = 0;
    const upstream = await listen((_request, response) => {
      requests += 1;
      response.setHeader("content-type", "text/html");
      response.setHeader("x-busabase-preview-version", "same-content");
      if (requests > 1) response.setHeader("x-busabase-preview-protocol", "2");
      response.end(requests > 1 ? "<h1>Sharing ready</h1>" : "<h1>Old gate cannot share</h1>");
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin, {
      "x-busabase-preview-version": "same-content",
      "x-busabase-preview-protocol": "2",
    });
    try {
      const response = await proxyLocalPreview(
        new Request(
          "https://busabase.test/api/airapp-preview/preview-node/?__busabase_site_version=same-content",
        ),
        NODE_ID,
        "",
        OWNER,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Sharing ready");
      expect(requests).toBe(2);
    } finally {
      await upstream.close();
    }
  });
});

describe("versioned private previews over real HTTP", () => {
  it.each(["html", "binary"])("waits for the uploaded version before serving %s", async (kind) => {
    let requests = 0;
    const received: IncomingMessage["headers"][] = [];
    const binary = Buffer.from([0, 255, 128, 0, 2]);
    const upstream = await listen((request, response) => {
      requests += 1;
      received.push(request.headers);
      const ready = requests > 2;
      response.writeHead(200, {
        "content-type": kind === "html" ? "text/html" : "application/octet-stream",
        "cache-control": "public, max-age=3600",
        "x-busabase-preview-version": ready ? "v2" : "v1",
      });
      response.end(ready ? (kind === "html" ? "<h1>version two</h1>" : binary) : "older bytes");
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin, {
      "x-busabase-preview-token": "private-token",
      "x-busabase-preview-version": "v2",
    });
    try {
      const response = await proxyLocalPreview(
        new Request(
          "https://busabase.example/api/airapp-preview/preview-node/?__busabase_site_version=v2",
          {
            headers: {
              "if-none-match": '"older-etag"',
              "if-modified-since": "Mon, 16 Nov 2026 00:00:00 GMT",
              "x-busabase-preview-version": "browser-forgery",
            },
          },
        ),
        NODE_ID,
        "",
        OWNER,
      );
      expect(response.status).toBe(200);
      if (kind === "html") expect(await response.text()).toContain("<h1>version two</h1>");
      else expect(Buffer.from(await response.arrayBuffer())).toEqual(binary);
      expect(requests).toBe(3);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-busabase-preview-version")).toBeNull();
      for (const headers of received) {
        expect(headers["x-busabase-preview-version"]).toBe("v2");
        expect(headers["if-none-match"]).toBeUndefined();
        expect(headers["if-modified-since"]).toBeUndefined();
      }
    } finally {
      await upstream.close();
    }
  });

  it("fails closed when an old gate never proves which version it serves", async () => {
    const upstream = await listen((_request, response) => response.end("older unmarked bytes"));
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin, {
      "x-busabase-preview-token": "private-token",
      "x-busabase-preview-version": "v2",
    });
    try {
      const response = await proxyLocalPreview(
        new Request(
          "https://busabase.example/api/airapp-preview/preview-node/?__busabase_site_version=v2",
        ),
        NODE_ID,
        "",
        OWNER,
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("older unmarked bytes");
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      await upstream.close();
    }
  });

  it("does not put newer bytes at an older version URL", async () => {
    let requests = 0;
    const upstream = await listen((_request, response) => {
      requests += 1;
      response.end("newer bytes");
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin, {
      "x-busabase-preview-token": "private-token",
      "x-busabase-preview-version": "v2",
    });
    try {
      const response = await proxyLocalPreview(
        new Request(
          "https://busabase.example/api/airapp-preview/preview-node/?__busabase_site_version=v1",
        ),
        NODE_ID,
        "",
        OWNER,
      );
      expect(response.status).toBe(503);
      expect(requests).toBe(0);
    } finally {
      await upstream.close();
    }
  });
});

describe("AirApp preview proxy credential boundary", () => {
  it("does not replay host credentials or Busabase routing context to an untrusted upstream", async () => {
    let receivedHeaders: IncomingMessage["headers"] = {};
    let receivedBody = "";
    const upstream = await listen(async (request, response) => {
      receivedHeaders = request.headers;
      for await (const chunk of request) receivedBody += String(chunk);
      response.setHeader("content-type", "application/json");
      response.setHeader("set-cookie", "airapp-controlled=must-not-reach-busabase");
      response.end(JSON.stringify({ ok: true }));
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/echo", {
          method: "POST",
          headers: {
            authorization: "Bearer busabase-session-secret",
            cookie: "better-auth.session_token=cloud-cookie-secret",
            "proxy-authorization": "Basic proxy-secret",
            "x-api-key": "busabase-api-key-secret",
            "x-busabase-space": "space-secret",
            "x-busabase-relay-permission-level": "manage",
            connection: "keep-alive, x-hop-secret",
            forwarded: "for=127.0.0.1;host=busabase.internal",
            via: "1.1 busabase.internal",
            "x-forwarded-host": "busabase.internal",
            "x-real-ip": "127.0.0.1",
            "x-hop-secret": "connection-scoped-secret",
            "x-airapp-custom": "ordinary-app-header",
            "content-type": "text/plain",
          },
          body: "ordinary request body",
        }),
        NODE_ID,
        "echo",
        OWNER,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(receivedBody).toBe("ordinary request body");
      expect(receivedHeaders["x-airapp-custom"]).toBe("ordinary-app-header");
      for (const name of [
        "authorization",
        "cookie",
        "forwarded",
        "proxy-authorization",
        "via",
        "x-api-key",
        "x-busabase-space",
        "x-busabase-relay-permission-level",
        "x-forwarded-host",
        "x-hop-secret",
        "x-real-ip",
      ]) {
        expect(receivedHeaders[name], `${name} reached the AirApp`).toBeUndefined();
      }
      expect(JSON.stringify(receivedHeaders)).not.toContain("secret");
    } finally {
      await upstream.close();
    }
  });

  it("retries transient upstream failures for an iframe GET", async () => {
    let requests = 0;
    const upstream = await listen((_request, response) => {
      requests += 1;
      if (requests < 3) {
        response.statusCode = 503;
        response.end("No server on pod/3000");
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><h1>ready</h1>");
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/"),
        NODE_ID,
        "",
        OWNER,
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("ready");
      expect(requests).toBe(3);
    } finally {
      await upstream.close();
    }
  });

  it("keeps root-relative redirects inside the AirApp preview path", async () => {
    const upstream = await listen((_request, response) => {
      response.writeHead(307, { location: "/docs?from=home" });
      response.end();
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/"),
        NODE_ID,
        "",
        OWNER,
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "/api/airapp-preview/preview-node/docs?from=home",
      );
    } finally {
      await upstream.close();
    }
  });

  it("never retries a non-idempotent request", async () => {
    let requests = 0;
    const upstream = await listen((_request, response) => {
      requests += 1;
      response.statusCode = 503;
      response.end("try later");
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/action", {
          method: "POST",
          body: "do this once",
        }),
        NODE_ID,
        "action",
        OWNER,
      );

      expect(response.status).toBe(503);
      expect(requests).toBe(1);
    } finally {
      await upstream.close();
    }
  });

  it("streams Server-Sent Events without buffering the response", async () => {
    let upstreamFinished = false;
    const upstream = await listen((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write("data: first\n\n");
      const finishTimer = setTimeout(() => {
        upstreamFinished = true;
        response.end("data: second\n\n");
      }, 5_000);
      finishTimer.unref();
      response.once("close", () => clearTimeout(finishTimer));
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/events"),
        NODE_ID,
        "events",
        OWNER,
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const first = await reader?.read();
      expect(new TextDecoder().decode(first?.value)).toContain("data: first");
      expect(upstreamFinished).toBe(false);
      await reader?.cancel();
    } finally {
      await upstream.close();
    }
  });

  it("preserves relative and root-relative static assets under the preview path", async () => {
    const upstreamRequests: string[] = [];
    const upstream = await listen((request, response) => {
      upstreamRequests.push(request.url ?? "");
      if (request.url?.startsWith("/style.css")) {
        response.setHeader("content-type", "text/css; charset=utf-8");
        response.end("body { color: green; }");
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><HEAD data-app="preview"></HEAD><body>
        <!-- href="/comment-must-not-change.css" -->
        <link rel="stylesheet" href="/style.css?v=1">
        <script src="/client.js"></script>
        <script src="client-relative.js"></script>
        <script>window.template = ' href="/inline-script-must-not-change.css"';</script>
        <img srcset="/small.png 1x, /large.png 2x">
        <a href="/api/v1/nodes">Busabase data</a>
      </body></html>`);
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/"),
        NODE_ID,
        "",
        OWNER,
      );
      const html = await response.text();
      expect(html).toContain(
        '<head data-app="preview"><base href="/api/airapp-preview/preview-node/">',
      );
      expect(html).toContain('href="/api/airapp-preview/preview-node/style.css?v=1"');
      expect(html).toContain('src="/api/airapp-preview/preview-node/client.js"');
      expect(html).toContain('src="client-relative.js"');
      expect(html).toContain(
        'srcset="/api/airapp-preview/preview-node/small.png 1x, /api/airapp-preview/preview-node/large.png 2x"',
      );
      expect(html).toContain('href="/api/v1/nodes"');
      expect(html).toContain('href="/comment-must-not-change.css"');
      expect(html).toContain('href="/inline-script-must-not-change.css"');
      expect(html).not.toContain(
        'href="/api/airapp-preview/preview-node/inline-script-must-not-change.css"',
      );

      const stylesheet = await proxyLocalPreview(
        new Request(
          "https://busabase.example/api/airapp-preview/preview-node/style.css?theme=dark",
        ),
        NODE_ID,
        "style.css",
        OWNER,
      );
      expect(stylesheet.status).toBe(200);
      expect(stylesheet.headers.get("content-type")).toContain("text/css");
      expect(await stylesheet.text()).toBe("body { color: green; }");
      expect(upstreamRequests).toEqual(["/", "/style.css?theme=dark"]);
    } finally {
      await upstream.close();
    }
  });

  it("routes root-relative browser requests to the AirApp while preserving the Busabase API", async () => {
    const upstream = await listen((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<!doctype html><html><head></head><body>AirApp</body></html>");
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);

    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/"),
        NODE_ID,
        "",
        OWNER,
      );
      const html = await response.text();
      const bridge = html.match(
        /<script data-busabase-airapp-preview-bridge="">([\s\S]*?)<\/script>/,
      )?.[1];
      expect(bridge).toBeDefined();

      const fetchUrls: string[] = [];
      const xhrUrls: string[] = [];
      const eventSourceUrls: string[] = [];
      const beaconUrls: string[] = [];

      class BrowserRequest {
        readonly url: string;

        constructor(input: string | BrowserRequest) {
          this.url = typeof input === "string" ? input : input.url;
        }
      }

      class BrowserXMLHttpRequest {
        open(_method: string, url: string): void {
          xhrUrls.push(String(url));
        }
      }

      class BrowserEventSource {
        constructor(url: string) {
          eventSourceUrls.push(String(url));
        }
      }

      const browserWindow = {
        EventSource: BrowserEventSource,
        Request: BrowserRequest,
        XMLHttpRequest: BrowserXMLHttpRequest,
        fetch: async (input: string | BrowserRequest) => {
          fetchUrls.push(typeof input === "string" ? input : input.url);
          return new Response(null, { status: 204 });
        },
        location: {
          href: "https://busabase.example/api/airapp-preview/preview-node/",
          origin: "https://busabase.example",
        },
        navigator: {
          sendBeacon: (url: string) => {
            beaconUrls.push(String(url));
            return true;
          },
        },
      };

      runInNewContext(bridge as string, { URL, window: browserWindow });

      await browserWindow.fetch("/api/state");
      await browserWindow.fetch("./api/relative-state");
      await browserWindow.fetch("/api/v1/nodes?limit=1");
      await browserWindow.fetch("https://cdn.example/data.json");
      new browserWindow.XMLHttpRequest().open("GET", "/api/status");
      new browserWindow.EventSource("/events");
      browserWindow.navigator.sendBeacon("/telemetry");

      expect(fetchUrls).toEqual([
        "https://busabase.example/api/airapp-preview/preview-node/api/state",
        "./api/relative-state",
        "/api/v1/nodes?limit=1",
        "https://cdn.example/data.json",
      ]);
      expect(xhrUrls).toEqual([
        "https://busabase.example/api/airapp-preview/preview-node/api/status",
      ]);
      expect(eventSourceUrls).toEqual([
        "https://busabase.example/api/airapp-preview/preview-node/events",
      ]);
      expect(beaconUrls).toEqual([
        "https://busabase.example/api/airapp-preview/preview-node/telemetry",
      ]);
    } finally {
      await upstream.close();
    }
  });

  it("rejects WebSocket upgrades explicitly instead of pretending to proxy HMR", async () => {
    const response = await proxyLocalPreview(
      new Request("https://busabase.example/api/airapp-preview/preview-node/socket", {
        headers: { connection: "Upgrade", upgrade: "websocket" },
      }),
      NODE_ID,
      "socket",
      OWNER,
    );

    expect(response.status).toBe(501);
    expect(await response.text()).toContain("not supported");
  });

  it("captures real browser console calls and unhandled errors before app scripts without suppressing native output", async () => {
    const upstream = await listen((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        '<!doctype html><html><head><script>console.log("app startup")</script></head><body>AirApp</body></html>',
      );
    });
    await registerLocalPreview(NODE_ID, OWNER, upstream.origin);
    try {
      const response = await proxyLocalPreview(
        new Request("https://busabase.example/api/airapp-preview/preview-node/"),
        NODE_ID,
        "",
        OWNER,
      );
      const html = await response.text();
      const bridge = html.match(
        /<script data-busabase-airapp-preview-bridge="">([\s\S]*?)<\/script>/,
      )?.[1];
      expect(bridge).toBeDefined();
      expect(html.indexOf("data-busabase-airapp-preview-bridge")).toBeLessThan(
        html.indexOf('console.log("app startup")'),
      );
      const messages: Array<{ channel: string; level: string; message: string }> = [];
      const origins: string[] = [];
      type BrowserErrorEvent = { error?: Error; message?: string; reason?: unknown };
      const events = new Map<string, (event: BrowserErrorEvent) => void>();
      const nativeConsole = {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      const browserWindow = {
        console: { ...nativeConsole },
        parent: {
          postMessage: (message: (typeof messages)[number], origin: string) => {
            messages.push(message);
            origins.push(origin);
          },
        },
        addEventListener: (name: string, listener: (event: BrowserErrorEvent) => void) => {
          events.set(name, listener);
        },
        location: {
          href: "https://busabase.example/api/airapp-preview/preview-node/",
          origin: "https://busabase.example",
        },
        fetch: async () => new Response(null, { status: 204 }),
      };
      runInNewContext(bridge as string, { URL, Error, window: browserWindow });
      browserWindow.console.log("app startup", { count: 3 });
      browserWindow.console.info("connected");
      browserWindow.console.warn("stock low");
      browserWindow.console.error(new Error("checkout failed"));
      browserWindow.console.debug("trace");
      const circular: { self?: unknown } = {};
      circular.self = circular;
      browserWindow.console.log(circular, "x".repeat(20_000));
      events.get("error")?.({ message: "uncaught script error" });
      events.get("unhandledrejection")?.({ reason: new Error("request rejected") });
      expect(nativeConsole.log).toHaveBeenCalledWith("app startup", { count: 3 });
      expect(nativeConsole.warn).toHaveBeenCalledExactlyOnceWith("stock low");
      expect(messages[0]).toEqual({
        channel: "busabase-airapp-console",
        level: "log",
        message: 'app startup {"count":3}',
      });
      expect(messages.map(({ level }) => level)).toEqual([
        "log",
        "info",
        "warn",
        "error",
        "debug",
        "log",
        "error",
        "error",
      ]);
      expect(messages[3]?.message).toContain("checkout failed");
      expect(messages[5]?.message).toContain("[Circular]");
      expect(messages[6]?.message).toBe("uncaught script error");
      expect(messages[7]?.message).toContain("Unhandled rejection: Error: request rejected");
      expect(messages.every(({ message }) => message.length <= 8192)).toBe(true);
      expect(new Set(origins)).toEqual(new Set(["https://busabase.example"]));
    } finally {
      await upstream.close();
    }
  });
});

describe("a preview target that needs its own credentials", () => {
  it("sends them upstream without letting a browser set or read them", async () => {
    let seen: IncomingMessage["headers"] = {};
    const upstream = await listen((request, response) => {
      seen = request.headers;
      response.setHeader("content-type", "text/plain");
      response.end("ok");
    });
    try {
      await registerLocalPreview("site-node", OWNER, upstream.origin, {
        "x-busabase-preview-token": "server-side",
      });
      const result = await proxyLocalPreview(
        new Request("http://localhost/api/airapp-preview/site-node/", {
          headers: { "x-busabase-preview-token": "from-the-browser" },
        }),
        "site-node",
        "",
        OWNER,
      );
      expect(result.status).toBe(200);
      expect(seen["x-busabase-preview-token"]).toBe("server-side");
      expect(result.headers.get("x-busabase-preview-token")).toBeNull();
    } finally {
      await unregisterLocalPreview("site-node", OWNER);
      await upstream.close();
    }
  });

  it("does not open it to anyone but the owner who registered it", async () => {
    const upstream = await listen((_request, response) => response.end("private"));
    try {
      await registerLocalPreview("site-node", OWNER, upstream.origin, {
        "x-busabase-preview-token": "server-side",
      });
      const stranger = await proxyLocalPreview(
        new Request("http://localhost/api/airapp-preview/site-node/"),
        "site-node",
        "",
        "someone-else",
      );
      expect(stranger.status).toBe(404);
    } finally {
      await unregisterLocalPreview("site-node", OWNER);
      await upstream.close();
    }
  });

  it("adds nothing to a target registered without credentials", async () => {
    let seen: IncomingMessage["headers"] = {};
    const upstream = await listen((request, response) => {
      seen = request.headers;
      response.end("ok");
    });
    try {
      await registerLocalPreview("plain-node", OWNER, upstream.origin);
      await proxyLocalPreview(
        new Request("http://localhost/api/airapp-preview/plain-node/"),
        "plain-node",
        "",
        OWNER,
      );
      expect(seen["x-busabase-preview-token"]).toBeUndefined();
    } finally {
      await unregisterLocalPreview("plain-node", OWNER);
      await upstream.close();
    }
  });
});
