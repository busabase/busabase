import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { type BusabaseContract, busabaseContract } from "busabase-core/contract/busabase";

export type BusabaseClient = ContractRouterClient<BusabaseContract>;

export interface ResolvedConfig {
  /** Server root, e.g. `http://localhost:3061` (no trailing `/api/v1`). */
  baseUrl: string;
  /** Optional bearer token — only the cloud requires it; local OSS is open. */
  apiKey?: string;
  /** `table` (human) or `json` (machine). */
  output: "table" | "json";
}

export const DEFAULT_BASE_URL = "http://localhost:3061";

/**
 * Normalise a user-supplied base URL to the server root. The contract already
 * carries the `/api/v1` prefix, so `OpenAPILink` appends it — accept either form
 * (`http://host` or `http://host/api/v1`) and strip the suffix if present.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

export function createBusabaseClient(config: ResolvedConfig): BusabaseClient {
  const link = new OpenAPILink(busabaseContract, {
    url: normalizeBaseUrl(config.baseUrl),
    headers: async () => (config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
  });
  return createORPCClient(link);
}
