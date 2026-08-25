import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { AnySchema } from "@orpc/contract";
import type { JSONSchema } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type McpToolExtra = {
  authInfo?: AuthInfo;
};

export type McpInputSchema = AnySchema;

export interface McpOAuth2SecurityScheme {
  type: "oauth2";
  scopes: string[];
}

export type McpSecurityScheme = McpOAuth2SecurityScheme;

type McpServerLike = {
  setRequestHandler: Server["setRequestHandler"];
};

type McpRouteHandler = (request: Request) => Response | Promise<Response>;
type AsyncMcpRouteHandler = (request: Request) => Promise<Response>;

export interface McpOAuthChallengeOptions {
  /** Canonical RFC 8707 resource identifier for the MCP endpoint. */
  resourceUrl: string;
  /** Minimum scopes the client must request for this MCP endpoint. */
  scopes: string[];
  /** Override only when metadata is not served at the RFC 9728 path-specific URI. */
  resourceMetadataUrl?: string;
}

export type OpenApiProcedure = {
  "~orpc"?: {
    route?: {
      method?: string;
      path?: string;
      summary?: string;
      successDescription?: string;
    };
    inputSchema?: AnySchema;
  };
};

export interface DiscoveredOpenApiTool {
  contractProcedure: OpenApiProcedure;
  keyPath: string[];
  name: string;
}

export interface McpToolCallContext {
  args: unknown;
  tool: DiscoveredOpenApiTool;
}

/**
 * A text document the server publishes over `resources/list` + `resources/read`.
 *
 * Tools tell a client *what it can do*; a resource tells it *how this server expects
 * to be used*. Hosts pull resources on demand, so a long behavioural document costs
 * nothing until an agent actually asks for it — unlike `instructions`, which every
 * session pays for.
 */
export interface McpResourceDefinition {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  /** Defaults to `text/markdown`. */
  mimeType?: string;
  read: (extra: McpToolExtra) => string | Promise<string>;
}

export interface McpPromptArgumentDefinition {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * A named, user-invocable prompt published over `prompts/list` + `prompts/get`.
 * Hosts surface these as slash commands, which is the only onboarding affordance
 * available to a chat client that cannot run a shell.
 */
export interface McpPromptDefinition {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgumentDefinition[];
  get: (args: Record<string, string>, extra: McpToolExtra) => string | Promise<string>;
}

const DEFAULT_MCP_RESOURCE_MIME_TYPE = "text/markdown";

/**
 * Register `resources/*` and `prompts/*` handlers. Both are opt-in: a server that
 * passes neither keeps exactly the tools-only capability set it had before.
 */
export const registerMcpDocuments = (options: {
  server: McpServerLike;
  resources?: readonly McpResourceDefinition[];
  prompts?: readonly McpPromptDefinition[];
}) => {
  const resources = options.resources ?? [];
  const prompts = options.prompts ?? [];

  if (resources.length) {
    const byUri = new Map(resources.map((resource) => [resource.uri, resource]));
    options.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resources.map(({ uri, name, title, description, mimeType }) => ({
        uri,
        name,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        mimeType: mimeType ?? DEFAULT_MCP_RESOURCE_MIME_TYPE,
      })),
    }));
    options.server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
      const resource = byUri.get(request.params.uri);
      if (!resource) {
        throw new Error(`MCP resource not found: ${request.params.uri}`);
      }
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType ?? DEFAULT_MCP_RESOURCE_MIME_TYPE,
            text: await resource.read(extra as McpToolExtra),
          },
        ],
      };
    });
  }

  if (prompts.length) {
    const byName = new Map(prompts.map((prompt) => [prompt.name, prompt]));
    options.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: prompts.map(({ name, title, description, arguments: args }) => ({
        name,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(args?.length ? { arguments: args } : {}),
      })),
    }));
    options.server.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
      const prompt = byName.get(request.params.name);
      if (!prompt) {
        throw new Error(`MCP prompt not found: ${request.params.name}`);
      }
      const text = await prompt.get(request.params.arguments ?? {}, extra as McpToolExtra);
      return {
        ...(prompt.description ? { description: prompt.description } : {}),
        messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
      };
    });
  }
};

