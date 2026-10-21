import { type OpenAPI, OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { cloudContract } from "busabase-contract/contract/cloud";
import {
  busabaseOpenApiCommonSchemas,
  busabaseOpenApiErrorResponseBodySchema,
} from "busabase-contract/contract/openapi-components";
import { isRpcOnly } from "openlib/openapi";

/**
 * The OpenAPI document the language SDKs are GENERATED from
 * (`packages/busabase-python-sdk` today).
 *
 * Built from `cloudContract` — the exact surface the TypeScript SDK
 * (`busabase-sdk`) and the CLI talk to — rather than from either server's
 * served spec, because those are both a little off for a client library:
 *
 * - the OSS server's spec carries its local-only Vault editor routes, which
 *   Busabase Cloud does not serve;
 * - Busabase Cloud's spec carries app-internal routes (community forum,
 *   onboarding, device login) that no API-key client calls.
 *
 * `cloudContract` is the OSS workbench surface plus the three Cloud-only
 * groups (`system`, `users`, `agentTasks`), so one generated SDK works against
 * a self-hosted server and Busabase Cloud alike.
 *
 * It uses the same named `components.schemas` and the same `{ error, code, data }`
 * error envelope as the served specs, so the models match theirs.
 */
export async function getBusabaseSdkOpenApiSpec(): Promise<OpenAPI.Document> {
  const spec = await new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  }).generate(cloudContract, {
    exclude: (contract) => isRpcOnly(contract),
    commonSchemas: busabaseOpenApiCommonSchemas,
    customErrorResponseBodySchema: busabaseOpenApiErrorResponseBodySchema,
    info: {
      title: "Busabase API",
      // Deliberately NOT the package version: this document is committed next
      // to the generated SDK and checked for drift, so it must only change when
      // the API does — not on every release bump.
      version: "v1",
      description:
        "REST API for Busabase, the shared data source people and AI agents work in. Works against Busabase Cloud (https://busabase.com) and any self-hosted Busabase server. Authenticate with `Authorization: Bearer <API key>` (a local self-hosted server accepts unauthenticated requests). Workbench endpoints are space-scoped: pass the `x-busabase-space` header to target a space when your key belongs to more than one. The `System`, `Users` and `Agent Tasks` endpoints exist only on Busabase Cloud.",
    },
    servers: [{ url: "https://busabase.com", description: "Busabase Cloud" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A Busabase API key.",
        },
      },
    },
  });
  return dropUnionObjectDefaults(spec);
}

/** Keys whose value is a NAME -> thing map, where `default` is a name, not a keyword. */
const NAME_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "schemas",
  "responses",
  "paths",
]);

/**
 * Remove an object `default` from a UNION-typed schema (`anyOf` / `oneOf`),
 * moving it into the description instead.
 *
 * Valid OpenAPI, but openapi-python-client cannot attach a default to a union
 * of models and SKIPS THE WHOLE OPERATION ("ModelProperty cannot have a
 * default value") — that is what dropped `POST /api/v1/embed-links`, whose
 * `framePolicy` (a discriminated union) defaults to
 * `{ mode: "anywhere", allowedOrigins: [] }`. Object defaults on plain object
 * properties generate fine and are left alone, as is every scalar default.
 *
 * Nothing changes on the wire: the server applies the default from the zod
 * schema whatever the document says, so an SDK that omits the field gets
 * exactly the server default. It is done here, on the SDK's copy only, rather
 * than in the contract, so the served specs keep the machine-readable default
 * for docs and other generators.
 */
const dropUnionObjectDefaults = <T>(node: T, isNameMap = false): T => {
  if (Array.isArray(node)) return node.map((item) => dropUnionObjectDefaults(item)) as T;
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = dropUnionObjectDefaults(value, !isNameMap && NAME_MAPS.has(key));
  }
  const isUnion = Array.isArray(out.anyOf) || Array.isArray(out.oneOf);
  if (!isNameMap && isUnion && out.default !== null && typeof out.default === "object") {
    const note = `Defaults to \`${JSON.stringify(out.default)}\` when omitted.`;
    out.description = typeof out.description === "string" ? `${out.description} ${note}` : note;
    delete out.default;
  }
  return out as T;
};
