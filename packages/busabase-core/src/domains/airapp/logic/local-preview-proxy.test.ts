import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
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
});
