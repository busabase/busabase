import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { z } from "zod";

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type McpToolExtra = {
  authInfo?: AuthInfo;
};

type McpServerLike = {
  registerTool: (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodRawShape | z.ZodType;
      _meta?: Record<string, unknown>;
    },
    callback: (args: unknown, extra: unknown) => Promise<CallToolResult> | CallToolResult,
  ) => unknown;
};

type McpRouteHandler = (request: Request) => Response | Promise<Response>;

type OpenApiProcedure = {
  "~orpc"?: {
    route?: {
      method?: string;
      path?: string;
      summary?: string;
      successDescription?: string;
    };
    inputSchema?: z.ZodType;
  };
};

interface DiscoveredOpenApiTool {
  contractProcedure: OpenApiProcedure;
  keyPath: string[];
  name: string;
}

export interface CreateMcpToolsFromOpenApiContractOptions<TClient> {
  contract: unknown;
  client: TClient;
  exclude?: (tool: DiscoveredOpenApiTool) => boolean;
  include?: (tool: DiscoveredOpenApiTool) => boolean;
  name?: (keyPath: string[], procedure: OpenApiProcedure) => string;
}

export interface RegisterOpenApiMcpToolsOptions<TClient> {
  server: McpServerLike;
  contract: unknown;
  createClient: (extra: McpToolExtra) => TClient;
  exclude?: (tool: DiscoveredOpenApiTool) => boolean;
  include?: (tool: DiscoveredOpenApiTool) => boolean;
  name?: (keyPath: string[], procedure: OpenApiProcedure) => string;
}

export interface CreateOpenApiMcpHandlerOptions<TClient> {
  contract: unknown;
  createClient: (extra: McpToolExtra) => TClient;
  exclude?: (tool: DiscoveredOpenApiTool) => boolean;
  include?: (tool: DiscoveredOpenApiTool) => boolean;
  name?: (keyPath: string[], procedure: OpenApiProcedure) => string;
  serverInfo?: {
    name: string;
    version: string;
  };
}

type McpSession = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
};

type PendingMcpSession = McpSession & {
  getSessionId: () => string;
};

export const createMcpToolsFromOpenApiContract = <TClient>(
  options: CreateMcpToolsFromOpenApiContractOptions<TClient>,
) => {
  const discovered = discoverOpenApiTools(options.contract, {
    exclude: options.exclude,
    include: options.include,
    name: options.name,
  });

  return discovered.map((tool) => ({
    ...tool,
    call: (input: unknown) => {
      const operation = getByPath(options.client, tool.keyPath);
      if (typeof operation !== "function") {
        throw new Error(`OpenAPI client operation missing for MCP tool: ${tool.keyPath.join(".")}`);
      }
      return operation(input);
    },
  }));
};

