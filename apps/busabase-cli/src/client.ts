import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { type CloudContract, cloudContract } from "busabase-contract/contract/cloud";

// The cloud contract is a strict superset of the OSS workbench contract (it adds
// the cloud-only `/api/v1` endpoints: system, users/me, agent-tasks). Building the
// client over it keeps every OSS workbench command working against a local server
// while unlocking the cloud endpoints when pointed at busabase.com with an API key.
export type BusabaseClient = ContractRouterClient<CloudContract>;

export interface ResolvedConfig {
  /** Server root, e.g. `http://localhost:15419` (no trailing `/api/v1`). */
  baseUrl: string;
  /** Optional bearer token — only the cloud requires it; local OSS is open. */
  apiKey?: string;
  /** Optional Busabase Cloud space id. Sent as `x-busabase-space` when present. */
  spaceId?: string;
  /** `table` (human) or `json` (machine). */
  output: "table" | "json";
}

/**
 * Default host when neither `--base-url` nor `BUSABASE_BASE_URL` is set: the always-on Cloud.
 * A cold `busabase-cli health` reaches a real server this way (a local default would just refuse
 * the connection unless the desktop app is running). Onboarded users have `BUSABASE_BASE_URL` in
 * `~/.busabase/.env`, so this default only applies to a fresh, unconfigured invocation. For a local
 * server, pass `--base-url http://localhost:15419` (or export `BUSABASE_BASE_URL`).
 */
export const DEFAULT_BASE_URL = "https://busabase.com";

/**
 * Normalise a user-supplied base URL to the server root. The contract already
 * carries the `/api/v1` prefix, so `OpenAPILink` appends it — accept either form
 * (`http://host` or `http://host/api/v1`) and strip the suffix if present.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

export function createBusabaseClient(config: ResolvedConfig): BusabaseClient {
  const link = new OpenAPILink(cloudContract, {
    url: normalizeBaseUrl(config.baseUrl),
    headers: async () => ({
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      ...(config.spaceId ? { "x-busabase-space": config.spaceId } : {}),
    }),
  });
  return createORPCClient(link);
}
