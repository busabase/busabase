import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { type ContractRouterClient, oc } from "@orpc/contract";
import { z } from "zod";

const CloudSpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
});

const cloudSpacesContract = oc.router({
  spaces: oc.router({
    list: oc.output(z.array(CloudSpaceSchema)),
  }),
});

export type CloudSpace = z.infer<typeof CloudSpaceSchema>;
type CloudSpacesClient = ContractRouterClient<typeof cloudSpacesContract>;

type AuthorizationHeaders = () => Promise<Record<string, string>>;

export function createCloudSpacesRpcOptions(serverUrl: string, headers: AuthorizationHeaders) {
  return {
    url: `${serverUrl.replace(/\/+$/, "")}/api/rpc`,
    headers,
  };
}

/**
 * Cloud OAuth access tokens are scoped to the internal RPC resource. They are
 * intentionally not API keys and therefore cannot call the public /api/v1 API.
 */
export function createCloudSpacesClient(
  serverUrl: string,
  headers: AuthorizationHeaders,
): CloudSpacesClient {
  const link = new RPCLink(createCloudSpacesRpcOptions(serverUrl, headers));
  return createORPCClient<CloudSpacesClient>(link);
}
