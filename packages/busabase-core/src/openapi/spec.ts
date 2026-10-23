import { type OpenAPI, OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  busabaseOpenApiCommonSchemas,
  busabaseOpenApiErrorResponseBodySchema,
} from "busabase-contract/contract/openapi-components";
import { isRpcOnly } from "openlib/openapi";

const openApiGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

export async function getBusabaseOpenApiSpec(): Promise<OpenAPI.Document> {
  const spec = await openApiGenerator.generate(busabaseContract, {
    exclude: (contract) => isRpcOnly(contract),
    // Named, shared `components.schemas` (ChangeRequest, Base, Record, …) so a
    // generated SDK gets one model per domain type instead of one per use site.
    commonSchemas: busabaseOpenApiCommonSchemas,
    // Document the `{ error, code, data }` envelope the server really sends
    // (encodeBusabaseOpenApiError), not oRPC's default error shape.
    customErrorResponseBodySchema: busabaseOpenApiErrorResponseBodySchema,
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
        name: "Playbooks",
        description:
          "The skills and custom node prompts this space already defines for a job. Call `POST /playbooks/search` first on every instruction with a few phrasings of the intent; open a hit with `GET /playbooks/{kind}/{nodeId}` and follow it.",
      },
      {
        name: "Bases",
        description:
          "Developer-facing Base endpoints. This is the straightforward table/database API surface.",
      },
      {
        name: "Nodes",
        description:
          "The workspace tree and the one typed read for any node in it. `GET /nodes` returns the tree, or a flat summary list when you pass `types`; `GET /nodes/{nodeId}` returns one node's full detail discriminated by its `type` (folder children, Doc body, File asset, file-tree files). This is where listing and opening Folders, Docs, Files, Skills, Drives, and AirApps all happen — the Docs/Files/File Trees tags below cover only what is specific to those types.",
      },
      {
        name: "Files",
        description:
          "Creating File nodes backed by Assets, through Node Change Requests. List and read them through the Nodes tag (`GET /nodes?types=file`, `GET /nodes/{nodeId}`).",
      },
      {
        name: "File Trees",
        description:
          "Skills, Drives, and AirApps — node types whose content is an Asset-backed file tree. One surface for all three, discriminated by `type`; they differ only in their seed files and entry file. This tag covers creating them and working with the files INSIDE one; listing them and reading one node's detail is under the Nodes tag (`GET /nodes?types=skill`, `GET /nodes/{nodeId}`).",
      },
      {
        name: "Assets",
        description:
          "Logical Busabase files backed by deduped Attachments, including AI-readable metadata and where-used references.",
      },
      { name: "ChangeRequests", description: "Human review workflow for proposed changes." },
      {
        name: "Records",
        description: "The current rows of a Base, each written through a changeRequest.",
      },
      {
        name: "Guides",
        description:
          "The operating manual, in the same words the MCP server publishes. Read `workspace` before proposing changes and `airapp` before writing any AirApp file — the conventions this workspace expects are not expressible in a schema.",
      },
    ],
    servers: [
      {
        url: "/api/v1",
        description: "Busabase local API base path",
      },
    ],
  });

  // oRPC emits OpenAPI 3.1 (JSON Schema 2020-12: `type: "null"`, `const`,
  // numeric `exclusiveMinimum`). This used to be relabelled "3.0.0", which made
  // the document invalid as 3.0 and misled 3.0-mode SDK generators/validators.
  return spec;
}
