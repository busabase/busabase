import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { type SandboxCloudContract, sandboxCloudContract } from "../contract/cloud";
import { type SandboxBaseContract, sandboxBaseContract } from "../contract/sandbox";

export type HeadersInput =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

const resolveHeaders = (headers?: HeadersInput) => async () =>
  (typeof headers === "function" ? await headers() : headers) ?? {};

/**
 * RPC client (POST-only /api/rpc transport). Typed against the cloud (superset) contract.
 * Use when talking to an oRPC RPCHandler endpoint.
 */
export const createSandboxORPCClient = (
  apiBasePath = "/api/rpc",
): ContractRouterClient<SandboxCloudContract> =>
  createORPCClient(new RPCLink({ url: apiBasePath }));

/**
 * OpenAPI REST client for the full sandock surface (cloud contract): honors each procedure's
 * declared HTTP method + path.
 */
export const createSandboxOpenApiClient = (options: {
  baseUrl: string;
  headers?: HeadersInput;
}): ContractRouterClient<SandboxCloudContract> =>
  createORPCClient(
    new OpenAPILink(sandboxCloudContract, {
      url: options.baseUrl.replace(/\/+$/, ""),
      headers: resolveHeaders(options.headers),
    }),
  );

/**
 * OpenAPI REST client for the base (open) surface only — what `apps/sandock` serves.
 */
export const createSandboxOpenApiBaseClient = (options: {
  baseUrl: string;
  headers?: HeadersInput;
}): ContractRouterClient<SandboxBaseContract> =>
  createORPCClient(
    new OpenAPILink(sandboxBaseContract, {
      url: options.baseUrl.replace(/\/+$/, ""),
      headers: resolveHeaders(options.headers),
    }),
  );
