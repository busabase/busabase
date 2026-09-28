import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  asMcpError,
  createOpenApiMcpHandler,
  getMcpProtectedResourceMetadataUrl,
  registerOpenApiMcpTools,
  withMcpOAuthChallenge,
} from "./index";

type TestToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type TestRequest = {
  method: string;
  params?: Record<string, unknown>;
};

type TestRequestHandler = (
  request: TestRequest,
  extra: unknown,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

const createTestServer = () => {
  const handlers = new Map<string, TestRequestHandler>();
  const server = {
    setRequestHandler(
      schema: { shape: { method: { value: string } } },
      handler: TestRequestHandler,
    ) {
      handlers.set(schema.shape.method.value, handler);
    },
  };

  return {
    server: server as never,
    async listTools() {
      const result = await handlers.get("tools/list")?.({ method: "tools/list" }, {});
      return (result?.tools ?? []) as Array<{
        _meta?: Record<string, unknown>;
        annotations?: Record<string, unknown>;
        description?: string;
        inputSchema: {
          anyOf?: unknown[];
          properties?: Record<string, unknown>;
          required?: string[];
          type: string;
        };
        name: string;
        securitySchemes?: Array<Record<string, unknown>>;
      }>;
    },
    async callTool(name: string, args: Record<string, unknown>, extra: unknown = {}) {
      return handlers.get("tools/call")?.(
        { method: "tools/call", params: { name, arguments: args } },
        extra,
      ) as Promise<TestToolResult | undefined>;
    },
  };
};

const inputSchema = z.object({ id: z.string() });
const testContract = {
  things: {
    get: {
      "~orpc": {
        route: {
          method: "GET",
          path: "/things/{id}",
          summary: "Get thing",
          successDescription: "Thing detail",
        },
        inputSchema,
      },
    },
    ping: {
      "~orpc": {
        route: {
          method: "GET",
          path: "/things/ping",
          summary: "Ping",
        },
      },
    },
  },
  systemAdmin: {
    secret: {
      "~orpc": {
        route: { method: "GET", path: "/system-admin/secret" },
      },
    },
  },
  // Declared without `.route(...)`. oRPC still puts an empty `route` object on
  // the procedure, so a truthiness check treats it as REST-shaped.
  live: {
    subscribe: {
      "~orpc": {
        route: {},
      },
    },
  },
};

const jsonRpcRequest = (
  method: string,
  id: number,
  params?: Record<string, unknown>,
  sessionId?: string,
) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
  });

describe("createOpenApiMcpHandler", () => {
  it("accepts requests after restart even when the client sends a stale session id", async () => {
    const handler = createOpenApiMcpHandler({
      contract: testContract,
      createClient: () => ({
        things: {
          get: vi.fn(),
          ping: vi.fn(),
        },
      }),
    });

    const initializeResponse = await handler(
      jsonRpcRequest("initialize", 1, {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      }),
    );
    expect(initializeResponse.status).toBe(200);
    expect(initializeResponse.headers.get("mcp-session-id")).toBeNull();

    const listResponse = await handler(
      jsonRpcRequest("tools/list", 2, undefined, "session-from-previous-server"),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ tools: expect.any(Array) }),
      }),
    );
  });
});

const rpc = async (
  handler: (request: Request) => Response | Promise<Response>,
  method: string,
  params?: Record<string, unknown>,
  headers: Record<string, string> = {},
) => {
  const request = jsonRpcRequest(method, 1, params);
  for (const [key, value] of Object.entries(headers)) request.headers.set(key, value);
  const response = await handler(request);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
};

const initializeParams = {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0.0" },
};

