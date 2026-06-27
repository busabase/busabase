import { createBusabaseOpenApiClient } from "busabase-core/api-client";
import { busabaseContract } from "busabase-core/contract/busabase";
import { createOpenApiMcpHandler } from "openlib/mcp";

export const mcpHandler = createOpenApiMcpHandler({
  contract: busabaseContract,
  createClient: () =>
    createBusabaseOpenApiClient({
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:15419",
    }),
  serverInfo: { name: "Busabase MCP", version: "0.1.0" },
});
