import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  asMcpError,
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