describe("createOpenApiMcpHandler documents", () => {
  const staticDocuments = {
    prompts: [
      {
        name: "setup",
        title: "Set up",
        description: "Static setup prompt",
        get: () => "static setup body",
      },
    ],
    resources: [
      {
        uri: "app://manual",
        name: "manual",
        description: "Static manual",
        read: () => "static manual body",
      },
    ],
  };

  it("keeps a static-only server exactly as before", async () => {
    const handler = createOpenApiMcpHandler({
      contract: testContract,
      createClient: () => ({}),
      ...staticDocuments,
    });

    const init = await rpc(handler, "initialize", initializeParams);
    expect(init.result?.capabilities).toEqual(
      expect.objectContaining({ tools: {}, prompts: {}, resources: {} }),
    );
    expect((await rpc(handler, "prompts/list")).result).toEqual({
      prompts: [{ name: "setup", title: "Set up", description: "Static setup prompt" }],
    });
    expect((await rpc(handler, "resources/list")).result).toEqual({
      resources: [
        {
          uri: "app://manual",
          name: "manual",
          description: "Static manual",
          mimeType: "text/markdown",
        },
      ],
    });
    // No template provider → the method is not registered at all, as before.
    expect((await rpc(handler, "resources/templates/list")).error?.code).toBe(-32601);
    expect((await rpc(handler, "prompts/get", { name: "setup" })).result).toEqual({
      description: "Static setup prompt",
      messages: [{ role: "user", content: { type: "text", text: "static setup body" } }],
    });
  });

  it("declares no document capabilities for a tools-only server", async () => {
    const handler = createOpenApiMcpHandler({ contract: testContract, createClient: () => ({}) });
    const init = await rpc(handler, "initialize", initializeParams);
    expect(init.result?.capabilities).not.toHaveProperty("prompts");
    expect(init.result?.capabilities).not.toHaveProperty("resources");
    expect((await rpc(handler, "prompts/list")).error?.code).toBe(-32601);
  });

  it("declares capabilities from dynamic providers alone", async () => {
    const handler = createOpenApiMcpHandler({
      contract: testContract,
      createClient: () => ({}),
      documentProviders: {
        listPrompts: async () => [{ name: "dyn" }],
        readResource: async () => undefined,
      },
    });
    const init = await rpc(handler, "initialize", initializeParams);
    expect(init.result?.capabilities).toEqual(
      expect.objectContaining({ prompts: {}, resources: {} }),
    );
    expect((await rpc(handler, "prompts/list")).result).toEqual({ prompts: [{ name: "dyn" }] });
    expect((await rpc(handler, "resources/list")).result).toEqual({ resources: [] });
  });

  it("merges per-caller prompts and resources after the static ones, in the caller's request scope", async () => {
    const seen: unknown[] = [];
    const handler = createOpenApiMcpHandler({
      contract: testContract,
      createClient: () => ({}),
      ...staticDocuments,
      documentProviders: {
        listPrompts: async (extra) => {
          seen.push(extra.requestInfo?.headers["x-workspace"]);
          return [
            {
              name: "playbook__visits__log",
              title: "Log a visit",
              description: "custom",
              arguments: [{ name: "locale" }],
            },
            // Collides with a static prompt: dropped from the listing.
            { name: "setup", title: "Impostor" },
          ];
        },
        getPrompt: async (name, args, extra) =>
          name === "playbook__visits__log"
            ? {
                description: "custom",
                text: `body ${args.locale ?? "-"} ${String(extra.requestInfo?.headers["x-workspace"])}`,
              }
            : undefined,
        listResources: async () => [
          { uri: "app://skill/1", name: "Weekly report", description: "Fridays" },
          { uri: "app://manual", name: "impostor" },
        ],
        listResourceTemplates: async () => [
          { uriTemplate: "app://skill/{id}", name: "skill", description: "A skill" },
        ],
        readResource: async (uri) =>
          uri === "app://skill/1" ? { text: "# Weekly report" } : undefined,
      },
    });
    const headers = { "x-workspace": "ws-1" };

    expect((await rpc(handler, "prompts/list", undefined, headers)).result).toEqual({
      prompts: [
        { name: "setup", title: "Set up", description: "Static setup prompt" },
        {
          name: "playbook__visits__log",
          title: "Log a visit",
          description: "custom",
          arguments: [{ name: "locale" }],
        },
      ],
    });
    expect(seen).toEqual(["ws-1"]);
    expect(
      (
        await rpc(
          handler,
          "prompts/get",
          { name: "playbook__visits__log", arguments: { locale: "zh-CN" } },
          headers,
        )
      ).result,
    ).toEqual({
      description: "custom",
      messages: [{ role: "user", content: { type: "text", text: "body zh-CN ws-1" } }],
    });
    // The static prompt still wins its own name.
    expect((await rpc(handler, "prompts/get", { name: "setup" })).result?.messages).toEqual([
      { role: "user", content: { type: "text", text: "static setup body" } },
    ]);
    expect((await rpc(handler, "prompts/get", { name: "nope" })).error?.message).toContain(
      "MCP prompt not found: nope",
    );

    expect((await rpc(handler, "resources/list")).result).toEqual({
      resources: [
        {
          uri: "app://manual",
          name: "manual",
          description: "Static manual",
          mimeType: "text/markdown",
        },
        {
          uri: "app://skill/1",
          name: "Weekly report",
          description: "Fridays",
          mimeType: "text/markdown",
        },
      ],
    });
    expect((await rpc(handler, "resources/templates/list")).result).toEqual({
      resourceTemplates: [
        {
          uriTemplate: "app://skill/{id}",
          name: "skill",
          description: "A skill",
          mimeType: "text/markdown",
        },
      ],
    });
    expect((await rpc(handler, "resources/read", { uri: "app://skill/1" })).result).toEqual({
      contents: [{ uri: "app://skill/1", mimeType: "text/markdown", text: "# Weekly report" }],
    });
    expect((await rpc(handler, "resources/read", { uri: "app://manual" })).result).toEqual({
      contents: [{ uri: "app://manual", mimeType: "text/markdown", text: "static manual body" }],
    });
    expect(
      (await rpc(handler, "resources/read", { uri: "app://skill/2" })).error?.message,
    ).toContain("MCP resource not found: app://skill/2");
  });

  it("still lists the static documents when a dynamic listing throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createOpenApiMcpHandler({
      contract: testContract,
      createClient: () => ({}),
      ...staticDocuments,
      documentProviders: {
        listPrompts: async () => {
          throw new Error("db down");
        },
        listResources: async () => {
          throw new Error("db down");
        },
      },
    });
    expect((await rpc(handler, "prompts/list")).result?.prompts).toEqual([
      { name: "setup", title: "Set up", description: "Static setup prompt" },
    ]);
    expect(((await rpc(handler, "resources/list")).result?.resources as unknown[]).length).toBe(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("registerOpenApiMcpTools", () => {
  it("publishes converter-produced JSON schemas and empty schemas for zero-argument tools", async () => {
    const { server, listTools } = createTestServer();

    registerOpenApiMcpTools({
      server,
      contract: testContract,
      createClient: () => ({
        things: {
          get: vi.fn(),
          ping: vi.fn(),
        },
      }),
    });

    const tools = await listTools();
    expect(tools.find((tool) => tool.name === "things_get")?.inputSchema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    expect(tools.find((tool) => tool.name === "things_ping")?.inputSchema).toEqual({
      type: "object",
      properties: {},
    });
    expect(tools.some((tool) => tool.name === "system_admin_secret")).toBe(false);
  });

  it("lists priorityToolNames first, keeps every other tool in its default order, and never changes the set", async () => {
    const guide = {
      name: "guide",
      title: "Guide",
      description: "Custom task tool",
      inputSchema: z.object({}),
      keyPath: ["guide"],
      execute: vi.fn(),
    };
    const register = (priorityToolNames?: string[]) => {
      const { server, listTools } = createTestServer();
      registerOpenApiMcpTools({
        server,
        contract: testContract,
        createClient: () => ({}),
        additionalTools: [guide],
        priorityToolNames,
      });
      return listTools();
    };

    const defaultNames = (await register()).map((tool) => tool.name);
    // Default: custom tools, then contract tools in contract key order.
    expect(defaultNames[0]).toBe("guide");
    expect(defaultNames.indexOf("things_get")).toBeLessThan(defaultNames.indexOf("things_ping"));

    const prioritized = (await register(["things_ping", "missing_tool", "things_ping"])).map(
      (tool) => tool.name,
    );
    expect(prioritized[0]).toBe("things_ping");
    expect(prioritized.slice(1)).toEqual(defaultNames.filter((name) => name !== "things_ping"));
    expect([...prioritized].sort()).toEqual([...defaultNames].sort());
  });

  it("supports naming, descriptions, typed additional input, and client context", async () => {
    const { server, listTools, callTool } = createTestServer();
    const operation = vi.fn(async (input: unknown) => ({ input }));
    const createClient = vi.fn(() => ({
      things: {
        get: operation,
        ping: vi.fn(),
      },
    }));

    registerOpenApiMcpTools({
      server,
      contract: testContract,
      createClient,
      additionalInputSchema: () => z.object({ tenantId: z.string() }),
      description: (_tool, description) => `${description}\nCustomized`,
      exclude: (tool) => tool.keyPath.join(".") === "things.ping",
      name: (keyPath) => keyPath.join("__"),
    });

    const tools = await listTools();
    const registration = tools.find((tool) => tool.name === "things__get");
    expect(registration?.description).toContain("Customized");
    expect(tools.some((tool) => tool.name === "things__ping")).toBe(false);
    expect(registration?.inputSchema).toEqual(
      expect.objectContaining({
        properties: {
          id: { type: "string" },
          tenantId: { type: "string" },
        },
        required: ["id", "tenantId"],
        type: "object",
      }),
    );

    const result = await callTool(
      "things__get",
      { id: "thing_1", tenantId: "tenant_1" },
      { requestId: "request_1" },
    );

    expect(createClient).toHaveBeenCalledWith(
      { requestId: "request_1" },
      expect.objectContaining({
        args: { id: "thing_1", tenantId: "tenant_1" },
        tool: expect.objectContaining({ name: "things__get" }),
      }),
    );
    expect(operation).toHaveBeenCalledWith({ id: "thing_1" });
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ input: { id: "thing_1" } }, null, 2) }],
    });
  });

  it("validates and parses custom tool input before execution", async () => {
    const { server, callTool } = createTestServer();
    const execute = vi.fn(async (_client: unknown, input: unknown) => ({ input }));
    const createClient = vi.fn(() => ({ marker: "client" }));

    registerOpenApiMcpTools({
      server,
      contract: {},
      createClient,
      additionalTools: [
        {
          name: "records_list",
          title: "List records",
          description: "Lists records with a bounded limit",
          inputSchema: z.object({
            limit: z.coerce.number().int().min(1).max(100).default(20),
            query: z.string().trim().optional(),
          }),
          keyPath: ["records", "list"],
          execute,
        },
      ],
    });

    const result = await callTool("records_list", { query: "  active  " });

    expect(createClient).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        args: { query: "  active  " },
        tool: expect.objectContaining({
          keyPath: ["records", "list"],
          name: "records_list",
        }),
      }),
    );
    expect(execute).toHaveBeenCalledWith({ marker: "client" }, { limit: 20, query: "active" });
    expect(result?.isError).toBeUndefined();
  });

  it("returns invalid custom tool input as an MCP error without executing", async () => {
    const { server, callTool } = createTestServer();
    const execute = vi.fn();

    registerOpenApiMcpTools({
      server,
      contract: {},
      createClient: () => ({}),
      additionalTools: [
        {
          name: "records_list",
          title: "List records",
          description: "Lists records with a bounded limit",
          inputSchema: z.object({ limit: z.number().int().min(1).max(100) }),
          keyPath: ["records", "list"],
          execute,
        },
      ],
    });

    const result = await callTool("records_list", { limit: 5000 });

    expect(result).toEqual(
      expect.objectContaining({
        isError: true,
        content: [
          expect.objectContaining({
            text: expect.stringContaining("Invalid task input for MCP tool records_list"),
          }),
        ],
      }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("validates custom tool context input and keeps it out of execution input", async () => {
    const { server, callTool } = createTestServer();
    const execute = vi.fn(async (_client: unknown, input: unknown) => ({ input }));
    const createClient = vi.fn(() => ({}));

    registerOpenApiMcpTools({
      server,
      contract: {},
      createClient,
      additionalToolsInputSchema: z.object({
        targetSpaceId: z.string().trim().min(1),
      }),
      additionalTools: [
        {
          name: "records_get",
          title: "Get record",
          description: "Gets one record",
          inputSchema: z.object({ id: z.string() }),
          keyPath: ["records", "get"],
          execute,
        },
      ],
    });

    const invalidResult = await callTool("records_get", {
      id: "record_1",
      targetSpaceId: "   ",
    });
    expect(invalidResult).toEqual(
      expect.objectContaining({
        isError: true,
        content: [
          expect.objectContaining({
            text: expect.stringContaining("Invalid additional input for MCP tool records_get"),
          }),
        ],
      }),
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    const validResult = await callTool("records_get", {
      id: "record_1",
      targetSpaceId: "  space_1  ",
    });
    expect(validResult?.isError).toBeUndefined();
    expect(createClient).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        args: { id: "record_1", targetSpaceId: "space_1" },
      }),
    );
    expect(execute).toHaveBeenCalledWith(expect.anything(), { id: "record_1" });
  });

  it("publishes annotations and mirrored security schemes", async () => {
    const { server, listTools } = createTestServer();

    registerOpenApiMcpTools({
      server,
      contract: testContract,
      createClient: () => ({ things: { get: vi.fn(), ping: vi.fn() } }),
      annotations: () => ({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      }),
      securitySchemes: () => [{ type: "oauth2", scopes: ["mcp"] }],
    });

    const tool = (await listTools()).find((candidate) => candidate.name === "things_get");
    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tool?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["mcp"] }]);
    expect(tool?._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["mcp"] }]);
  });

  it("removes typed additional arguments from zero-input operations", async () => {
    const { server, callTool } = createTestServer();
    const ping = vi.fn(async (input: unknown) => ({ input: input ?? null }));

    registerOpenApiMcpTools({
      server,
      contract: testContract,
      createClient: () => ({ things: { get: vi.fn(), ping } }),
      additionalInputSchema: (tool) =>
        tool.keyPath.join(".") === "things.ping"
          ? z.object({ tenantId: z.string().optional() })
          : undefined,
    });

    await callTool("things_ping", { tenantId: "tenant_1" });
    expect(ping).toHaveBeenCalledWith(undefined);
  });

  it("preserves wrapped defaults and discriminated unions without rebuilding Zod schemas", async () => {
    const { server, listTools, callTool } = createTestServer();
    const upsert = vi.fn(async (input: unknown) => ({ input }));
    const wrappedInput = z
      .object({ limit: z.number().int().default(20) })
      .optional()
      .default({ limit: 20 });
    const unionInput = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("http"), config: z.object({ targetUrl: z.string().url() }) }),
      z.object({ kind: z.literal("function"), config: z.object({ code: z.string().min(1) }) }),
    ]);

    registerOpenApiMcpTools({
      server,
      contract: {
        things: {
          list: {
            "~orpc": {
              route: { method: "GET", path: "/things" },
              inputSchema: wrappedInput,
            },
          },
          upsert: {
            "~orpc": {
              route: { method: "POST", path: "/things" },
              inputSchema: unionInput,
            },
          },
        },
      },
      createClient: () => ({ things: { list: vi.fn(), upsert } }),
      additionalInputSchema: () => z.object({ tenantId: z.string() }),
    });

    const tools = await listTools();
    const listSchema = tools.find((tool) => tool.name === "things_list")?.inputSchema;
    expect(listSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          limit: expect.objectContaining({ default: 20, type: "integer" }),
          tenantId: { type: "string" },
        }),
      }),
    );
    const upsertSchema = tools.find((tool) => tool.name === "things_upsert")?.inputSchema;
    expect(upsertSchema?.type).toBe("object");
    expect(upsertSchema?.anyOf).toHaveLength(2);
    expect(upsertSchema?.properties).toEqual({ tenantId: { type: "string" } });
    expect(upsertSchema?.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ tenantId: { type: "string" } }),
        }),
      ]),
    );
    expect(
      (upsertSchema?.anyOf as Array<{ properties?: Record<string, unknown> }> | undefined)?.every(
        (branch) => branch.properties?.tenantId !== undefined,
      ),
    ).toBe(true);

    const validResult = await callTool("things_upsert", {
      kind: "http",
      config: { targetUrl: "https://example.com/hook" },
      tenantId: "tenant_1",
    });
    expect(validResult?.isError).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith({
      kind: "http",
      config: { targetUrl: "https://example.com/hook" },
    });

    const invalidResult = await callTool("things_upsert", {
      kind: "http",
      config: { code: "return true" },
      tenantId: "tenant_1",
    });
    expect(invalidResult?.isError).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("does not publish procedures declared without a route", async () => {
    // Long-lived Event Iterators (`live.subscribe`, `airapps.runLocalNode`) omit
    // `.route(...)`, but oRPC leaves `route: {}` behind — truthy, so they used to
    // be published as callable REST tools. Calling one could only ever fail:
    // there is no method or path for the client to reach.
    const { server, listTools } = createTestServer();

    registerOpenApiMcpTools({
      server,
      contract: testContract,
      createClient: () => ({}),
    });

    const names = (await listTools()).map((tool) => tool.name);
    expect(names).not.toContain("live_subscribe");
    expect(names).toEqual(expect.arrayContaining(["things_get", "things_ping"]));
  });

  it("rejects duplicate contract and additional input fields", () => {
    const { server } = createTestServer();

    expect(() =>
      registerOpenApiMcpTools({
        server,
        contract: testContract,
        createClient: () => ({}),
        additionalInputSchema: () => z.object({ id: z.string() }),
      }),
    ).toThrow("duplicate input field id");
  });
});