export const registerOpenApiMcpTools = <TClient>(
  options: RegisterOpenApiMcpToolsOptions<TClient>,
) => {
  const tools = createMcpToolsFromOpenApiContract({
    contract: options.contract,
    client: {} as TClient,
    exclude: options.exclude,
    include: options.include,
    name: options.name,
  });

  for (const tool of tools) {
    const route = tool.contractProcedure["~orpc"]?.route;
    options.server.registerTool(
      tool.name,
      {
        title: route?.summary ?? tool.name,
        description: [
          route?.successDescription ?? route?.summary ?? `Call ${tool.name}`,
          route?.method && route?.path ? `${route.method} ${route.path}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        inputSchema: {},
        _meta: {
          openApiPath: route?.path,
          openApiMethod: route?.method,
          orpcPath: tool.keyPath.join("."),
        },
      },
      async (args, extra) => {
        try {
          const client = options.createClient(extra as McpToolExtra);
          const operation = getByPath(client, tool.keyPath);
          if (typeof operation !== "function") {
            throw new Error(`OpenAPI client operation missing: ${tool.keyPath.join(".")}`);
          }

          const input = tool.contractProcedure["~orpc"]?.inputSchema ? args : undefined;
          const output = await operation(input);
          return asMcpJson(output);
        } catch (error) {
          return asMcpError(error);
        }
      },
    );
  }
};

export const createOpenApiMcpHandler = <TClient>(
  options: CreateOpenApiMcpHandlerOptions<TClient>,
): McpRouteHandler => {
  const sessions = new Map<string, McpSession>();

  const createSession = async () => {
    const server = new McpServer(options.serverInfo ?? { name: "OpenAPI MCP", version: "0.1.0" });
    registerOpenApiMcpTools({
      server,
      contract: options.contract,
      createClient: options.createClient,
      exclude: options.exclude,
      include: options.include,
      name: options.name,
    });

    let sessionId = "";
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        sessionId = id;
        sessions.set(id, { server, transport });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });
    transport.onerror = (error) => {
      console.error("[mcp] Transport error:", error);
    };

    await server.connect(transport);
    return { server, transport, getSessionId: () => sessionId };
  };

  return async (request) => {
    if (request.method === "GET") {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        },
        { status: 405 },
      );
    }

    const sessionId = request.headers.get("mcp-session-id");
    const session = sessionId ? sessions.get(sessionId) : undefined;
    const activeSession = session ?? (await createSession());
    const requestWithAuth = request as Request & {
      auth?: McpToolExtra["authInfo"];
      authInfo?: McpToolExtra["authInfo"];
    };
    const response = await activeSession.transport.handleRequest(request, {
      authInfo: requestWithAuth.authInfo ?? requestWithAuth.auth,
    });

    const initializedSessionId = isPendingSession(activeSession)
      ? activeSession.getSessionId()
      : undefined;
    if (initializedSessionId && !response.headers.has("mcp-session-id")) {
      response.headers.set("mcp-session-id", initializedSessionId);
    }

    return response;
  };
};

const isPendingSession = (session: McpSession | PendingMcpSession): session is PendingMcpSession =>
  "getSessionId" in session;

const discoverOpenApiTools = (
  contract: unknown,
  options: Pick<RegisterOpenApiMcpToolsOptions<unknown>, "exclude" | "include" | "name"> = {},
) => {
  const tools: DiscoveredOpenApiTool[] = [];

  const walk = (node: unknown, keyPath: string[]) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const procedure = node as OpenApiProcedure;
    if (procedure["~orpc"]?.route) {
      const tool: DiscoveredOpenApiTool = {
        contractProcedure: procedure,
        keyPath,
        name: options.name?.(keyPath, procedure) ?? defaultToolName(keyPath),
      };

      if (!defaultExclude(tool) && !options.exclude?.(tool) && (options.include?.(tool) ?? true)) {
        tools.push(tool);
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "~orpc") continue;
      walk(value, [...keyPath, key]);
    }
  };

  walk(contract, []);
  return tools;
};

const defaultExclude = (tool: DiscoveredOpenApiTool) =>
  tool.keyPath.some((part) => part.toLowerCase().includes("systemadmin"));

const defaultToolName = (keyPath: string[]) => keyPath.map(toSnakeCase).join("_");

const toSnakeCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const getByPath = (root: unknown, keyPath: string[]) =>
  keyPath.reduce<unknown>((current, key) => {
    if (!current || (typeof current !== "object" && typeof current !== "function")) {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, root);

export const asMcpJson = (value: unknown): CallToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2),
    },
  ],
});

export const asMcpError = (error: unknown): CallToolResult => ({
  content: [
    {
      type: "text",
      text: error instanceof Error ? error.message : String(error),
    },
  ],
  isError: true,
});

export const withMcpNotificationAccepted =
  (handler: McpRouteHandler): McpRouteHandler =>
  async (request) => {
    if (request.method !== "POST") {
      return handler(request);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return handler(request);
    }

    const requestForHandler = request.clone();

    try {
      const body = await request.json();
      if (isJsonRpcNotificationOnly(body)) {
        const response = await handler(requestForHandler);
        if (response.status >= 500) {
          return new Response(null, { status: 202 });
        }

        return response;
      }
    } catch {
      return handler(requestForHandler);
    }

    return handler(requestForHandler);
  };

const isJsonRpcNotificationOnly = (body: unknown) => {
  const messages = Array.isArray(body) ? body : [body];
  return (
    messages.length > 0 &&
    messages.every(
      (message) =>
        message &&
        typeof message === "object" &&
        (message as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
        !("id" in message),
    )
  );
};