interface OpenApiMcpToolCustomizationOptions {
  additionalInputSchema?: (tool: DiscoveredOpenApiTool) => McpInputSchema | undefined;
  annotations?: (tool: DiscoveredOpenApiTool) => ToolAnnotations | undefined;
  description?: (tool: DiscoveredOpenApiTool, defaultDescription: string) => string;
  securitySchemes?: (tool: DiscoveredOpenApiTool) => McpSecurityScheme[] | undefined;
}

export interface CreateMcpToolsFromOpenApiContractOptions<TClient> {
  contract: unknown;
  client: TClient;
  exclude?: (tool: DiscoveredOpenApiTool) => boolean;
  include?: (tool: DiscoveredOpenApiTool) => boolean;
  name?: (keyPath: string[], procedure: OpenApiProcedure) => string;
}

export interface RegisterOpenApiMcpToolsOptions<TClient>
  extends OpenApiMcpToolCustomizationOptions {
  server: McpServerLike;
  contract: unknown;
  createClient: (extra: McpToolExtra, context: McpToolCallContext) => TClient;
  exclude?: (tool: DiscoveredOpenApiTool) => boolean;
  include?: (tool: DiscoveredOpenApiTool) => boolean;
  name?: (keyPath: string[], procedure: OpenApiProcedure) => string;
  additionalTools?: readonly McpCustomTool<TClient>[];
  additionalToolsInputSchema?: McpInputSchema;
}

/**
 * A tool that is not one endpoint.
 *
 * The contract-derived catalog is one tool per procedure, which is the right
 * shape for an SDK and the wrong one for an agent whenever a job spans several
 * endpoints (or wants a clearer name than the endpoint has). A custom tool
 * carries its own schema and its own `execute`, so it can call the client more
 * than once, or pick between endpoints, while still appearing in `tools/list`
 * alongside everything else.
 *
 * `keyPath` is not used for dispatch — `execute` handles that — but is passed
 * through in the call context so host customization hooks that key off a tool's
 * path (space scoping, say) treat these the same as generated tools.
 */
export interface McpCustomTool<TClient> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Zod schema for the tool's arguments. */
  readonly inputSchema: McpInputSchema;
  readonly keyPath: readonly string[];
  readonly annotations?: ToolAnnotations;
  readonly securitySchemes?: McpSecurityScheme[];
  readonly execute: (client: TClient, input: unknown) => Promise<unknown>;
}

export interface CreateOpenApiMcpHandlerOptions<TClient>
  extends OpenApiMcpToolCustomizationOptions {
  contract: unknown;
  createClient: (extra: McpToolExtra, context: McpToolCallContext) => TClient;
  exclude?: (tool: DiscoveredOpenApiTool) => boolean;
  include?: (tool: DiscoveredOpenApiTool) => boolean;
  instructions?: string;
  name?: (keyPath: string[], procedure: OpenApiProcedure) => string;
  /** Task-level tools published alongside the contract-derived ones. */
  additionalTools?: readonly McpCustomTool<TClient>[];
  /** Merged into every custom tool's schema, mirroring `additionalInputSchema`. */
  additionalToolsInputSchema?: McpInputSchema;
  /** Opt-in `prompts/*` surface. Omit to keep the tools-only capability set. */
  prompts?: readonly McpPromptDefinition[];
  /** Opt-in `resources/*` surface. Omit to keep the tools-only capability set. */
  resources?: readonly McpResourceDefinition[];
  serverInfo?: {
    name: string;
    version: string;
  };
}

const quoteAuthParam = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const getMcpProtectedResourceMetadataUrl = (resourceUrl: string) => {
  const resource = new URL(resourceUrl);
  const pathname = resource.pathname === "/" ? "" : resource.pathname.replace(/\/$/, "");
  return new URL(`/.well-known/oauth-protected-resource${pathname}`, resource.origin).toString();
};

/**
 * Add the RFC 9728 / MCP authorization challenge to authentication failures.
 * The wrapped verifier remains responsible for deciding whether a token is
 * missing, invalid, or lacks scope; this helper only makes that result
 * discoverable and consistent for MCP clients.
 */
