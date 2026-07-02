import { afterEach, describe, expect, it, vi } from "vitest";
import { HELP, runCli } from "./run";

const originalFetch = global.fetch;

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

describe("busabase-cli commands", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("documents node drafts and terminal draft close in help", () => {
    expect(HELP).toContain("nodes create-draft --type <folder|base|skill|doc>");
    expect(HELP).toContain("drafts close --draft-id <id>");
    expect(HELP).toContain("rejected = request changes, not terminal");
  });

  it("creates a folder node draft through the node ChangeRequest endpoint", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "nodes",
      "create-draft",
      "--type",
      "folder",
      "--slug",
      "crm",
      "--name",
      "CRM",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/nodes/change-requests",
        body: {
          message: "Create folder CRM",
          operations: [{ kind: "create", name: "CRM", nodeType: "folder", slug: "crm" }],
        },
      }),
    ]);
  });

  it("terminally closes a draft through the close endpoint", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "rejected" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "drafts",
      "close",
      "--draft-id",
      "crq_1",
      "--reason",
      "Wrong proposal",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/change-requests/crq_1/close",
        body: { reason: "Wrong proposal" },
      }),
    ]);
  });
});
