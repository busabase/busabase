import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

import type { WorkflowWebhookCall } from "../src/domains/workflow/logic/runs";
import { sendWorkflowWebhook } from "../src/domains/workflow/logic/webhook-step";

const privateAddress = [{ address: "172.20.160.222" }];
const publicAddress = [{ address: "203.0.113.25" }];
const call = (url: string, overrides: Partial<WorkflowWebhookCall> = {}): WorkflowWebhookCall => ({
  method: "GET",
  url,
  timeoutMs: 1_000,
  body: {
    event: "workflow.step",
    runId: "wfr_test",
    workflowNodeId: "nod_test",
    stepId: "notify",
    payload: { order: 7 },
    record: null,
    recordId: null,
    baseId: null,
    fields: null,
    steps: {},
    previous: null,
  },
  headers: [],
  signingSecret: null,
  ...overrides,
});

beforeEach(() => {
  // An unrelated test's local receiver must never exempt one of these targets.
  vi.stubEnv("BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS", "");
});

afterEach(() => {
  lookup.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("workflow webhook self API SSRF exception", () => {
  it("allows only the configured origin's REST API when split-horizon DNS is private", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ records: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records?baseId=base")),
    ).resolves.toMatchObject({ ok: true, status: 200, body: { records: [] } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps private targets blocked when their origin or path is not trusted", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://other.busabase.test/api/v1/records")),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("private/internal address"),
    });
    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/internal")),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("private/internal address"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not create a self API exception when no deployment origin is configured", async () => {
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records")),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("private/internal address"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks a redirect destination instead of extending the self API exception", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://other.busabase.test/api/v1/records" },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records")),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("private/internal address"),
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["/api/v1", "/api/v1/", "/api/v1/records?baseId=base"])(
    "reaches the configured private API at %s",
    async (path) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "  https://cloud.busabase.test/  ");
      lookup.mockResolvedValue(privateAddress);
      const fetch = vi.fn(
        async () =>
          new Response('{"records":[]}', {
            headers: { "content-type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetch);

      await expect(
        sendWorkflowWebhook(call(`https://cloud.busabase.test${path}`)),
      ).resolves.toMatchObject({
        ok: true,
        status: 200,
        body: { records: [] },
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "/api/v10/records",
    "/api/v1-admin/records",
    "/api/v1evil",
    "/api/internal",
    "/api/v1/../internal",
    "/api/v1/%2e%2e/internal",
  ])("does not send a request outside the API boundary: %s", async (path) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call(`https://cloud.busabase.test${path}`)),
    ).resolves.toMatchObject({
      ok: false,
      status: null,
      message: expect.stringContaining("private/internal address"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://cloud.busabase.test/api/v1/records",
    "https://cloud.busabase.test:8443/api/v1/records",
    "https://cloud.busabase.test.other.test/api/v1/records",
    "https://cloud.busabase.test@other.busabase.test/api/v1/records",
    "https://other.busabase.test/api/v1/records",
    "http://127.0.0.1/api/v1/records",
    "http://localhost/api/v1/records",
    "http://169.254.169.254/api/v1/records",
  ])("does not send a request to another internal origin: %s", async (url) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(sendWorkflowWebhook(call(url))).resolves.toMatchObject({
      ok: false,
      status: null,
      message: expect.stringContaining("Blocked:"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   ", "not a URL", "file:///tmp/Busabase"])(
    "keeps the default private-address refusal with an unusable deployment URL: %s",
    async (origin) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
      lookup.mockResolvedValue(privateAddress);
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);

      await expect(
        sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records")),
      ).resolves.toMatchObject({
        ok: false,
        status: null,
        message: expect.stringContaining("private/internal address"),
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("allows a deliberately configured non-default port, but not the hostname's default port", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test:8443");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test:8443/api/v1/records")),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records")),
    ).resolves.toMatchObject({ ok: false, status: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves the API's own authentication refusal after the network guard allows it", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn(
      async () =>
        new Response('{"error":"Unauthorized"}', {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records")),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      message: "HTTP 401",
      body: { error: "Unauthorized" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rechecks every relative redirect, retaining trust only while it stays on the API", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/api/v1/next" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/api/internal" },
        }),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records")),
    ).resolves.toMatchObject({
      ok: false,
      status: null,
      message: expect.stringContaining("private/internal address"),
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://cloud.busabase.test/api/v1/records",
      "https://cloud.busabase.test/api/v1/next",
    ]);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1/private",
    "https://other.busabase.test/api/v1/records",
  ])("refuses a trusted API redirect to %s", async (location) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      sendWorkflowWebhook(call("https://cloud.busabase.test/api/v1/records")),
    ).resolves.toMatchObject({ ok: false, status: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not forward the self API's credentials when it redirects to a public receiver", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockImplementation(async (hostname: string) =>
      hostname === "receiver.example.test" ? publicAddress : privateAddress,
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "https://receiver.example.test/accepted" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    const request = call("https://cloud.busabase.test/api/v1/records", {
      method: "POST",
      headers: [
        { name: "Authorization", value: "Bearer test-api-key" },
        { name: "Cookie", value: "session=test-session" },
        { name: "Proxy-Authorization", value: "Basic test-proxy" },
        { name: "X-Request-ID", value: "acceptance-order-7" },
      ],
    });

    await expect(sendWorkflowWebhook(request)).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
    const original = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    const redirected = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    expect(original.get("authorization")).toBe("Bearer test-api-key");
    for (const header of ["authorization", "cookie", "proxy-authorization"]) {
      expect(redirected.has(header)).toBe(false);
    }
    expect(redirected.get("x-request-id")).toBe("acceptance-order-7");
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(request.body));
  });

  it("signs the exact POST bytes sent to the private self API, retaining its configured authorization", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cloud.busabase.test");
    lookup.mockResolvedValue(privateAddress);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    const secret = "whsec_acceptance-signing-key";
    const request = call("https://cloud.busabase.test/api/v1/records", {
      method: "POST",
      signingSecret: secret,
      headers: [{ name: "Authorization", value: "Bearer test-api-key" }],
    });

    await expect(sendWorkflowWebhook(request)).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetch).toHaveBeenCalledOnce();
    const options = fetch.mock.calls[0]?.[1];
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-api-key");
    expect(options?.body).toBe(JSON.stringify(request.body));
    const signature = headers.get("x-busabase-signature");
    expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    if (!signature) throw new Error("Expected a signature");
    const [timestamp, mac] = signature.split(",").map((part) => part.split("=")[1]);
    expect(mac).toBe(
      createHmac("sha256", secret).update(`${timestamp}.${options?.body}`).digest("hex"),
    );
    expect(JSON.stringify(options)).not.toContain(secret);
  });
});
