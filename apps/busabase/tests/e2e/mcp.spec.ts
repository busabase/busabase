import { type APIRequestContext, expect, test } from "./_fixtures";

// Busabase exposes its whole REST contract as an MCP server at `/api/mcp` — the
// headline "trusted database for AI agents" surface. It speaks MCP Streamable HTTP
// (@modelcontextprotocol/sdk): JSON-RPC 2.0 over POST, the client MUST accept both
// application/json and text/event-stream, and the server replies with an SSE frame
// whose `data:` line carries the JSON-RPC response. These specs are transport-level
// (no browser) and don't need the DB for initialize / tools/list.

const MCP_ACCEPT = "application/json, text/event-stream";
const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

// The SDK answers a single request as one SSE event: `event: message\ndata: {...}`.
// Fall back to plain JSON if the server ever flips to enableJsonResponse.
const readRpc = async (response: {
  headers: () => Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}): Promise<JsonRpcResponse> => {
  const contentType = response.headers()["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as JsonRpcResponse;
  }
  const body = await response.text();
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);
  if (dataLines.length === 0) {
    throw new Error(`No SSE data frame in MCP response: ${body.slice(0, 200)}`);
  }
  // The response to our request is the frame that carries result/error.
  for (const line of dataLines) {
    const parsed = JSON.parse(line) as JsonRpcResponse;
    if (parsed.result !== undefined || parsed.error !== undefined) {
      return parsed;
    }
  }
  return JSON.parse(dataLines[dataLines.length - 1]) as JsonRpcResponse;
};

const initialize = async (request: APIRequestContext) => {
  const response = await request.post("/api/mcp", {
    headers: { Accept: MCP_ACCEPT, "Content-Type": "application/json" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "busabase-e2e", version: "0.0.0" },
      },
    },
  });
  expect(response.ok()).toBe(true);
  const sessionId = response.headers()["mcp-session-id"];
  const rpc = await readRpc(response);
  return { sessionId, rpc };
};

test("initialize returns the Busabase MCP server info", async ({ request }) => {
  const { rpc } = await initialize(request);
  expect(rpc.error).toBeUndefined();
  const serverInfo = rpc.result?.serverInfo as { name?: string } | undefined;
  expect(serverInfo?.name).toBe("Busabase MCP");
});

test("tools/list exposes the contract as MCP tools", async ({ request }) => {
  const { sessionId } = await initialize(request);
  expect(sessionId, "initialize must return an Mcp-Session-Id").toBeTruthy();

  const headers: Record<string, string> = {
    Accept: MCP_ACCEPT,
    "Content-Type": "application/json",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  // The client is expected to announce it finished initializing before calling.
  await request.post("/api/mcp", {
    headers,
    data: { jsonrpc: "2.0", method: "notifications/initialized" },
  });

  const response = await request.post("/api/mcp", {
    headers,
    data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  expect(response.ok()).toBe(true);
  const rpc = await readRpc(response);
  expect(rpc.error).toBeUndefined();
  const tools = (rpc.result?.tools ?? []) as Array<{
    inputSchema?: {
      anyOf?: Array<{
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
        type?: string;
      }>;
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
      type?: string;
    };
    name: string;
  }>;
  expect(tools.length).toBeGreaterThan(0);
  // The contract centres on bases/records/change-requests; at least the bases
  // surface must be reachable as a tool.
  const names = tools
    .map((tool) => tool.name)
    .join(" ")
    .toLowerCase();
  expect(names).toContain("base");

  const schemaFor = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema;
  expect(schemaFor("bases_get")).toEqual(
    expect.objectContaining({
      type: "object",
      properties: expect.objectContaining({ baseId: expect.objectContaining({ type: "string" }) }),
      required: expect.arrayContaining(["baseId"]),
    }),
  );
  expect(schemaFor("bases_create_change_request")).toEqual(
    expect.objectContaining({
      type: "object",
      properties: expect.objectContaining({
        baseId: expect.objectContaining({ type: "string" }),
        fields: expect.objectContaining({ type: "object" }),
      }),
      required: expect.arrayContaining(["baseId", "fields"]),
    }),
  );
  const webhookSchema = schemaFor("webhooks_create");
  expect(webhookSchema?.type).toBe("object");
  expect(webhookSchema?.anyOf).toHaveLength(3);
  for (const branch of webhookSchema?.anyOf ?? []) {
    expect(branch.properties).toEqual(
      expect.objectContaining({
        actionKind: expect.any(Object),
        config: expect.any(Object),
        eventType: expect.any(Object),
        name: expect.any(Object),
      }),
    );
  }
});

test("POST /api/mcp without text/event-stream in Accept is rejected (406)", async ({ request }) => {
  const response = await request.post("/api/mcp", {
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "busabase-e2e", version: "0.0.0" },
      },
    },
  });
  expect(response.status()).toBe(406);
});
