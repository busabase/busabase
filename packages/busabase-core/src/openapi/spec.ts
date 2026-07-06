import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { busabaseContract } from "busabase-contract/contract/busabase";

const openApiGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

export async function getBusabaseOpenApiSpec() {
  const spec = await openApiGenerator.generate(busabaseContract, {
    exclude: (_contract, path) => path[0] === "live",
    info: {
      title: "Busabase API",
      version: process.env.VERSION || "0.0.0",
      description:
        "Contract-first REST API for Busabase. Use /bases for developer-facing database operations and /nodes for the workspace tree, folders, Bases, files, and future node types.",
    },
    tags: [
      {
        name: "Auth",
        description:
          "Auth verification — the active space, acting user, and membership for the request.",
      },
      {
        name: "Bases",
        description:
          "Developer-facing Base endpoints. This is the straightforward table/database API surface.",
      },
      {
        name: "Nodes",
        description:
          "Workspace tree endpoints for folders, Bases, files, agents, and future node types.",
      },
      { name: "ChangeRequests", description: "Human review workflow for proposed changes." },
      {
        name: "Records",
        description: "Canonical records after approved changeRequests are merged.",
      },
    ],
    servers: [
      {
        url: "/api/v1",
        description: "Busabase local API base path",
      },
    ],
  });

  return {
    ...spec,
    openapi: "3.0.0",
  };
}