describe("asMcpError", () => {
  it("returns ordinary and non-Error failures as MCP tool errors", () => {
    expect(asMcpError(new Error("broken"))).toEqual({
      content: [{ type: "text", text: "broken" }],
      isError: true,
    });
    expect(asMcpError("unavailable")).toEqual({
      content: [{ type: "text", text: "unavailable" }],
      isError: true,
    });
  });
});

describe("withMcpOAuthChallenge", () => {
  const resourceUrl = "https://example.com/api/mcp";

  it("derives the path-specific protected resource metadata URL", () => {
    expect(getMcpProtectedResourceMetadataUrl(resourceUrl)).toBe(
      "https://example.com/.well-known/oauth-protected-resource/api/mcp",
    );
  });

  it("advertises discovery and scope when authorization is missing", async () => {
    const handler = withMcpOAuthChallenge(() => new Response(null, { status: 401 }), {
      resourceUrl,
      scopes: ["mcp"],
    });
    const response = await handler(new Request(resourceUrl));

    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/api/mcp", scope="mcp"',
    );
  });

  it("distinguishes invalid tokens from insufficient scope", async () => {
    const unauthorized = withMcpOAuthChallenge(() => new Response(null, { status: 401 }), {
      resourceUrl,
      scopes: ["mcp"],
    });
    const forbidden = withMcpOAuthChallenge(() => new Response(null, { status: 403 }), {
      resourceUrl,
      scopes: ["mcp", "files:read"],
    });

    const invalid = await unauthorized(
      new Request(resourceUrl, { headers: { authorization: "Bearer expired" } }),
    );
    const insufficient = await forbidden(new Request(resourceUrl));

    expect(invalid.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(insufficient.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(insufficient.headers.get("www-authenticate")).toContain('scope="mcp files:read"');
  });
});
