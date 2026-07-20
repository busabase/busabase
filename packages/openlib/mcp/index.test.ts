import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { asMcpError, type McpInputSchema, registerOpenApiMcpTools } from "./index";

type TestToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  callback: (args: unknown, extra: unknown) => Promise<TestToolResult> | TestToolResult;
  config: {
    description?: string;
    inputSchema?: McpInputSchema;
    title?: string;
  };
};

const createTestServer = () => {
  const tools = new Map<string, RegisteredTool>();
  return {
    server: {
      registerTool(
        name: string,
        config: RegisteredTool["config"],
        callback: RegisteredTool["callback"],
      ) {
        tools.set(name, { callback, config });
      },
    },
    tools,
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
  it("registers real input schemas and keeps zero-argument tools schema-free", () => {
    const { server, tools } = createTestServer();

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

    expect(tools.get("things_get")?.config.inputSchema).toBe(inputSchema);
    expect(tools.get("things_ping")?.config.inputSchema).toBeUndefined();
    expect(tools.has("system_admin_secret")).toBe(false);
  });

  it("supports naming, description, schema, client-context, and input hooks", async () => {
    const { server, tools } = createTestServer();
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
      description: (_tool, description) => `${description}\nCustomized`,
      exclude: (tool) => tool.keyPath.join(".") === "things.ping",
      inputSchema: (_tool, schema) =>
        schema ? z.intersection(schema as z.ZodType, z.object({ tenantId: z.string() })) : schema,
      name: (keyPath) => keyPath.join("__"),
      transformInput: (input) => {
        const { tenantId: _tenantId, ...operationInput } = input as Record<string, unknown>;
        return operationInput;
      },
    });

    const registration = tools.get("things__get");
    expect(registration).toBeDefined();
    expect(registration?.config.description).toContain("Customized");
    expect(tools.has("things__ping")).toBe(false);
    expect(
      (registration?.config.inputSchema as z.ZodType).parse({
        id: "thing_1",
        tenantId: "tenant_1",
      }),
    ).toEqual({ id: "thing_1", tenantId: "tenant_1" });

    const result = await registration?.callback(
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

  it("allows an input hook to remove synthetic arguments from zero-input operations", async () => {
    const { server, tools } = createTestServer();
    const ping = vi.fn(async (input: unknown) => ({ input: input ?? null }));

    registerOpenApiMcpTools({
      server,
      contract: testContract,
      createClient: () => ({ things: { get: vi.fn(), ping } }),
      inputSchema: (tool, schema) =>
        tool.keyPath.join(".") === "things.ping"
          ? z.object({ tenantId: z.string().optional() })
          : schema,
      transformInput: (_input, tool) =>
        tool.keyPath.join(".") === "things.ping" ? undefined : _input,
    });

    await tools.get("things_ping")?.callback({ tenantId: "tenant_1" }, {});
    expect(ping).toHaveBeenCalledWith(undefined);
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
