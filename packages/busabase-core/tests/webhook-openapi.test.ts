import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * The `webhook` domain driven through the PUBLIC OpenAPI REST surface
 * (`/api/v1`), the layer webhook-orpc.test.ts's in-process `createRouterClient`
 * skips — HTTP method + path routing, `{id}` / `{ruleId}` path-param
 * extraction, query-param coercion (`deliveries`'s `limit`), and a path-only
 * mutation with no body (`test-fire`). Dispatch behavior itself (retries,
 * SSRF guard, sandbox, secret rotation) is covered by webhook-orpc.test.ts;
 * this file only proves the REST boundary wires up the same way it does for
 * every other domain.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const API = "http://localhost/api/v1";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `predicate()` is true or `timeoutMs` elapses — avoids flaky fixed sleeps. */
const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 25,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
};

describe("Webhook automation domain — OpenAPI (/api/v1) route round-trip", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let handler: OpenAPIHandler<Record<never, never>>;
  let server: ReturnType<typeof createServer>;
  let port = 0;
  let received: Array<{ path: string; signature: string | null }> = [];

  const call = async (
    method: string,
    routePath: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> => {
    const request = new Request(`${API}${routePath}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await handler.handle(request, { context: {} });
    if (!result.matched) {
      throw new Error(`no OpenAPI route matched ${method} ${routePath}`);
    }
    return { status: result.response.status, body: await result.response.json() };
  };

  const ok = async (method: string, routePath: string, body?: unknown): Promise<any> => {
    const res = await call(method, routePath, body);
    if (res.status >= 400) {
      throw new Error(`${method} ${routePath} → ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  };

  const hookUrl = (route: string) => `http://127.0.0.1:${port}/${route}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-wh-openapi-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-wh-openapi-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    process.env.BUSABASE_VAULT_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
    handler = new OpenAPIHandler(busabaseRouter);

    server = createServer((req, res) => {
      received.push({
        path: req.url ?? "",
        signature: (req.headers["x-busabase-signature"] as string) ?? null,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    // Same test-only SSRF allowlist mechanism as webhook-orpc.test.ts — only
    // honored when Vitest itself sets `VITEST` — so test-fire can actually
    // reach this loopback listener instead of being blocked by the guard.
    process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS = `127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    delete process.env.BUSABASE_VAULT_ENCRYPTION_KEY;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("creates, lists, gets, updates, and deletes a rule over REST", async () => {
    const created = await ok("POST", "/webhooks", {
      name: "rest crud rule",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: hookUrl("crud"), secret: "s3cr3t" },
      enabled: true,
    });
    expect(created.name).toBe("rest crud rule");
    expect(created.config.hasSecret).toBe(true);
    // The secret itself must never round-trip back to the client.
    expect(JSON.stringify(created)).not.toContain("s3cr3t");

    const listed = await ok("GET", "/webhooks");
    expect(listed.some((rule: any) => rule.id === created.id)).toBe(true);

    const fetched = await ok("GET", `/webhooks/${created.id}`);
    expect(fetched.id).toBe(created.id);

    const updated = await ok("PUT", `/webhooks/${created.id}`, {
      name: "rest crud rule renamed",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: hookUrl("crud-2") },
      enabled: false,
    });
    expect(updated.name).toBe("rest crud rule renamed");
    expect(updated.enabled).toBe(false);
    // Secret omitted on update must be preserved, not wiped.
    expect(updated.config.hasSecret).toBe(true);

    const deleted = await ok("DELETE", `/webhooks/${created.id}`);
    expect(deleted.success).toBe(true);

    const afterDelete = await call("GET", `/webhooks/${created.id}`);
    expect(afterDelete.status).toBe(404);
  });

  it("test-fires a rule via a path-only POST (no request body)", async () => {
    received = [];
    const rule = await ok("POST", "/webhooks", {
      name: "rest test-fire rule",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: hookUrl("test-fire") },
      enabled: false, // test-fire must work regardless of enabled state
    });

    const delivery = await ok("POST", `/webhooks/${rule.id}/test-fire`);
    expect(delivery.ruleId).toBe(rule.id);
    expect(delivery.status).toBe("success");
    expect(received.some((hit) => hit.path === "/test-fire")).toBe(true);
  });

  it("lists deliveries for a rule with a path param plus a coerced query param", async () => {
    const rule = await ok("POST", "/webhooks", {
      name: "rest deliveries rule",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: hookUrl("deliveries") },
      enabled: false,
    });
    await ok("POST", `/webhooks/${rule.id}/test-fire`);
    await ok("POST", `/webhooks/${rule.id}/test-fire`);

    const deliveries = await ok("GET", `/webhooks/${rule.id}/deliveries?limit=1`);
    expect(Array.isArray(deliveries)).toBe(true);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].ruleId).toBe(rule.id);
  });

  it("rejects a config/actionKind mismatch with HTTP 400 at the REST boundary", async () => {
    const res = await call("POST", "/webhooks", {
      name: "bad discriminated union",
      eventType: "record.created",
      baseId: null,
      actionKind: "run_function",
      // run_function requires WebhookFunctionConfigSchema (`code`), not a targetUrl.
      config: { targetUrl: hookUrl("never") },
      enabled: true,
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-URL targetUrl with HTTP 400 at the REST boundary", async () => {
    const res = await call("POST", "/webhooks", {
      name: "bad url",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: "not-a-url" },
      enabled: true,
    });
    expect(res.status).toBe(400);
  });

  it("rejects a missing required field (name) with HTTP 400 at the REST boundary", async () => {
    const res = await call("POST", "/webhooks", {
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: hookUrl("never") },
      enabled: true,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range deliveries limit with HTTP 400 at the REST boundary", async () => {
    const rule = await ok("POST", "/webhooks", {
      name: "rest limit-bounds rule",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: hookUrl("limit-bounds") },
      enabled: false,
    });

    const tooLow = await call("GET", `/webhooks/${rule.id}/deliveries?limit=0`);
    expect(tooLow.status).toBe(400);
    const tooHigh = await call("GET", `/webhooks/${rule.id}/deliveries?limit=101`);
    expect(tooHigh.status).toBe(400);
    const notANumber = await call("GET", `/webhooks/${rule.id}/deliveries?limit=abc`);
    expect(notANumber.status).toBe(400);
  });

  it("round-trips a notify_agent rule (the generalized old env-var push) over REST", async () => {
    const created = await ok("POST", "/webhooks", {
      name: "rest notify_agent rule",
      eventType: "ai_mention",
      baseId: null,
      actionKind: "notify_agent",
      config: { targetUrl: hookUrl("notify-agent"), headers: { "x-source": "busabase" } },
      enabled: true,
    });
    expect(created.actionKind).toBe("notify_agent");
    expect(created.config.targetUrl).toBe(hookUrl("notify-agent"));

    const fired = await ok("POST", `/webhooks/${created.id}/test-fire`);
    expect(fired.status).toBe("success");
  });

  it("round-trips a run_function rule (sandboxed config, no secret) over REST", async () => {
    const created = await ok("POST", "/webhooks", {
      name: "rest run_function rule",
      eventType: "changes_requested",
      baseId: null,
      actionKind: "run_function",
      config: { code: "await fetch('https://example.com/never'); return null;", timeoutMs: 500 },
      enabled: true,
    });
    expect(created.actionKind).toBe("run_function");
    if (created.actionKind === "run_function") {
      expect(created.config.code).toContain("fetch(");
      expect(created.config.timeoutMs).toBe(500);
    }

    const updated = await ok("PUT", `/webhooks/${created.id}`, {
      name: "rest run_function rule",
      eventType: "changes_requested",
      baseId: null,
      actionKind: "run_function",
      config: { code: "await fetch('https://example.com/still-never'); return null;" },
      enabled: true,
    });
    if (updated.actionKind === "run_function") {
      expect(updated.config.code).toContain("still-never");
      // Omitted timeoutMs on update falls back to the schema default, not the previous value.
      expect(updated.config.timeoutMs).toBe(2000);
    }
  });

  it("fires a rule end-to-end through REST — base create, record merge, signed delivery — no test-fire involved", async () => {
    received = [];
    const base = await ok("POST", "/bases", {
      slug: "wh-openapi-dispatch",
      name: "Webhook OpenAPI Dispatch",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      autoMerge: true,
    });

    const rule = await ok("POST", "/webhooks", {
      name: "rest live dispatch rule",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: hookUrl("live-dispatch"), secret: "rest-dispatch-secret" },
      enabled: true,
    });

    const cr = await ok("POST", `/bases/${base.id}/change-requests`, {
      fields: { title: "hello from REST" },
      submittedBy: "openapi-test",
      autoMerge: false,
    });
    await ok("POST", `/change-requests/${cr.id}/reviews`, { verdict: "approved" });
    await ok("POST", `/change-requests/${cr.id}/merge`);

    await waitFor(() => received.some((hit) => hit.path === "/live-dispatch"), 2000);
    const hit = received.find((h) => h.path === "/live-dispatch");
    expect(hit).toBeDefined();
    expect(hit?.signature).toBeTruthy();

    const deliveries = await ok("GET", `/webhooks/${rule.id}/deliveries?limit=10`);
    expect(deliveries.some((d: any) => d.status === "success")).toBe(true);
  });
});