export const withMcpOAuthChallenge =
  (handler: McpRouteHandler, options: McpOAuthChallengeOptions): AsyncMcpRouteHandler =>
  async (request) => {
    const response = await handler(request);
    if (response.status !== 401 && response.status !== 403) return response;

    const metadataUrl =
      options.resourceMetadataUrl ?? getMcpProtectedResourceMetadataUrl(options.resourceUrl);
    const params = [
      `resource_metadata=${quoteAuthParam(metadataUrl)}`,
      `scope=${quoteAuthParam(options.scopes.join(" "))}`,
    ];

    if (response.status === 403) {
      params.unshift('error="insufficient_scope"');
    } else if (request.headers.has("authorization")) {
      params.unshift('error="invalid_token"');
    }

    const headers = new Headers(response.headers);
    headers.set("www-authenticate", `Bearer ${params.join(", ")}`);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
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
  const discoveredTools = createMcpToolsFromOpenApiContract({
    contract: options.contract,
    client: {} as TClient,
    exclude: options.exclude,
    include: options.include,
    name: options.name,
  });
  const schemaConverter = new ZodToJsonSchemaConverter();
  const tools = new Map(
    discoveredTools.map((tool) => {
      const route = tool.contractProcedure["~orpc"]?.route;
      const contractInputSchema = tool.contractProcedure["~orpc"]?.inputSchema;
      const additionalInputSchema = options.additionalInputSchema?.(tool);
      const contractJsonSchema = contractInputSchema
        ? convertMcpInputSchema(schemaConverter, contractInputSchema, tool.name)
        : emptyMcpInputSchema();
      const additionalJsonSchema = additionalInputSchema
        ? convertMcpInputSchema(schemaConverter, additionalInputSchema, tool.name)
        : undefined;
      const inputSchema = additionalJsonSchema
        ? mergeAdditionalInputSchema(contractJsonSchema, additionalJsonSchema, tool.name)
        : contractJsonSchema;
      const defaultDescription = [
        route?.successDescription ?? route?.summary ?? `Call ${tool.name}`,
        route?.method && route?.path ? `${route.method} ${route.path}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      const annotations = options.annotations?.(tool);
      const securitySchemes = options.securitySchemes?.(tool);

      return [
        tool.name,
        {
          additionalInputKeys: new Set(Object.keys(additionalJsonSchema?.properties ?? {})),
          additionalInputSchema,
          contractInputSchema,
          definition: {
            name: tool.name,
            title: route?.summary ?? tool.name,
            description: options.description
              ? options.description(tool, defaultDescription)
              : defaultDescription,
            inputSchema,
            ...(annotations ? { annotations } : {}),
            ...(securitySchemes ? { securitySchemes } : {}),
            _meta: {
              openApiPath: route?.path,
              openApiMethod: route?.method,
              orpcPath: tool.keyPath.join("."),
              ...(securitySchemes ? { securitySchemes } : {}),
            },
          } satisfies Tool & { securitySchemes?: McpSecurityScheme[] },
          tool,
        },
      ] as const;
    }),
  );

  // Task-level tools. Registered after the generated ones and keyed by name, so
  // a task that supersedes an endpoint tool is expected to have had that tool
  // excluded — this map would otherwise just shadow it silently.
  const customTools = new Map(
    (options.additionalTools ?? []).map((tool) => {
      const ownSchema = convertMcpInputSchema(schemaConverter, tool.inputSchema, tool.name);
      const extraSchema = options.additionalToolsInputSchema
        ? convertMcpInputSchema(schemaConverter, options.additionalToolsInputSchema, tool.name)
        : undefined;
      return [
        tool.name,
        {
          additionalInputKeys: new Set(Object.keys(extraSchema?.properties ?? {})),
          additionalInputSchema: options.additionalToolsInputSchema,
          inputSchema: tool.inputSchema,
          tool,
          definition: {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: extraSchema
              ? mergeAdditionalInputSchema(ownSchema, extraSchema, tool.name)
              : ownSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
            ...(tool.securitySchemes ? { securitySchemes: tool.securitySchemes } : {}),
            _meta: {
              orpcPath: tool.keyPath.join("."),
              taskTool: true,
              ...(tool.securitySchemes ? { securitySchemes: tool.securitySchemes } : {}),
            },
          } satisfies Tool & { securitySchemes?: McpSecurityScheme[] },
        },
      ] as const;
    }),
  );

  options.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...[...customTools.values()].map(({ definition }) => definition),
      ...[...tools.values()].map(({ definition }) => definition),
    ],
  }));
  options.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const custom = customTools.get(request.params.name);
      if (custom) {
        const rawArgs = request.params.arguments ?? {};
        const additionalInput = custom.additionalInputSchema
          ? await validateMcpInput(
              custom.additionalInputSchema,
              rawArgs,
              custom.tool.name,
              "additional",
            )
          : undefined;
        const contextArgs = isRecord(additionalInput)
          ? { ...rawArgs, ...additionalInput }
          : rawArgs;
        const operationArgs = omitKeys(rawArgs, custom.additionalInputKeys);
        const input = await validateMcpInput(
          custom.inputSchema,
          operationArgs,
          custom.tool.name,
          "task",
        );
        const client = options.createClient(extra as McpToolExtra, {
          args: contextArgs,
          // Custom tools have no contract procedure; the surrounding shape is
          // what host hooks (space scoping, header injection) actually read.
          tool: {
            name: custom.tool.name,
            keyPath: [...custom.tool.keyPath],
          } as unknown as DiscoveredOpenApiTool,
        });
        return asMcpJson(await custom.tool.execute(client, input));
      }

      const registered = tools.get(request.params.name);
      if (!registered) {
        throw new Error(`MCP tool not found: ${request.params.name}`);
      }

      const rawArgs = request.params.arguments ?? {};
      const additionalInput = registered.additionalInputSchema
        ? await validateMcpInput(
            registered.additionalInputSchema,
            rawArgs,
            registered.tool.name,
            "additional",
          )
        : undefined;
      const contextArgs = isRecord(additionalInput) ? { ...rawArgs, ...additionalInput } : rawArgs;
      const operationArgs = omitKeys(rawArgs, registered.additionalInputKeys);
      const input = registered.contractInputSchema
        ? await validateMcpInput(
            registered.contractInputSchema,
            operationArgs,
            registered.tool.name,
            "contract",
          )
        : undefined;
      const client = options.createClient(extra as McpToolExtra, {
        args: contextArgs,
        tool: registered.tool,
      });
      const operation = getByPath(client, registered.tool.keyPath);
      if (typeof operation !== "function") {
        throw new Error(`OpenAPI client operation missing: ${registered.tool.keyPath.join(".")}`);
      }

      return asMcpJson(await operation(input));
    } catch (error) {
      return asMcpError(error);
    }
  });
};

const emptyMcpInputSchema = (): Tool["inputSchema"] => ({
  type: "object",
  properties: {},
});

const convertMcpInputSchema = (
  converter: ZodToJsonSchemaConverter,
  inputSchema: McpInputSchema,
  toolName: string,
): Tool["inputSchema"] => {
  if (!converter.condition(inputSchema)) {
    throw new Error(`MCP tool ${toolName} must use a Zod input schema`);
  }

  const [, jsonSchema] = converter.convert(inputSchema, { strategy: "input" });
  if (jsonSchema.type !== undefined && jsonSchema.type !== "object") {
    throw new Error(
      `MCP tool ${toolName} must use an object-shaped input schema; received ${String(jsonSchema.type)}`,
    );
  }

  return { type: "object", ...jsonSchema } as Tool["inputSchema"];
};

const mergeAdditionalInputSchema = (
  contractSchema: Tool["inputSchema"],
  additionalSchema: Tool["inputSchema"],
  toolName: string,
): Tool["inputSchema"] => {
  if (
    hasSchemaEntries(additionalSchema.anyOf) ||
    hasSchemaEntries(additionalSchema.oneOf) ||
    hasSchemaEntries(additionalSchema.allOf)
  ) {
    throw new Error(`MCP tool ${toolName} additional input schema must be a direct object schema`);
  }

  const contractProperties = collectJsonSchemaPropertyNames(contractSchema);
  for (const key of Object.keys(additionalSchema.properties ?? {})) {
    if (contractProperties.has(key)) {
      throw new Error(`MCP tool ${toolName} has duplicate input field ${key}`);
    }
  }

  const contractWithAdditionalProperties = addPropertiesToComposedObjectBranches(
    contractSchema,
    additionalSchema.properties ?? {},
  ) as Tool["inputSchema"];

  return {
    ...contractWithAdditionalProperties,
    type: "object",
    properties: {
      ...contractWithAdditionalProperties.properties,
      ...additionalSchema.properties,
    },
    required: uniqueStrings([
      ...(contractWithAdditionalProperties.required ?? []),
      ...(additionalSchema.required ?? []),
    ]),
  };
};

const hasSchemaEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

type ObjectJsonSchema = Exclude<JSONSchema, boolean>;

const addPropertiesToComposedObjectBranches = (
  schema: ObjectJsonSchema,
  properties: NonNullable<ObjectJsonSchema["properties"]>,
): ObjectJsonSchema => {
  const mergeBranch = (branch: JSONSchema): JSONSchema => {
    if (!branch || typeof branch !== "object") return branch;
    const merged = addPropertiesToComposedObjectBranches(branch, properties);

    const isObjectBranch =
      merged.type === "object" ||
      merged.properties !== undefined ||
      merged.additionalProperties !== undefined;
    return isObjectBranch
      ? { ...merged, properties: { ...merged.properties, ...properties } }
      : merged;
  };

  return {
    ...schema,
    ...(schema.anyOf ? { anyOf: schema.anyOf.map(mergeBranch) } : {}),
    ...(schema.oneOf ? { oneOf: schema.oneOf.map(mergeBranch) } : {}),
    ...(schema.allOf ? { allOf: schema.allOf.map(mergeBranch) } : {}),
  };
};

const collectJsonSchemaPropertyNames = (schema: JSONSchema): Set<string> => {
  if (!schema || typeof schema !== "object") return new Set();

  const names = new Set(Object.keys(schema.properties ?? {}));
  for (const branch of [
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.allOf ?? []),
  ]) {
    for (const name of collectJsonSchemaPropertyNames(branch)) names.add(name);
  }
  return names;
};

const validateMcpInput = async (
  schema: McpInputSchema,
  input: unknown,
  toolName: string,
  source: "additional" | "contract" | "task",
): Promise<unknown> => {
  const result = await schema["~standard"].validate(input);
  if (result.issues) {
    throw new Error(
      `Invalid ${source} input for MCP tool ${toolName}: ${result.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  return result.value;
};

const omitKeys = (input: Record<string, unknown>, keys: Set<string>) =>
  Object.fromEntries(Object.entries(input).filter(([key]) => !keys.has(key)));

const uniqueStrings = (values: readonly string[]): string[] | undefined => {
  const unique = [...new Set(values)];
  return unique.length ? unique : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const createOpenApiMcpHandler = <TClient>(
  options: CreateOpenApiMcpHandlerOptions<TClient>,
): McpRouteHandler => {
  const createRequestHandler = async () => {
    const server = new Server(options.serverInfo ?? { name: "OpenAPI MCP", version: "0.1.0" }, {
      capabilities: {
        tools: {},
        ...(options.resources?.length ? { resources: {} } : {}),
        ...(options.prompts?.length ? { prompts: {} } : {}),
      },
      instructions: options.instructions,
    });
    registerMcpDocuments({
      server,
      prompts: options.prompts,
      resources: options.resources,
    });
    registerOpenApiMcpTools({
      server,
      additionalInputSchema: options.additionalInputSchema,
      additionalTools: options.additionalTools,
      additionalToolsInputSchema: options.additionalToolsInputSchema,
      annotations: options.annotations,
      contract: options.contract,
      createClient: options.createClient,
      description: options.description,
      exclude: options.exclude,
      include: options.include,
      name: options.name,
      securitySchemes: options.securitySchemes,
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      // This handler only returns complete JSON responses and does not expose a
      // long-lived GET/SSE channel, so keeping protocol sessions in process
      // adds no capability. Stateless mode also lets clients survive dev HMR,
      // process restarts, and serverless requests even when they keep sending
      // an old Mcp-Session-Id header from a previous server instance.
      sessionIdGenerator: undefined,
    });
    transport.onerror = (error) => {
      console.error("[mcp] Transport error:", error);
    };

    await server.connect(transport);
    return transport;
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

    const transport = await createRequestHandler();
    const requestWithAuth = request as Request & {
      auth?: McpToolExtra["authInfo"];
      authInfo?: McpToolExtra["authInfo"];
    };
    return transport.handleRequest(request, {
      authInfo: requestWithAuth.authInfo ?? requestWithAuth.auth,
    });
  };
};

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
    const route = procedure["~orpc"]?.route;
    if (route) {
      // A procedure declared WITHOUT `.route(...)` still gets `route: {}` — an
      // empty object, which is truthy. Treating that as REST-shaped published
      // long-lived Event Iterators (`live.subscribe`, `airapps.runLocalNode`) as
      // tools an agent could call, and calling one can only fail: there is no
      // method or path for the client to reach. Require an actual route.
      if (!route.method && !route.path) {
        return;
      }

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
