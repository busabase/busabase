import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { busabaseContract } from "busabase-contract/contract/busabase";

const openApiGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

/**
 * A procedure with no `.route({ path })` is RPC-only by convention — long-lived
 * Event Iterators (`live.subscribe`, `airapps.runLocalNode`) that are typed for
 * `/api/rpc` but are not REST-shaped. Without this the generator invents a path
 * for them from the procedure name and they surface as REST endpoints (and, in
 * turn, as MCP tools) that no client can meaningfully call.
 */
const isRpcOnly = (contract: unknown) =>
  !(contract as { "~orpc"?: { route?: { path?: string } } })?.["~orpc"]?.route?.path;

export async function getBusabaseOpenApiSpec() {
  const spec = await openApiGenerator.generate(busabaseContract, {
    exclude: (contract) => isRpcOnly(contract),
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
        name: "Search",
        description:
          "Full-text search and unified grep (regex/literal scan across files, Docs, and Base records with one pattern and one coverage report).",
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
      {
        name: "Files",
        description:
          "First-class File nodes backed by Assets and created through Node Change Requests.",
      },
      {
        name: "File Trees",
        description:
          "Skills, Drives, and AirApps — node types whose content is an Asset-backed file tree. One surface for all three, discriminated by `type`; they differ only in their seed files and entry file.",
      },
      {
        name: "Assets",
        description:
          "Logical Busabase files backed by deduped Attachments, including AI-readable metadata and where-used references.",
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
