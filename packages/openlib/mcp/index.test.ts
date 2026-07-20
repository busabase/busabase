import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { asMcpError, registerOpenApiMcpTools } from "./index";

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
        description?: string;
        inputSchema: {
          anyOf?: unknown[];
          properties?: Record<string, unknown>;
          required?: string[];
          type: string;
        };
        name: string;
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
