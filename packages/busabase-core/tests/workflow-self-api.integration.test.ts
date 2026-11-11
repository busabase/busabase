/** Real HTTP listeners on private loopback addresses; no DNS or fetch replacement. */
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowWebhookCall } from "../src/domains/workflow/logic/runs";
import { sendWorkflowWebhook } from "../src/domains/workflow/logic/webhook-step";

const records = [{ id: "rec_order_7", title: "Order 7" }];
let self: Server;
let other: Server;
let selfOrigin: string;
let otherOrigin: string;
const received: { listener: "self" | "other"; path: string }[] = [];

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  return `http://127.0.0.1:${address.port}`;
};

const close = async (server?: Server): Promise<void> => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
};

const call = (path: string): WorkflowWebhookCall => ({
  method: "GET",
  url: `${selfOrigin}${path}`,
  timeoutMs: 2_000,
  body: {
    event: "workflow.step",
    runId: "wfr_http_test",
    workflowNodeId: "nod_http_test",
    stepId: "records",
    payload: {},
    record: null,
    recordId: null,
    baseId: null,
    fields: null,
    steps: {},
    previous: null,
  },
  headers: [],
  signingSecret: null,
});

beforeAll(async () => {
  other = createServer((request, response) => {
    received.push({ listener: "other", path: request.url ?? "/" });
    response.writeHead(200).end("must not be reached");
  });
  otherOrigin = await listen(other);
  self = createServer((request, response) => {
    const path = request.url ?? "/";
    received.push({ listener: "self", path });
    switch (path.split("?")[0]) {
      case "/api/v1/records":
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ records }));
        return;
      case "/api/v1/redirect-api":
        response.writeHead(302, { location: "/api/v1/records" }).end();
        return;
      case "/api/v1/redirect-internal":
        response.writeHead(302, { location: "/admin/probe" }).end();
        return;
      case "/api/v1/redirect-other":
        response.writeHead(307, { location: `${otherOrigin}/api/v1/records` }).end();
        return;
      case "/api/v1/authenticated":
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      default:
        response.writeHead(200).end("must not be reached");
    }
  });
  selfOrigin = await listen(self);
});

beforeEach(() => {
  received.length = 0;
  vi.stubEnv("BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS", undefined);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", selfOrigin);
  expect(process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS).toBeUndefined();
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await Promise.all([close(self), close(other)]);
});

describe("workflow self API over a real private-address HTTP connection", () => {
  it("returns records from the configured origin without the test-only allowlist", async () => {
    await expect(
      sendWorkflowWebhook(call("/api/v1/records?baseId=bas_orders")),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: { records },
    });
    expect(received).toEqual([{ listener: "self", path: "/api/v1/records?baseId=bas_orders" }]);
  });

  it("follows a same-origin redirect that remains inside the API", async () => {
    await expect(sendWorkflowWebhook(call("/api/v1/redirect-api"))).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: { records },
    });
    expect(received).toEqual([
      { listener: "self", path: "/api/v1/redirect-api" },
      { listener: "self", path: "/api/v1/records" },
    ]);
  });

  it("refuses a redirect outside the API before that handler receives any request", async () => {
    await expect(sendWorkflowWebhook(call("/api/v1/redirect-internal"))).resolves.toMatchObject({
      ok: false,
      status: null,
      message: expect.stringContaining("private/internal address"),
    });
    expect(received).toEqual([{ listener: "self", path: "/api/v1/redirect-internal" }]);
  });

  it("refuses a redirect to a second private listener before it receives any request", async () => {
    await expect(sendWorkflowWebhook(call("/api/v1/redirect-other"))).resolves.toMatchObject({
      ok: false,
      status: null,
      message: expect.stringContaining("private/internal address"),
    });
    expect(received).toEqual([{ listener: "self", path: "/api/v1/redirect-other" }]);
  });

  it("preserves an actual API authentication refusal", async () => {
    await expect(sendWorkflowWebhook(call("/api/v1/authenticated"))).resolves.toMatchObject({
      ok: false,
      status: 401,
      message: "HTTP 401",
      body: { error: "Unauthorized" },
    });
    expect(received).toEqual([{ listener: "self", path: "/api/v1/authenticated" }]);
  });

  it("sends nothing to the private listener when the configured origin is removed", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);

    await expect(sendWorkflowWebhook(call("/api/v1/records"))).resolves.toMatchObject({
      ok: false,
      status: null,
      message: expect.stringContaining("private/internal address"),
    });
    expect(received).toEqual([]);
  });
});
